# Ambientes e configuração

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-21
> Fonte de verdade: ADR-0018 + runbooks de CI/CD

Este documento define os ambientes do TDA, seus limites de dados/secrets e o relacionamento com providers substituíveis.

## Ambientes lógicos

| Ambiente | Fonte | Runtime/deploy atual | Dados/storage |
| --- | --- | --- | --- |
| Development | branch/worktree temporário | local | local/sintético/configurado deliberadamente |
| Preview | SHA exato da PR | Vercel Preview | sem mutação automática de Production |
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

Fonte:

```text
pull_request.head.sha
```

Contrato:

- CI precisa passar;
- deployment usa SHA exato;
- `APP_ENV=preview`;
- `APP_COMMIT_SHA=<sha>`;
- `TDA_RELEASE_ID=pr-<numero>-<sha-curto>`;
- smoke verifica health/version e superfícies relevantes;
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

O par R2 de Preview é dedicado ao token `tda-github-preview-media-publisher` e ao bucket `tda-media-preview`. Está provisionado administrativamente, mas ainda não é consumido automaticamente pela CI/Preview; conexão futura exige implementação + teste + atualização documental.

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

Media Storage:
  public  tda-media-public
  private tda-media-private
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

Esses nomes são do provider atual. Uma futura troca de provider muda a configuração do adapter/lifecycle, não a regra de que o secret operacional pertence ao ambiente que executa a operação.

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
