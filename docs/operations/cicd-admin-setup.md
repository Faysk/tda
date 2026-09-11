# CI/CD — configuração administrativa

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-11

Este runbook cobre as superfícies administrativas da esteira TDA: GitHub Environments, secrets, branch protection, persistência da branch `Preview`, rotação de credenciais e evidências de ativação.

O comportamento técnico da entrega está em [CI/CD — operação, promoção e recuperação](ci-cd.md), e a decisão arquitetural está no [ADR-0012](../adr/0012-github-actions-controlled-delivery.md).

## Regra de segurança

Nunca registrar valores de secrets neste arquivo, em issues, PRs, comentários, workflow inputs ou logs. A documentação guarda apenas **nomes, escopo, finalidade, estado observado e procedimento**.

## Estado administrativo confirmado — 2026-09-11

### GitHub branches

`Preview` e `main` estão protegidas administrativamente.

`Preview` exige os checks:

```text
validate
transcript-import-postgres
synthetic (ubuntu-latest, .venv/bin/python)
synthetic (windows-latest, .venv/Scripts/python.exe)
```

`main` exige os mesmos checks mais:

```text
promotion-source
```

Nas duas branches canônicas:

```text
require pull request before merging = enabled
status checks                         = required
enforce admins                        = enabled
force push                            = blocked
deletion                              = blocked
```

A proteção administrativa não substitui o provenance gate de `production.yml`; ela é uma camada adicional.

### Persistência de `Preview`

`Preview` é branch canônica persistente, não uma feature branch descartável.

Durante o bootstrap a opção de excluir head branches após merge removeu `Preview` depois da PR #149. A configuração foi corrigida para não excluir automaticamente branches após merge e a própria `Preview` agora está protegida contra deletion.

O workflow:

```text
.github/workflows/preview-branch-guard.yml
```

permanece como fallback. Se `Preview` desaparecer, o guard tenta recriá-la a partir do HEAD corrente de `main` sem force push.

### GitHub Environments

Existem dois environments de entrega:

```text
preview
production
```

Secrets esperados:

#### `preview`

```text
VERCEL_TOKEN
```

#### `production`

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Finalidades:

- `VERCEL_TOKEN`: autentica Vercel CLI para pull/build/deploy/curl/promote/rollback;
- `SUPABASE_ACCESS_TOKEN`: Personal Access Token Supabase `sbp_...` para Supabase CLI/Management API;
- `SUPABASE_DB_PASSWORD`: senha Postgres do projeto canônico usada por link/migration operations.

Não confundir:

```text
SUPABASE_ACCESS_TOKEN  != SUPABASE_SECRET_KEY
SUPABASE_ACCESS_TOKEN  != SUPABASE_SERVICE_ROLE_KEY
```

O primeiro é credencial da conta/CLI; as demais são credenciais do projeto/runtime.

## Recursos canônicos

Vercel:

```text
Team:    team_9wuTfarCQ3L63xtufPKUDzi0
Project: prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
Domain:  https://dnd.faysk.dev
```

Supabase:

```text
Project ref: dmrqnbdvbkfqzctcerbx
TDA migration boundary: 20260906210333
```

Esses IDs são não secretos e ficam pinados nos workflows para evitar execução contra contexto ambíguo.

## Evidência da ativação completa

Primeira release completa pela esteira final:

```text
PR de promoção: #159
Source SHA:      bc131b120fa6d3286da13e6781e0197b5b367ebd
Release:         prod-bc131b120fa6
Production:      https://dnd.faysk.dev
```

O Production CD da release acima passou:

```text
Resolve and pin production source      PASS
Verify Production source provenance    PASS
Validate release credentials           PASS
Validate migration policy              PASS
Supabase database authentication       PASS
Pull Production configuration          PASS
Build Production artifact              PASS
Stage Production --skip-domain         PASS
Prepare migration overlay              PASS
Show migration state                   PASS
Dry-run Production migrations          PASS
Apply pending Production migrations    PASS
Verify exact migration history         PASS
Database advisors                      PASS
Smoke staged Production                PASS
Vercel promote                         PASS
Canonical Production smoke             PASS
Post-deploy error scan                 PASS
GitHub Release receipt                 PASS
```

Runtime canônico confirmado:

```text
/api/health.ok          = true
/api/health.environment = production
/api/health.commit      = bc131b120fa6d3286da13e6781e0197b5b367ebd
/api/version.commit     = bc131b120fa6d3286da13e6781e0197b5b367ebd
/api/version.release    = prod-bc131b120fa6
```

Nenhum runtime error foi observado na janela pós-release consultada na Vercel.

## Rollback conhecido

O workflow `Production Rollback` exige target explícito e confirmação `ROLLBACK_TDA`.

A release `prod-bc131b120fa6` possui deployment conhecido e rastreável. A Vercel também mantém deployments `READY` anteriores que podem servir como candidatos de rollback se forem compatíveis com o schema atual.

Antes de rollback:

1. identificar deployment explicitamente;
2. validar `/api/version` do candidato;
3. confirmar compatibilidade com schema/migrations atuais;
4. executar o workflow manual com `ROLLBACK_TDA`;
5. validar `/api/health` e `/api/version` canônicos após mover tráfego.

Banco **não sofre rollback automático**.

## Como configurar/rotacionar credenciais

### Vercel

Criar um access token da conta/team que possui acesso ao projeto TDA. Usar um token dedicado de CI, com o menor escopo disponível que ainda permita operar o team/projeto canônicos.

