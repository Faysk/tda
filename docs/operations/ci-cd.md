# CI/CD — operação, promoção e recuperação

> Status: vigente
> Owner: operations / release / dados
> Última revisão: 2026-09-10

## Objetivo

Este é o runbook canônico da esteira de entrega do TDA. Ele define o contrato entre GitHub, Vercel e Supabase, as condições de promoção, as credenciais mínimas, os gates de segurança, a estratégia de migrations, os smoke tests e o procedimento de rollback.

A decisão arquitetural de origem está em [ADR-0012](../adr/0012-github-actions-controlled-delivery.md).

Princípios centrais:

> **Preview verde publica homologação automaticamente.**
>
> **Production só pode nascer de uma PR mergeada `Preview -> main`.**
>
> **O domínio `dnd.faysk.dev` só muda depois de build, banco e smoke do mesmo artefato staged.**

A integração Git da Vercel permanece sem auto-deploy. GitHub Actions é o controlador da entrega.

## Topologia final

```text
feature/* | fix/* | refactor/* | ops/*
        |
        v
      PR -> Preview
        |
        +--> CI
        +--> Companion
        |
        v
      Preview
        |
        +--> Preview CD automático
        |      +--> build Preview
        |      +--> deployment imutável
        |      +--> /api/health
        |      +--> /api/version
        |      +--> smoke / e /sessoes
        |
        v
   homologação
        |
        v
 PR Preview -> main
        |
        +--> Promotion Policy
        +--> CI
        +--> Companion
        |
        v
      main
        |
        +--> Production CD automático
               +--> prova de origem Preview -> main
               +--> build Production
               +--> deploy --prod --skip-domain
               +--> Supabase overlay + dry-run/apply/verify
               +--> advisors
               +--> staged smoke
               +--> vercel promote
               +--> canonical smoke
               +--> error scan
               +--> GitHub Release receipt
```

## Ambientes

Há três ambientes lógicos e dois targets cloud de publicação:

| Ambiente | Fonte | Publicação | Banco |
| --- | --- | --- | --- |
| Development | branch temporária | nenhuma | local/sintético/configurado deliberadamente |
| Preview / homologação | `Preview` | Vercel Preview automática após CI verde | não executa migration em Production |
| Production | `main` proveniente de `Preview -> main` | staged + promote para `dnd.faysk.dev` | Supabase Production com overlay controlado |

Development não precisa de um terceiro projeto Vercel.

## Branches e contrato de promoção

### Branches temporárias

Todo desenvolvimento normal nasce fora de `Preview` e `main`, em branches como `feat/*`, `fix/*`, `refactor/*` ou `ops/*`. O destino normal é uma PR para `Preview`.

### `Preview`

`Preview` representa o candidato de homologação.

- recebe PRs de branches temporárias;
- CI deve passar no HEAD exato;
- CI verde dispara Preview CD automaticamente;
- o deployment é imutável e identificado pelo SHA;
- não executa `db push` contra Production;
- não altera `dnd.faysk.dev`;
- falha de credential/build/smoke deixa Production intacta.

### `main`

`main` representa código aprovado para Production, mas o commit só é publicável quando sua proveniência é comprovada.

O caminho autorizado é `Preview -> main`.

Há duas camadas de defesa:

1. `Promotion Policy` falha PRs para `main` cuja origem não seja `Preview`;
2. `Production CD` consulta as PRs associadas ao SHA e exige que o próprio SHA seja `merge_commit_sha` de uma PR mergeada com `head=Preview` e `base=main`.

A segunda camada é fail-closed. Push direto ou PR de feature para `main` não pode alcançar credenciais, Vercel ou Supabase.

Branch/ruleset protection continua fortemente recomendada para governança, mas não é a única barreira de publicação.

## Workflows

### `.github/workflows/ci.yml`

Responsabilidades: instalação reproduzível, migration safety policy, typecheck, lint, testes, design system, docs/catalog/governance, build, Playwright/E2E, processing e PostgreSQL scratch.

