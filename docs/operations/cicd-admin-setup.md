# CI/CD — configuração administrativa

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-10

Este runbook cobre apenas as superfícies administrativas que não podem ser versionadas no repositório: GitHub Environments, secrets e branch/ruleset protection. O comportamento da esteira está em [CI/CD — operação, promoção e recuperação](ci-cd.md), e a decisão arquitetural está no [ADR-0012](../adr/0012-github-actions-controlled-delivery.md).

## Regra de segurança

Nunca registrar valores de secrets neste arquivo, em issues, PRs, comentários, inputs de workflow ou logs. A documentação guarda apenas **nomes, escopo, finalidade e procedimento**.

## Estado observado em 2026-09-10

### GitHub

- `main` e `Preview` existem;
- a leitura pública das branches mostrou `protected=false`;
- repository rulesets observados: nenhum;
- a conexão de automação usada na implementação não possui administração de branch protection/rulesets nem acesso a APIs de secrets;
- portanto, ausência/presença de secrets deve ser provada por execução controlada dos workflows, nunca inferida.

### Preview CD

O primeiro `Preview CD` real após a PR #142 executou e falhou no passo `Require Vercel deployment credential`.

Conclusão comprovada:

```text
VERCEL_TOKEN ausente para o job de Preview
```

A falha ocorreu antes da instalação da Vercel CLI, build, deploy ou smoke. Nenhum deployment foi criado por esse run.

### Production

Production continua protegida pelo provenance gate: o workflow só prossegue quando o SHA atual da `main` é comprovadamente o `merge_commit_sha` de uma PR mergeada `Preview -> main`.

## GitHub Environment `preview`

### Criar/abrir

No repositório GitHub:

```text
Settings
  -> Environments
  -> New environment (se necessário)
  -> preview
```

O nome deve ser exatamente:

```text
preview
```

O workflow referencia esse nome literalmente.

### Secret obrigatório

Adicionar em `Environment secrets`:

```text
VERCEL_TOKEN
```

Finalidade: autenticar `vercel pull`, `vercel build`, `vercel deploy` e `vercel curl` no CI externo.

O token precisa ter acesso ao team/projeto canônicos:

```text
team_9wuTfarCQ3L63xtufPKUDzi0
prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
```

Não colocar esse token como repository variable.

### Reexecutar Preview depois do secret

Depois de cadastrar `VERCEL_TOKEN`, reexecutar o run de Preview CD falho ou provocar um novo CI verde na `Preview`.

Critério de sucesso:

```text
Resolve and pin Preview source        PASS
Require Vercel deployment credential  PASS
Pull Preview configuration            PASS
Build Preview artifact                PASS
Deploy immutable Preview artifact     PASS
Smoke Preview deployment              PASS
Preview summary                       PASS
```

O smoke precisa provar:

```text
/api/health.ok = true
/api/health.environment = preview
/api/health.commit = SHA de Preview
/api/version.commit = SHA de Preview
/api/version.release = preview-<12-char-sha>
/ responde
/sessoes responde
```

## GitHub Environment `production`

### Criar/abrir

```text
Settings
  -> Environments
  -> New environment (se necessário)
  -> production
```

Nome exato:

```text
production
```

### Secrets obrigatórios

Adicionar:

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Finalidades:

- `VERCEL_TOKEN`: build/deploy/promote/rollback na Vercel;
- `SUPABASE_ACCESS_TOKEN`: autenticação da Supabase CLI;
- `SUPABASE_DB_PASSWORD`: conexão/link e migration operations no projeto Supabase canônico.

Projeto Supabase pinado:

```text
dmrqnbdvbkfqzctcerbx
```

### Proteção adicional opcional do Environment

Se o plano/repositório permitir reviewers/deployment protection, Production pode exigir aprovação administrativa antes do job usar secrets.

Isso é defesa adicional, não substitui:

- `Preview -> main`;
- Promotion Policy;
- provenance gate do `production.yml`;
- staged deployment;
- migration gates;
- smoke antes de `vercel promote`.

## Branch protection / rulesets

### Objetivo

Impedir alteração acidental das branches canônicas e exigir os checks já versionados.

### `Preview`

Configuração recomendada:

- require pull request before merging;
- require status checks to pass;
- exigir `CI`;
- exigir Companion quando o GitHub disponibilizar o check estável correspondente;
- block force pushes;
- block deletions;
- não permitir bypass casual.