Após criar/rotacionar:

1. atualizar `preview/VERCEL_TOKEN`;
2. executar Preview CD e exigir smoke verde;
3. atualizar `production/VERCEL_TOKEN`;
4. só depois permitir nova promoção Production.

Nunca reutilizar automaticamente valor de `.env.legado` como verdade atual: um token legado pode estar revogado ou ter escopo incompatível.

### Supabase PAT

Criar um Personal Access Token Supabase válido (`sbp_...`) para automação.

Atualizar:

```text
production/SUPABASE_ACCESS_TOKEN
```

`SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY` não substituem esse PAT.

### Supabase database password

Atualizar:

```text
production/SUPABASE_DB_PASSWORD
```

Não resetar a senha do banco apenas para “descobrir” seu valor. Rotação deve considerar clientes externos que possam usar conexão Postgres direta.

## Verificação administrativa com GitHub CLI

Consultar branches:

```powershell
gh api repos/Faysk/tda/branches/Preview --jq '{branch:.name, protected:.protected}'
gh api repos/Faysk/tda/branches/main --jq '{branch:.name, protected:.protected}'
```

Estado esperado:

```text
Preview protected=true
main    protected=true
```

Listar apenas nomes de secrets:

```powershell
gh secret list --env preview -R Faysk/tda
gh secret list --env production -R Faysk/tda
```

Nunca tentar imprimir valores para “verificar”. O teste real é o workflow autenticando e passando seus gates.

## Fluxo administrativo normal

### Nova mudança de aplicação/documentação

```text
branch temporária
  -> PR para Preview
  -> required checks
  -> merge em Preview
  -> Preview CD automático
  -> homologação verde
  -> PR Preview -> main
  -> promotion-source + required checks
  -> merge commit
  -> Production CD automático
```

### Por que `merge commit` em `Preview -> main`

`production.yml` exige que o SHA candidato seja exatamente o `merge_commit_sha` de uma PR mergeada com:

```text
head = Preview
base = main
```

Não usar squash/rebase na promoção canônica sem alterar deliberadamente o contrato de provenance e seu ADR.

## Troubleshooting

### `Missing production secret ...`

Cadastrar o secret indicado no Environment `production`; não passar credencial por workflow input.

### `SUPABASE_ACCESS_TOKEN must be ... sbp_`

O valor não é um PAT Supabase. Criar/usar Personal Access Token da conta; não usar `sb_secret_...`, anon key ou service role key.

### `vercel pull` não encontra Project Settings

Confirmar primeiro se o token Vercel atual possui acesso ao team/projeto pinados. Não trocar IDs do workflow para contornar problema de token.

### `Preview` desaparece

1. verificar `Preview Branch Guard`;
2. confirmar protection/deletion block;
3. confirmar que exclusão automática de head branches continua desativada;
4. nunca recriar via force push quando um fast-forward/base_ref normal resolver.

### Production falha em provenance

A `main` não nasceu de uma promoção válida `Preview -> main`. Não remover o gate; refazer o fluxo correto.

### Migration dry-run/history falha

Não aplicar SQL manualmente para “destravar”. Investigar drift, migration authoring e boundary antes de nova promoção.

## Histórico de bootstrap resumido

As falhas observadas durante a implantação foram mantidas como evidência em PRs/runs e resultaram em endurecimento da esteira:

- ausência inicial de `VERCEL_TOKEN` em Preview falhou antes de deploy;
- `.vercelignore` excluía `.env.example` do prebuilt e foi corrigido;
- sintaxe de autenticação do `vercel curl` foi corrigida em Preview/Production/Rollback;
- tentativa passwordless de Supabase foi rejeitada e substituída pelo contrato suportado PAT + DB password;
- token Vercel legado com acesso inadequado foi substituído por token dedicado funcional;
- `Preview` apagada automaticamente foi restaurada, auto-delete desativado e branch guard adicionado;
- branch protection foi ativada em `Preview` e `main` após a primeira release completa.

Esses eventos são históricos; não representam pendências atuais.

## Critério de 100% operacional — concluído em 2026-09-11

- [x] CI/Companion verdes em Preview e main;
- [x] Preview real cria deployment e passa smoke com SHA/release corretos;
- [x] `preview/VERCEL_TOKEN` configurado;
- [x] fluxo canônico `Preview -> main` exercitado;
- [x] Promotion Policy exige `head=Preview` / `base=main`;
- [x] Production provenance validada antes de cloud/database;
- [x] `production/VERCEL_TOKEN` configurado;
- [x] `production/SUPABASE_ACCESS_TOKEN` configurado como PAT `sbp_...`;
- [x] `production/SUPABASE_DB_PASSWORD` configurado;
- [x] Supabase authentication preflight passa;
- [x] overlay/dry-run/apply/history verification passam em execução real;
- [x] staged Production smoke passa;
- [x] o mesmo artefato staged é promovido;
- [x] `dnd.faysk.dev/api/health` e `/api/version` mostram SHA/release promovidos;
- [x] GitHub Release receipt é criado;
- [x] rollback possui candidates conhecidos e workflow deliberado;
- [x] `Preview` e `main` estão protegidas;
- [x] force push e deletion estão bloqueados nas branches canônicas;
- [x] exclusão automática de `Preview` foi desativada e o guard permanece como fallback;
- [x] documentação operacional e ADR estão integrados.

**Estado: TDA CI/CD operacional de ponta a ponta.**