CI é gate de qualidade; não é autorização isolada de Production.

### `.github/workflows/companion.yml`

Valida o local companion em Linux e Windows, incluindo testes, wheel e installation plan.

### `.github/workflows/promotion-policy.yml`

Toda PR cujo destino é `main` deve ter:

```text
head = Preview
base = main
```

Qualquer outra combinação falha `promotion-source`. A política não usa mais variável de bootstrap.

### `.github/workflows/preview.yml`

Trigger primário: CI concluído com sucesso na branch `Preview`. Também existe `workflow_dispatch` para reexecução deliberada do HEAD atual.

O workflow:

1. busca o HEAD atual de `Preview`;
2. recusa SHA stale ou arbitrário;
3. faz checkout detached do SHA exato;
4. exige `VERCEL_TOKEN`;
5. instala Vercel CLI pinada;
6. executa `vercel pull --environment=preview`;
7. constrói com `APP_ENV=preview` e `APP_COMMIT_SHA=<sha>`;
8. publica deployment imutável com `TDA_RELEASE_ID=preview-<shortsha>`;
9. valida `/api/health` e `/api/version` contra o SHA exato;
10. valida `/` e `/sessoes`;
11. registra o deployment no summary do GitHub Environment `preview`.

Preview não possui switch de enable. CI verde significa tentativa de homologação. Se a credencial estiver ausente, o workflow falha antes de publicar qualquer artefato.

### `.github/workflows/production.yml`

Trigger primário: CI concluído com sucesso na branch `main`. Há `workflow_dispatch`, mas dispatch não contorna provenance.

Ordem fail-closed:

1. resolve e fixa HEAD de `main`;
2. recusa SHA stale/arbitrário;
3. consulta `/commits/<sha>/pulls` no GitHub;
4. exige PR mergeada `Preview -> main` cujo `merge_commit_sha` seja o SHA candidato;
5. valida todos os secrets de release e reporta apenas as categorias ausentes;
6. valida migration policy;
7. instala CLIs pinadas;
8. puxa configuração Production da Vercel;
9. constrói com `APP_ENV=production`, `APP_COMMIT_SHA` e `TDA_RELEASE_ID`;
10. publica com `--prod --skip-domain`;
11. prepara overlay Supabase;
12. compara history remoto TDA-era com migrations autoritativas;
13. executa dry-run;
14. aplica migrations pendentes;
15. busca novamente history e exige igualdade exata;
16. executa advisors;
17. smokea o deployment staged;
18. somente então executa `vercel promote`;
19. valida `dnd.faysk.dev` contra SHA/release esperados;
20. coleta erros recentes;
21. grava GitHub Release receipt.

Production não usa mais `TDA_CICD_BOOTSTRAP_READY` nem `TDA_PRODUCTION_CD_ENABLED`. A autorização vem da proveniência verificável da promoção e dos gates técnicos.

### `.github/workflows/rollback.yml`

Rollback é manual e independente do fluxo normal. Exige deployment explícito, confirmação `ROLLBACK_TDA` e `VERCEL_TOKEN`. O workflow inspeciona o candidato, lê `/api/version`, move o tráfego e valida health/version canônicos. Banco não sofre rollback automático.

## Credenciais e GitHub Environments

### `preview`

Secret mínimo:

```text
VERCEL_TOKEN
```

A credencial precisa permitir operar o team/projeto pinados no workflow.

### `production`

Secrets mínimos:

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

`VERCEL_TOKEN` pode existir como repository secret, mas Environment secret é preferível quando se deseja separar escopo/governança. Os workflows nunca imprimem seu valor.

Nunca colocar secrets em `NEXT_PUBLIC_*`, docs, PR body/comment, repository variables públicas, inputs de workflow ou logs.

## Variáveis antigas de bootstrap

As variáveis abaixo fizeram parte da montagem e não são mais requisito do contrato final:

```text
TDA_CICD_BOOTSTRAP_READY
TDA_PREVIEW_CD_ENABLED
TDA_PRODUCTION_CD_ENABLED
TDA_ENFORCE_PROMOTION_SOURCE
```

