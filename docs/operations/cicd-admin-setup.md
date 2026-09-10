# CI/CD — configuração administrativa

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-10

Este runbook cobre as superfícies administrativas e de lifecycle que não podem depender apenas do código da aplicação: GitHub Environments, secrets, branch/ruleset protection, persistência da branch `Preview` e evidências do primeiro bootstrap da esteira.

O comportamento técnico da entrega está em [CI/CD — operação, promoção e recuperação](ci-cd.md), e a decisão arquitetural está no [ADR-0012](../adr/0012-github-actions-controlled-delivery.md).

## Regra de segurança

Nunca registrar valores de secrets neste arquivo, em issues, PRs, comentários, inputs de workflow ou logs. A documentação guarda apenas **nomes, escopo, finalidade, estado observado e procedimento**.

## Estado observado em 2026-09-10

### GitHub

- `main` existe e está operacional;
- `Preview` é uma branch canônica persistente da topologia TDA;
- a leitura das branches mostrou `protected=false`;
- repository rulesets observados: nenhum;
- a conexão de automação usada na implementação não possui APIs administrativas de branch protection/rulesets/secrets;
- portanto, ausência/presença de secrets é provada por execução controlada dos workflows, nunca inferida;
- após a primeira promoção canônica `Preview -> main` (#149), o GitHub apagou automaticamente a branch `Preview`; ela foi recriada no mesmo SHA da `main` e foi adicionado o workflow `Preview Branch Guard` como fallback automático.

### Preview CD — evidência real

O Preview CD automático executou contra SHA validado de `Preview` e chegou corretamente ao gate de credencial.

Estado comprovado:

```text
VERCEL_TOKEN ausente para o job de Preview
```

A falha ocorreu antes da instalação da Vercel CLI, build, deploy ou smoke. Nenhum deployment foi criado por esses runs.

O último SHA de Preview validado antes da promoção #149 foi:

```text
430f3f9bec05a3ff55a29690163ea8bd3b1bd186
```

Nesse SHA:

```text
CI                         PASS
Companion                  PASS
PostgreSQL scratch         PASS
Playwright / E2E           PASS
Processing                 PASS
Preview credential gate    FAIL (VERCEL_TOKEN ausente)
Vercel deploy              SKIPPED
```

### Production CD — evidência real

A primeira promoção canônica foi a PR #149:

```text
Preview -> main
merge SHA: 5c67db0130e3b24efe2db9c71f2ece02c096a2f8
```

No Production CD desse SHA:

```text
Resolve and pin production source     PASS
Verify Production source provenance   PASS
Validate release credentials          FAIL
```

O log confirmou explicitamente:

```text
PRODUCTION_SOURCE_OK PR #149 Preview -> main 5c67db0130e3b24efe2db9c71f2ece02c096a2f8
```

Secrets ausentes comprovados:

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Como o credential gate falhou, ficaram `SKIPPED`:

- migration policy de release;
- instalação das CLIs externas;
- `vercel pull`;
- Production build;
- staged deployment;
- Supabase overlay;
- migration dry-run/apply/history verification;
- advisors;
- staged smoke;
- `vercel promote`;
- canonical smoke;
- release receipt.

Logo, a primeira execução governada provou que **provenance é validada antes de qualquer operação cloud/database** e que ausência de credenciais mantém Production intacta.

### Production Vercel ainda não rastreável pela nova esteira

Foi observado um deployment Production criado fora da nova esteira durante o bootstrap. O domínio permaneceu saudável, mas:

```text
/api/health.commit = null
/api/version.commit = null
/api/version.release = null
```

Isso significa que a Production atual ainda não é a primeira release rastreável da nova esteira. O objetivo da primeira execução completa é substituir esse estado por SHA e release explícitos.

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

Não colocar o valor em repository variable, arquivo `.env` versionado, PR, issue ou input de workflow.

### Reexecutar Preview depois do secret

Depois de cadastrar `VERCEL_TOKEN`, reexecutar o Preview CD falho ou provocar um novo CI verde na `Preview`.

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

### Proteção adicional do Environment

Se o plano/repositório permitir reviewers/deployment protection, Production pode exigir aprovação administrativa antes do job usar secrets.

Isso é defesa adicional e não substitui:

- `Preview -> main`;
- Promotion Policy;
- provenance gate do `production.yml`;
- staged deployment;
- migration gates;
- smoke antes de `vercel promote`.

## Branch `Preview` é persistente

`Preview` não é feature branch descartável. Ela é um ambiente lógico e a origem canônica de promoção para `main`.

### Incidente de bootstrap

Após o merge da PR #149 (`Preview -> main`), a branch `Preview` desapareceu automaticamente. Isso é compatível com a opção de repositório que remove head branches depois do merge.

A branch foi recriada a partir do HEAD de `main`:

```text
5c67db0130e3b24efe2db9c71f2ece02c096a2f8
```

Nenhum force push foi necessário.

### Defesa versionada — `Preview Branch Guard`

O workflow:

```text
.github/workflows/preview-branch-guard.yml
```

escuta eventos `delete` e só reage quando:

```text
ref_type = branch
ref = Preview
```

Se `Preview` estiver realmente ausente, lê o HEAD atual de `main` e recria:

```text
refs/heads/Preview -> current main SHA
```

Se a branch já tiver reaparecido, o workflow termina sem alteração.

O guard existe como **fallback de recuperação**, não como substituto da configuração administrativa correta.

### Configuração administrativa recomendada

Preferir uma das duas soluções, idealmente ambas quando suportadas:

1. desabilitar a exclusão automática de head branches para o fluxo que usa `Preview` como branch persistente;
2. proteger `Preview` contra deletion via branch protection/ruleset.

Depois disso, o `Preview Branch Guard` permanece como defesa adicional contra remoção acidental.

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
- **block deletions**;
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

Mesmo se a proteção administrativa estiver ausente, `production.yml` não publica um SHA sem provenance de `Preview -> main`.

## Primeira homologação real

Depois de configurar `preview/VERCEL_TOKEN`:

1. garantir que `Preview` existe;
2. reexecutar Preview CD;
3. confirmar deployment Vercel `READY`;
4. confirmar SHA e release em `/api/health` e `/api/version`;
5. abrir Home e `/sessoes`;
6. verificar runtime errors de Preview;
7. registrar deployment/evidência;
8. somente então considerar a homologação cloud concluída.

## Primeira Production completa pela nova esteira

Pré-condições:

- Preview real homologada;
- `production` contém os três secrets;
- promoção `Preview -> main` válida;
- SHA de merge é o HEAD atual da `main`.

A #149 já provou o provenance gate, mas não executou cloud/database porque os três secrets estavam ausentes.

Uma execução completa deve executar nesta ordem:

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

### Production falha em `Validate release credentials`

Cadastrar os secrets indicados no Environment `production`. O workflow informa os nomes ausentes, nunca valores.

### `Preview` desaparece após `Preview -> main`

1. verificar se `Preview Branch Guard` recriou a branch;
2. confirmar que o SHA restaurado corresponde ao HEAD de `main`;
3. revisar `Settings` para exclusão automática de head branches;
4. aplicar proteção contra deletion em `Preview`;
5. não recriar a branch via force push.

### Branch ainda mostra `protected=false`

A proteção administrativa não foi configurada ou não entrou em vigor. Revisar Rules/Rulesets/Branches no GitHub. O provenance gate de Production continua obrigatório independentemente desse status.

## Critério de 100% operacional

A esteira só pode ser marcada como 100% quando todos forem verdadeiros:

- [x] CI/Companion verdes em Preview e main;
- [x] fluxo canônico `Preview -> main` exercitado pela PR #149;
- [x] Production CD provou provenance da PR #149;
- [x] ausência de secrets bloqueia antes de qualquer operação Vercel/Supabase;
- [x] documentação operacional, ADR e runbook administrativo integrados;
- [x] `Preview` possui fallback de autorrecuperação versionado;
- [ ] `preview/VERCEL_TOKEN` configurado;
- [ ] Preview CD cria deployment real e passa smoke com SHA/release corretos;
- [ ] `production/VERCEL_TOKEN` configurado;
- [ ] `production/SUPABASE_ACCESS_TOKEN` configurado;
- [ ] `production/SUPABASE_DB_PASSWORD` configurado;
- [ ] Production overlay/dry-run/history gate passam numa execução real;
- [ ] staged Production smoke passa;
- [ ] o mesmo artefato staged é promovido;
- [ ] `dnd.faysk.dev/api/health` e `/api/version` mostram o SHA/release promovidos;
- [ ] rollback possui candidate conhecido e validado;
- [ ] branch protection/rulesets estão configurados administrativamente ou a exceção é explicitamente aceita/documentada;
- [ ] exclusão automática de `Preview` foi desativada ou bloqueada por protection; o guard fica como fallback.

Não declarar 100% antes disso.
