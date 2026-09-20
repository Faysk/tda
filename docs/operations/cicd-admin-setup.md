# CI/CD — configuração administrativa

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-20
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

Secret necessário:

```text
VERCEL_TOKEN
```

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

Quando há publicação de Media Storage pendente e o provider atual é R2:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

`R2_PUBLIC_BUCKET=tda-media-public` é configuração não secreta e pode permanecer pinada no workflow.

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

Secrets operacionais do publisher:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

A credencial usada pelo publisher deve ter privilégio mínimo para o storage necessário. O browser nunca recebe esse par.

## Drift conhecido — 2026-09-20

A arquitetura aceita exige os secrets R2 do publisher no GitHub Environment `production`.

Entretanto, o `production.yml` atualmente integrado ainda tenta:

```text
vercel env run --environment=production
```

para fornecer as variáveis ao publisher.

Esse caminho já falhou em Production por configuração R2 incompleta e **não é mais o contrato canônico**.

Consequências operacionais:

- não considerar a publicação automática de nova mídia saudável até a PR de convergência;
- não usar `vercel env pull` ou `vercel env run` como solução definitiva para secrets operacionais do publisher;
- não afirmar que os R2 secrets já existem no GitHub Environment sem verificação administrativa;
- a próxima PR de implementação deve alinhar workflow + testes + documentação.

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

Configurar no GitHub Environment `production`:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
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
