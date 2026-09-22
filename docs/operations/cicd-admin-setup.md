# CI/CD — configuração administrativa

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-22
> Fonte de verdade: ADR-0018, GitHub Environments e os workflows versionados

Este runbook cobre o estado administrativo desejado e verificável da esteira: GitHub Environments, secrets, branch protection e os providers atuais.

O comportamento técnico da entrega está em [CI/CD — operação, promoção e recuperação](ci-cd.md). A direção arquitetural está em [ADR-0018](../adr/0018-portable-core-github-control-plane.md).

## Regra de segurança

Nunca registrar valores de secrets em Git, docs, issues, PRs, comentários, workflow inputs, logs, screenshots ou chat.

A documentação guarda apenas:

- nome;
- boundary;
- finalidade;
- estado observado;
- procedimento de configuração/rotação.

## GitHub como control plane

GitHub é o control plane da entrega.

`main` é a única branch longa necessária para a entrega web.

Contrato administrativo esperado:

```text
required status check: required-ci
force push:            bloqueado
deletion:              bloqueado
merge:                 por pull request
```

Preview é deployment de PR, não branch permanente.

## GitHub Environments

Ambientes de entrega:

```text
preview
production
```

### preview

Secrets administrativos atualmente provisionados:

```text
VERCEL_TOKEN
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

O par R2 de `preview` pertence exclusivamente ao token Cloudflare `tda-github-preview-media-publisher`, restrito ao bucket `tda-media-preview` com Bucket Item Read + Write.

Estado: **provisionado, ainda não comprovado por consumidor/workflow de mídia Preview**. A presença do secret não autoriza mutação automática nem prova uso.

Preview não recebe secrets irrestritos de Production.

### production

Sempre necessário para o provider de runtime atual:

```text
VERCEL_TOKEN
```

Quando há migration pendente:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Quando há publicação pública de Media Storage pendente e o provider atual é R2:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Esse par pertence ao token Cloudflare `tda-github-production-media-publisher`, restrito a `tda-media-public` com Bucket Item Read + Write. Esse boundary foi comprovado em Production em 2026-09-20 pela repair release de Astel/Noah.

Para operações futuras explicitamente autorizadas no storage privado de Production estão provisionados:

```text
R2_PRIVATE_ACCESS_KEY_ID
R2_PRIVATE_SECRET_ACCESS_KEY
```

Esse par pertence ao token Cloudflare `tda-github-production-private-media-storage`, restrito a `tda-media-private` com Bucket Item Read + Write.

Estado do private: **provisionado, ainda não conectado a workflow/runtime**. Não reutilizar automaticamente só porque os secrets existem.

`R2_PUBLIC_BUCKET=tda-media-public`, `R2_PRIVATE_BUCKET=tda-media-private` e `R2_PREVIEW_BUCKET=tda-media-preview` são configuração não secreta.

### Regra de ownership dos secrets

- secret usado por **GitHub Actions** pertence preferencialmente ao GitHub Environment correspondente;
- secret usado apenas pelo **runtime** pertence ao ambiente do runtime;
- não usar Vercel como cofre indireto para uma operação executada pelo GitHub Actions;
- não duplicar secret sem necessidade funcional;
- quando dois boundaries realmente precisam de acesso, preferir credenciais separadas e de privilégio mínimo.

## Providers atuais

### Vercel

```text
Team:    team_9wuTfarCQ3L63xtufPKUDzi0
Project: prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
Domain:  https://dnd.faysk.dev
```

`VERCEL_TOKEN` autentica a CLI usada para build/deploy/inspect/curl/promote/rollback.

Vercel é provider de runtime/deploy, não control plane.

### Supabase

```text
Project ref: dmrqnbdvbkfqzctcerbx
```

- `SUPABASE_ACCESS_TOKEN`: PAT da conta para CLI/Management API;
- `SUPABASE_DB_PASSWORD`: conexão Postgres usada pelo lifecycle de migrations.

Não confundir:

```text
SUPABASE_ACCESS_TOKEN != SUPABASE_SECRET_KEY
SUPABASE_ACCESS_TOKEN != SUPABASE_SERVICE_ROLE_KEY
```

Supabase é o provider atual; PostgreSQL é o contrato relacional principal.

### Media Storage / Cloudflare R2

Matriz administrativa atual:

| Boundary | Token Cloudflare | GitHub Environment | Secrets | Bucket | Estado |
| --- | --- | --- | --- | --- | --- |
| Production público | `tda-github-production-media-publisher` | `production` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `tda-media-public` | operacionalmente verificado |
| Preview | `tda-github-preview-media-publisher` | `preview` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `tda-media-preview` | provisionado; uso ainda não exercitado |
| Production privado | `tda-github-production-private-media-storage` | `production` | `R2_ACCOUNT_ID` compartilhado + `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY` | `tda-media-private` | provisionado; uso ainda não exercitado |

Cada token é bucket-scoped e possui somente Bucket Item Read + Write. O browser nunca recebe credenciais permanentes.

Evidência administrativa sem valores: [R2 credential boundaries — 2026-09-20](../integrations/evidence/r2-credential-boundaries-2026-09-20.json).

## Estado do publisher de Media Storage

O workflow de Production usa diretamente os secrets do GitHub Environment `production` para o provider R2 atual e valida sua presença somente quando existe mídia pendente.

`vercel env pull` e `vercel env run` não fazem parte desse boundary.

A documentação dos nomes não prova que os valores existem administrativamente. A primeira Production CD que exigir mídia é a verificação fail-closed: se algum secret estiver ausente, a release para no gate de credenciais antes de build/stage e o domínio canônico não é promovido.

## Configuração/rotação

### Vercel token

1. criar/rotacionar token com acesso ao team/projeto canônicos;
2. atualizar `preview/VERCEL_TOKEN`;
3. validar uma PR e seu Preview;
4. atualizar `production/VERCEL_TOKEN`;
5. validar staged Production.

### Supabase

PAT:

```text
production/SUPABASE_ACCESS_TOKEN
```

DB password:

```text
production/SUPABASE_DB_PASSWORD
```

Não resetar senha apenas para descobrir valor. Rotação deve considerar consumidores externos.

### Media Storage / R2

A configuração atual usa três credenciais separadas por boundary. Não copiar um par entre buckets para "simplificar".

Production público:

```text
production/R2_ACCOUNT_ID
production/R2_ACCESS_KEY_ID
production/R2_SECRET_ACCESS_KEY
```

Preview:

```text
preview/R2_ACCOUNT_ID
preview/R2_ACCESS_KEY_ID
preview/R2_SECRET_ACCESS_KEY
```

Production privado:

```text
production/R2_ACCOUNT_ID
production/R2_PRIVATE_ACCESS_KEY_ID
production/R2_PRIVATE_SECRET_ACCESS_KEY
```

Não enviar os valores por chat nem registrá-los na documentação.

Se o par S3 existente não estiver mais recuperável, a rotação/criação de nova credencial no provider deve ser operação explícita, com privilégio mínimo, seguida de teste controlado.

## Fluxo administrativo normal

```text
branch temporária
 -> PR main
 -> CI + Preview do SHA exato
 -> required-ci
 -> merge main
 -> Production CD
 -> baseline Production real
 -> migrations pendentes? lifecycle DB
 -> mídia pendente? lifecycle Media Storage
 -> build/stage
 -> smoke
 -> promote mesmo artifact
 -> canonical health/version
 -> receipt