Fluxo esperado:

```text
feature/fix/refactor/ops -> PR -> Preview
```

### `main`

Configuração recomendada:

- require pull request before merging;
- require status checks to pass;
- exigir `promotion-source`;
- exigir `CI`;
- block force pushes;
- block deletions;
- não permitir push direto no fluxo normal.

Fluxo esperado:

```text
Preview -> PR -> main
```

Mesmo se a proteção administrativa estiver ausente, `production.yml` não deve publicar um SHA sem provenance de `Preview -> main`.

## Primeira homologação real

Depois de configurar `preview/VERCEL_TOKEN`:

1. reexecutar Preview CD;
2. confirmar deployment Vercel `READY`;
3. confirmar SHA e release em `/api/health` e `/api/version`;
4. abrir Home e `/sessoes`;
5. verificar runtime errors de Preview;
6. registrar deployment/evidência no histórico operacional;
7. somente então promover `Preview -> main`.

## Primeira Production pela nova esteira

Pré-condições:

- Preview real homologada;
- `production` contém os três secrets;
- PR `Preview -> main` passa `promotion-source` + CI;
- SHA de merge é o HEAD atual da `main`.

Production CD deve executar nesta ordem:

1. pin do SHA;
2. provenance `Preview -> main`;
3. validação de credentials;
4. migration policy;
5. build Production;
6. deploy staged com `--skip-domain`;
7. Supabase migration overlay;
8. dry-run;
9. apply apenas se necessário;
10. history verification;
11. advisors;
12. staged smoke;
13. `vercel promote`;
14. canonical smoke;
15. error scan;
16. GitHub Release receipt.

Antes do passo 13, `dnd.faysk.dev` deve continuar apontando para a release anterior.

## Como obter `VERCEL_TOKEN`

Criar um access token na conta Vercel que possui acesso ao team do TDA. O token deve ser tratado como credencial de CI e armazenado diretamente no GitHub Environment; nunca copiar seu valor para este repositório.

Para CI externo, a Vercel CLI usa access token via `--token`/`VERCEL_TOKEN`. OIDC do GitHub pode ser usado para trusted access a deployments protegidos, mas não substitui a autenticação necessária para `vercel deploy` neste fluxo.

## Rotação

Rotacionar secrets quando:

- houver suspeita de exposição;
- uma conta/colaborador perder acesso;
- o token for criado com escopo maior que o necessário e existir alternativa menor;
- política periódica exigir.

Após rotação, validar Preview primeiro. Production só deve ser testada depois de Preview voltar a ficar verde.

## Troubleshooting

### `Missing GitHub Environment secret VERCEL_TOKEN`

O job não recebeu o secret. Verificar nome do Environment, nome exato do secret e escopo.

### `vercel pull` sem acesso ao projeto

Token existe, mas não consegue operar o team/projeto pinados. Corrigir acesso do token/conta; não alterar IDs do workflow para contornar.

### Production falha em provenance

A `main` não veio de `Preview -> main`. Criar a promoção correta; não remover o gate.

### Production falha antes do build por secret ausente

Cadastrar o secret indicado no Environment `production`. O workflow deve informar apenas o nome da categoria ausente, nunca o valor.

### Branch ainda mostra `protected=false`

A proteção administrativa não foi configurada ou não entrou em vigor. Revisar Rules/Rulesets/Branches no GitHub. O provenance gate de Production continua obrigatório independentemente desse status.

## Critério de 100% operacional

A esteira só pode ser marcada como 100% quando todos forem verdadeiros:

- `Preview` e `main` seguem o fluxo canônico;
- CI/Companion verdes;
- Preview CD criou deployment real e passou smoke com SHA/release corretos;
- `Preview` foi homologada;
- Production secrets estão configurados;
- PR `Preview -> main` foi usada para promoção;
- Production CD provou provenance;
- migration overlay/dry-run/history gate passaram;
- staged smoke passou;
- o mesmo artefato foi promovido;
- `dnd.faysk.dev/api/health` e `/api/version` provam o SHA/release atual;
- rollback possui candidate conhecido;
- branch protection/rulesets estão configurados ou a exceção está explicitamente aceita/documentada;
- o histórico de deployment registra a evidência da primeira release pela nova esteira.