Se ainda existirem, podem ser removidas depois da confirmação administrativa.

## Vercel — contrato operacional

Team pinado: `team_9wuTfarCQ3L63xtufPKUDzi0`.

Project pinado: `prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`.

Production canônica: `https://dnd.faysk.dev`.

A integração Git da Vercel permanece sem auto-deploy.

### Preview

```text
vercel pull --environment=preview
vercel build
vercel deploy --prebuilt
```

O deployment recebe `APP_ENV=preview`, `APP_COMMIT_SHA=<sha>` e `TDA_RELEASE_ID=preview-<12 char sha>`. Nenhum alias Production é alterado.

### Production staged

```text
vercel pull --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --skip-domain
```

`--skip-domain` é obrigatório no candidate inicial.

### Promote

Somente depois de provenance, credentials, migration gates e staged smoke:

```text
vercel promote <deployment>
```

O artefato promovido é exatamente o artefato testado; não há rebuild entre smoke e promote.

## Supabase — boundary e migration overlay

Project ref: `dmrqnbdvbkfqzctcerbx`.

Boundary do reboot TDA: `20260906210333`.

O banco possui history legado anterior ao TDA que deliberadamente não é copiado para este repositório. Por isso `supabase db push` direto a partir do checkout canônico não é o procedimento de Production.

### Semântica das pastas

```text
supabase/migrations/   = migration autorizada para Production
supabase/candidates/   = SQL candidato ainda não autorizado
```

### Overlay efêmero

O runner cria workdir descartável e executa `supabase init`, `supabase link` e `supabase migration fetch`. Depois recusa filename inválido, migration local anterior ao boundary e migration remota TDA-era ausente do repo; por fim sobrepõe o conjunto TDA com `supabase/migrations`.

O legado é contexto para a CLI, não autoria falsa no Git.

### Dry-run e apply

Antes de write:

```text
supabase db push --dry-run --skip-vault
```

Se passar:

```text
supabase db push --skip-vault --yes
```

Depois o workflow busca o history novamente e exige igualdade exata desde o boundary. Não há `migration repair` automático.

### Estratégia de schema

Preferir `expand -> migrate -> contract` para manter uma janela de compatibilidade com rollback do app.

## Smoke gates

### Preview

Obrigatório:

```text
/api/health: ok=true
/api/health: environment=preview
/api/health: commit=<source sha>
/api/version: commit=<source sha>
/api/version: release=preview-<shortsha>
/ responde
/sessoes responde
```

### Production staged

Obrigatório:

```text
/api/health: ok=true
/api/health: environment=production
/api/health: commit=<source sha>
/api/version: commit=<source sha>
/api/version: release=prod-<shortsha>
/ responde
/sessoes responde
```

### Production canônica

Depois do promote, `/api/health`, `/api/version` e `/` em `https://dnd.faysk.dev` devem corresponder ao SHA/release promovidos.

## Release receipt

Depois de sucesso total, Production cria/atualiza GitHub Release `prod-<12-char-short-sha>` com source SHA, staged deployment, domínio canônico, Supabase ref, provenance, migration gates, dry-run/apply e smokes.

## Branch protection / rulesets

Configuração recomendada:

### `Preview`

- PR obrigatório para mudanças normais;
- CI obrigatório;
- Companion obrigatório quando aplicável;
- impedir force push/deletion.

### `main`

- PR obrigatório;
- `promotion-source` obrigatório;
- CI obrigatório;
- impedir force push/deletion.

A conexão GitHub usada pela automação não possui administração de rulesets/protection/secrets. Logo, essas superfícies precisam de configuração administrativa separada e nunca devem ser descritas como configuradas sem evidência.

Mesmo sem protection, Production CD permanece fail-closed graças ao provenance gate.

## Falhas e resposta

### Preview: `Missing GitHub Environment secret VERCEL_TOKEN`