```

A publicação de mídia deve usar o intervalo **ainda não publicado**, sem esquecer manifests que ficaram pendentes após uma release falha.

## Branch protection

### Política de bypass e recuperação administrativa

O fluxo normal **não usa bypass**. `main` deve entrar por PR com `required-ci` verde; force-push e deleção permanecem bloqueados no contrato administrativo desejado.

Bypass/admin recovery é reservado a recuperação explícita de controle do repositório, por exemplo:

- regra/protection quebrada que impede qualquer merge legítimo;
- incidente do próprio GitHub/ruleset que torne o fluxo normal impossível;
- restauração de uma configuração administrativa removida por engano.

Bypass **não** é mecanismo para:

- ignorar CI vermelho;
- publicar hotfix sem evidência;
- contornar review por conveniência;
- empurrar código direto para Production;
- desativar permanentemente `required-ci`.

Antes de qualquer bypass deliberado:

1. registrar issue/incident ou referência operacional;
2. registrar SHA atual de `main`, motivo, ator e mudança administrativa pretendida;
3. limitar a exceção ao menor escopo e duração possível;
4. preservar o provenance gate do Production CD — bypass de branch **não** autoriza deploy.

Durante a recuperação:

- preferir alteração administrativa à branch protection/ruleset, sem alterar conteúdo de `main`;
- se um commit administrativo direto for inevitável, ele não deve ser tratado como Production-ready: o Production CD continua exigindo proveniência de PR mergeada;
- não remover `required-ci` além do estritamente necessário para restaurar a própria governança;
- nunca registrar token, certificado, private key ou valor de secret na evidência.

Depois da recuperação:

1. restaurar PR requirement, `required-ci`, bloqueio de force-push e deleção;
2. revalidar `main.protected=true` e o contexto obrigatório `required-ci`;
3. executar CI no SHA final;
4. confirmar que qualquer mudança de produto/release voltou ao fluxo PR → main → Production CD;
5. registrar o resultado no issue/incident com apenas metadata não sensível.

Se a credencial disponível não possuir permissão administrativa suficiente para ler ou alterar a proteção detalhada, o estado deve permanecer **não verificado**. Não inferir PR requirement, bypass list, force-push ou deletion policy apenas porque `protected=true`.

Verificação:

```powershell
gh api repos/Faysk/tda/branches/main --jq '{branch:.name, protected:.protected, checks:.protection.required_status_checks.contexts}'
```

Esperado:

```text
branch=main
protected=true
checks=["required-ci"]
```

## Troubleshooting

### Missing production secret

Verificar primeiro se o release plan realmente exige o domínio.

- Vercel -> GitHub Environment;
- Supabase lifecycle -> GitHub Environment;
- Media Storage publisher -> GitHub Environment.

Não passar secret por workflow input.

### Media Storage falha após release anterior

Não esconder o manifest pendente apenas porque o merge mais recente não tocou mídia. Enquanto Production não alcançou aquele SHA com publicação válida, o trabalho permanece pendente.

### Vercel config

`vercel pull` continua válido para configuração de build/runtime da Vercel. Isso é diferente de usar Vercel como cofre para secrets operacionais de outro provider.

### Migration falha

Não aplicar SQL manualmente só para destravar a esteira. Investigar migration, history e drift.

## Histórico

Branch `Preview`, `promotion-source` e os fluxos anteriores de secrets ficam documentados nos snapshots/plano de simplificação. Eles não governam a operação atual.

A evidência histórica deve ser preservada, mas nunca usada como instrução vigente quando contradiz ADR-0018 ou este runbook.
