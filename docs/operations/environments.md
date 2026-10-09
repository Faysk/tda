# Ambientes e configuração

> Status: vigente
> Owner: operations
> Última revisão: 2026-10-09
> Fonte de verdade: ADR-0018 + runbooks de CI/CD

Este documento define os ambientes do TDA, seus limites de dados/secrets e o relacionamento com providers substituíveis.

## Ambientes lógicos

| Ambiente | Fonte | Runtime/deploy atual | Dados/storage |
| --- | --- | --- | --- |
| Development | branch/worktree temporário | local | local/sintético/configurado deliberadamente |
| PR Preview | SHA exato da PR | Vercel Preview (UI) | separado, não prova paridade de Production |\n| Main Preview (pré-produção) | SHA exato de `main` após CI | **Vercel staged Production**, `--prod --skip-domain` | **mesmo Supabase e R2 configurados em Production**, acesso read-only na URL staged |
| Production | `main` aprovado | Vercel staged → smoke → promote | PostgreSQL/Supabase + Media Storage/R2 conforme lifecycle |

Preview é deployment, não branch.

## Control plane

GitHub é o control plane.

- código/config declarativa/docs -> repositório;
- CI/CD -> GitHub Actions;
- secrets operacionais usados por Actions -> GitHub Environments;
- runtime provider recebe apenas secrets necessários em execução.

## Development

Regras:

- `.env.local` e demais envs secretos não são versionados;
- `.env.example` é o modelo versionável;
- integração externa só é usada quando deliberadamente configurada;
- credencial local deve ter escopo mínimo;
- Production não é ambiente de desenvolvimento.

## Preview

Fontes:

```text
PR Preview: pull_request.head.sha
Main Preview: main HEAD SHA após CI push success
```

O **Main Preview não provisiona outro Supabase nem outro R2**. Ele faz `vercel pull --environment=production`, `vercel build --prod` e `vercel deploy --prebuilt --prod --skip-domain`. Isto cria um **staged Production deployment sem associação ao domínio oficial**; GitHub registra a verificação no environment `preview`. O build e os providers são os de Production; o tráfego de `dnd.faysk.dev` não muda até promoção explícita.

O servidor usa o mesmo código de proteção de produção, mas nos URLs imutáveis/staged todo método mutável (POST/PUT/PATCH/DELETE e demais métodos além de GET/HEAD/OPTIONS) é bloqueado com 403 antes das rotas/API/server actions. Não executar testes autenticados de escrita, DDL, migrations, uploads ou publicação nesse estágio. O read-only por hostname não impede efeitos colaterais de futuros GET mal implementados: APIs GET devem permanecer sem side effects, e a proteção Vercel da URL imutável deve continuar ativa.

Limite de equivalência: chaves R2 privadas e flags de features entregues **só por injeção do GitHub Environment production** em `production-cd.yml` ainda não são materializadas pelo `vercel pull --environment=production`. O Main Preview valida configuração Vercel e leitura dos providers de Production, enquanto o Production CD verifica o artefato com as credenciais adicionais antes de promover. Não chamar isso de teste completo de operações de escrita.

Contrato:

- CI precisa passar;
- deployment usa SHA exato;
- PR Preview: `APP_ENV=preview`, `TDA_RELEASE_ID=pr-<numero>-<sha-curto>`;
- Main Preview: `APP_ENV=production`, `APP_COMMIT_SHA=<sha>` e `TDA_RELEASE_ID=prod-<sha-curto>`, ainda sem tráfego público;
- smoke verifica health/version, superfícies relevantes e o 403 do POST sintético;
- Preview não aplica migration em Production;
- Preview não recebe credenciais irrestritas de Production por conveniência.

GitHub Environment:

```text
preview:
  VERCEL_TOKEN
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
```

O par R2 de Preview é dedicado ao token `tda-github-preview-media-publisher` e ao bucket legado `tda-media-preview`. **Não participa do novo Main Preview** nem precisa ser replicado: o staged Production usa o projeto/provider/buckets canônicos. Não apagar bucket legado automaticamente; eventual limpeza segue inventário e autorização separados.

## Production

Fonte canônica:

```text
main
```

A release aceita apenas HEAD corrente de `main` originado de PR mergeada e exige que o SHA atualmente publicado seja ancestral do candidato.

Providers atuais:

```text
runtime/deploy:
  Vercel team    team_9wuTfarCQ3L63xtufPKUDzi0
  Vercel project prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
  domain         https://dnd.faysk.dev

database:
  PostgreSQL via Supabase dmrqnbdvbkfqzctcerbx

Media Storage / Cloudflare R2:
  public  tda-media-public
  private tda-media-private
  preview tda-media-preview
  origin  https://media.dnd.faysk.dev
```