Nenhum deployment foi iniciado. Criar o secret no Environment `preview` ou como repository secret deliberado e reexecutar o ciclo. Não passar token por input.

### Production source provenance falha

O SHA de `main` não veio de `Preview -> main` ou a associação GitHub está inconsistente. Não contornar; criar a promoção correta.

### Production credential validation falha

O workflow lista somente os nomes dos secrets ausentes. Configurar no Environment `production`; valores nunca entram em docs/logs.

### Migration TDA-era remota desconhecida

Abortar e investigar drift/history antes de novo deploy.

### Dry-run falha

Não aplicar manualmente “só para testar”. Corrigir estado/migration e repetir a promoção.

### Apply passa e history exato falha

Não promover tráfego.

### Staged smoke falha

Não promover. `dnd.faysk.dev` continua no deployment anterior.

### Promote passa e canonical smoke falha

Tratar como incidente; se o deployment anterior for compatível com o schema atual, executar rollback manual.

## Rollback

App-only usa `Production Rollback` com deployment conhecido como bom e `ROLLBACK_TDA`. Banco só pode permanecer mais novo se backward-compatible. Mídia/R2 e publicação de conteúdo possuem lifecycle separado do rollback do app.

## Evidência operacional — 2026-09-10

### Infraestrutura inicial

A PR #129 introduziu a esteira. CI/Companion ficaram verdes e Production CD foi observado como `skipped`, comprovando que o bootstrap não publicava por acidente.

### Documentação

A PR #136 integrou ADR-0012, runbooks, documentação de ambientes e correções encontradas pelos gates reais. O catálogo chegou a 100 documentos inventariados naquele estado.

### Regressões encontradas pelos gates

O processo encontrou e corrigiu regressões de layout/E2E, incluindo inspector do World Explorer em mobile e desktop 2K. Testes não foram removidos nem afrouxados para obter verde.

### Ativação do Preview

A PR #142 removeu switches de bootstrap do Preview CD e endureceu o smoke. Foi integrada como:

```text
652710bca720d8f07c54aa2d73fb204d9d160c7c
```

`Preview` foi fast-forwarded para o mesmo SHA com `force=false`. CI passou integralmente, incluindo build, PostgreSQL, Playwright/E2E e processing; Companion passou em Linux e Windows.

O primeiro Preview CD real executou e falhou antes de qualquer deploy, no gate `Require Vercel deployment credential`. Instalação da Vercel CLI, build, deploy e smoke foram skipped. Isso prova que `VERCEL_TOKEN` não estava disponível ao job naquele momento.

### Production antes da primeira release controlada

Durante o bootstrap, `/api/health` em `dnd.faysk.dev` estava saudável, mas com `commit=null`; `/api/version` também retornava `commit=null` e `release=null`. Logo a Production ainda não era rastreável a um SHA/release da nova esteira.

### Supabase observado

O conjunto TDA autorizado desde o boundary permaneceu alinhado com 13 migrations no momento da auditoria. Candidatas deliberadamente não aplicadas ficaram fora de `supabase/migrations`.

## Critério de 100% operacional

- [x] CI versionado e verde;
- [x] Companion versionado e verde;
- [x] Preview e main alinhadas no bootstrap;
- [x] Preview CD automático versionado;
- [x] Production staged/promote versionada;
- [x] provenance gate `Preview -> main` versionado;
- [x] migration overlay versionado;
- [x] health/version/release identity versionados;
- [x] rollback versionado;
- [x] documentação/ADR/runbook integrados;
- [ ] `VERCEL_TOKEN` disponível ao Preview;
- [ ] Preview CD real com smoke PASS e SHA/release corretos;
- [ ] secrets de Production disponíveis;
- [ ] primeira PR real `Preview -> main` validada;
- [ ] Production staged + DB gates + smoke + promote PASS;
- [ ] `dnd.faysk.dev/api/version` mostra SHA/release da promoção;
- [ ] branch protection/rulesets configurados administrativamente ou explicitamente aceitos como dívida de governança.

Não declarar 100% antes disso.