### GitHub Environment production

Sempre:

```text
VERCEL_TOKEN
```

Quando migration está pendente:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Quando publicação pública de Media Storage está pendente:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Para acesso futuro explicitamente autorizado ao bucket privado:

```text
R2_PRIVATE_ACCESS_KEY_ID
R2_PRIVATE_SECRET_ACCESS_KEY
```

O par privado é dedicado ao token `tda-github-production-private-media-storage` e a `tda-media-private`.

O **Lembra** é o primeiro consumidor de runtime desse boundary privado. Os secrets `R2_ACCOUNT_ID`, `R2_PRIVATE_ACCESS_KEY_ID` e `R2_PRIVATE_SECRET_ACCESS_KEY` permanecem no GitHub Environment `production`; o Production CD os injeta somente no deployment staged por `vercel deploy --env`, junto de `R2_PRIVATE_BUCKET=tda-media-private` e `TDA_LEMBRA_ENABLED=true`. O artefato só é promovido após migrations e smoke passarem.

O **World Entity Media** passa a usar o mesmo boundary privado para staging e preview autenticado, mas também precisa da credencial pública para promoção explícita de portraits `public_web`. O Production CD injeta server-side `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET=tda-media-public` e `TDA_WORLD_ENTITY_MEDIA_ENABLED=true` somente no artefato staged. Antes do promote, o smoke exige que uma rota World Media sintaticamente válida alcance o boundary de autenticação e responda 401 sem corpo para visitante anônimo; isso prova flag ativa + fail-closed sem criar asset. O smoke positivo autenticado de upload/finalize/publish permanece uma evidência operacional separada porque exige uma lease editorial real.

A **publicação revisionada de transcrições** é habilitada pelo mesmo staged rollout com `TDA_TRANSCRIPT_PUBLICATION_ENABLED=true` somente depois de migration/grants/RPCs e hardening pós-rollout estarem aplicados e verificados. O endpoint público `/api/health` expõe apenas o booleano não sensível `features.transcriptPublication`; staged e canonical smoke exigem `true` antes de considerar o rollout ativo. Esse probe não publica conteúdo. O smoke editorial autenticado permanece separado porque exige uma sessão/revisão aprovada real e uma decisão humana explícita.


**Todo blob/object storage do TDA usa Cloudflare R2.** `Media Storage` descreve o boundary lógico; não existe storage de blobs alternativo configurado em Vercel, Supabase, Azure Blob ou Amazon S3. Public/private/preview são buckets e credenciais R2 distintos, não providers distintos. Qualquer troca futura exige mudança arquitetural e operacional explícita; até lá, novos consumidores de blobs devem reutilizar estes boundaries R2.

Runtime secrets continuam no runtime apenas quando a aplicação realmente precisa deles.

## Migrations

Migrations são avaliadas no intervalo entre o SHA realmente publicado e o novo `main`.

Enquanto Production não alcançar uma migration, ela permanece pendente.

Sem migration pendente:

- Supabase CLI não participa;
- credenciais de migration não são exigidas;
- release web comum não toca DB por conveniência.

## Media Storage

Full audit global de todos os objetos não é gate do deploy web comum.

A regra de recuperação é:

```text
Production publicado -> novo main
          |
          +-> manifests canônicos ainda não publicados?
                sim -> lifecycle Media Storage
                não -> skip
```

Um asset histórico **já pertencente a uma Production comprovada** não deve bloquear release não relacionada.

Um manifest que entrou depois do SHA atual de Production e cuja publicação falhou **não é histórico irrelevante**: continua pendente até ser publicado/verificado ou removido por decisão explícita.

### Implementação

O planner avalia manifests no intervalo ainda não publicado, e o publisher recebe as credenciais R2 diretamente do GitHub Environment `production`.

Se os secrets administrativos estiverem ausentes, a release falha cedo no gate de credenciais. Manifest em Git continua não sendo prova de publicação; receipt/read-back/GET público permanecem obrigatórios.

## Identidade de release

Endpoints:

```text
/api/health
/api/version
```

Variáveis:

```text
APP_ENV
APP_COMMIT_SHA
TDA_RELEASE_ID
```

O staged e o canonical precisam provar a identidade esperada.

## Recuperação

Falha antes do promote não move o domínio oficial.

Falha depois do promote usa rollback do deployment e nova PR de correção. Banco e Media Storage não sofrem rollback destrutivo automático.

## Histórico

A antiga branch permanente `Preview` e promoção `Preview -> main` pertencem apenas aos documentos históricos da simplificação.
