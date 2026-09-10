# CI/CD — operação, bootstrap e gates

> Status: vigente
> Owner: operations / release / dados
> Última revisão: 2026-09-10

## Objetivo

Este documento é o runbook canônico da esteira de entrega do TDA. Ele define branches, workflows, gates, credenciais esperadas, ordem de ativação, verificações, falhas esperadas e recuperação.

A decisão arquitetural que sustenta este runbook está no [ADR-0012](../adr/0012-github-actions-controlled-delivery.md).

Princípio central:

> **Merge não publica Production.** GitHub Actions controla a entrega e a integração Git da Vercel permanece sem auto-deploy.

## Topologia

```text
feature/*
  |
  v
PR -> Preview
  |
  +--> CI
  +--> Companion
  |
  v
Preview CD (quando armado)
  |
  v
Homologação
  |
  v
PR Preview -> main
  |
  +--> Promotion Policy
  +--> CI
  +--> Companion
  |
  v
Production CD (quando armado)
  |
  +--> build Production
  +--> deploy staged --skip-domain
  +--> Supabase overlay + gates
  +--> staged smoke
  +--> vercel promote
  +--> canonical smoke
  +--> release receipt
```

## Branches

### `Preview`

Representa o candidato de homologação.

Regras:

- no fluxo normal recebe PRs de branches temporárias;
- CI deve passar no HEAD exato;
- Preview CD publica somente quando ativado;
- não executa `db push` na Production;
- não altera `dnd.faysk.dev`.

### `main`

Representa o candidato aprovado para Production.

Depois do bootstrap:

- PR normal para `main` deve ser `Preview -> main`;
- o check `promotion-source` deve ser exigido;
- Production CD usa somente o HEAD atual de `main`;
- source SHA stale/arbitrário é recusado.

## Workflows

### `.github/workflows/ci.yml`

Responsabilidades:

- instalar dependências de forma reproduzível;
- validar migration safety policy;
- executar checks de mídia/documentação/código;
- build;
- Playwright/E2E;
- processing tests;
- PostgreSQL scratch para testes de banco.

CI é gate de código, não autorização de deploy.

### `.github/workflows/companion.yml`

Valida o local companion e contratos associados. Deve acompanhar o mesmo SHA candidato quando a release inclui mudanças nessa área.

### `.github/workflows/promotion-policy.yml`

Em PR para `main`, aplica a política de origem quando:

```text
TDA_ENFORCE_PROMOTION_SOURCE=true
```

Com enforcement ativo, somente `Preview -> main` é aceito.

Durante bootstrap a variável pode permanecer ausente/false para permitir a integração inicial da infraestrutura.

### `.github/workflows/preview.yml`

Executa apenas se as duas condições forem verdadeiras:

```text
TDA_CICD_BOOTSTRAP_READY == true
TDA_PREVIEW_CD_ENABLED == true
```

Fluxo:

1. resolve HEAD de `Preview`;
2. recusa source SHA diferente do HEAD;
3. faz checkout detached do SHA resolvido;
4. instala Vercel CLI pinada;
5. puxa configuração de Preview;
6. constrói artefato;
7. publica deployment imutável;
8. valida `/api/health`, `/api/version`, `/` e `/sessoes`;
9. registra summary do run.

### `.github/workflows/production.yml`

Executa apenas se:

```text
TDA_CICD_BOOTSTRAP_READY == true
TDA_PRODUCTION_CD_ENABLED == true
```

Production é staged e fail-closed.

Fluxo resumido:

1. resolve HEAD de `main`;
2. recusa source SHA stale/arbitrário;
3. valida credenciais e migration policy;
4. constrói Production;
5. publica com `--skip-domain`;
6. prepara overlay Supabase;
7. valida boundary/history;
8. executa dry-run;
9. aplica migrations pendentes;
10. verifica history exato pós-apply;
11. executa advisors;
12. faz smoke do staged deployment;
13. promove o mesmo deployment para `dnd.faysk.dev`;
14. faz canonical smoke;
15. coleta scan de erros;
16. registra GitHub Release receipt.

### `.github/workflows/rollback.yml`

Rollback é manual e fica disponível mesmo quando a trava de bootstrap está desligada.

Isso é intencional: uma trava de bootstrap não deve bloquear recuperação de uma Production já existente.

Exige:

- deployment target explícito;
- confirmação exatamente `ROLLBACK_TDA`;
- `VERCEL_TOKEN` de Production.

Banco não sofre rollback automático.

## GitHub Environments

### Environment `preview`

Secret esperado:

```text
VERCEL_TOKEN
```

### Environment `production`

Secrets esperados:

```text
VERCEL_TOKEN
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Secrets não devem ser duplicados em documentação, issue, comentário, workflow log ou variável pública.

## Repository variables

### `TDA_CICD_BOOTSTRAP_READY`

Trava mestra.

Somente definir como `true` depois de:

- `Preview` alinhada;
- GitHub Environments criados;
- secrets configurados;
- workflows integrados;
- CI verde no estado integrado.

### `TDA_PREVIEW_CD_ENABLED`

Habilita Preview CD, desde que a trava mestra também esteja ativa.

### `TDA_PRODUCTION_CD_ENABLED`

Habilita Production CD, desde que a trava mestra também esteja ativa.

Não ativar antes da primeira homologação real de Preview.

### `TDA_ENFORCE_PROMOTION_SOURCE`

Quando `true`, PR para `main` precisa vir de `Preview`.

Ativar depois que a topologia estiver operacional e `Preview` tiver sido alinhada.

## Ordem correta de bootstrap

A ordem é parte do contrato. Não inverter apenas porque “parece dar na mesma”.

### Fase 1 — infraestrutura no Git

- [x] integrar workflows de CI/CD;
- [x] manter Git auto-deploy da Vercel desligado;
- [x] adicionar trava mestra;
- [x] validar CI na PR;
- [x] validar CI após integração na `main`;
- [x] confirmar que Production CD fica `skipped` enquanto desarmado.

### Fase 2 — alinhar branches

- [x] confirmar que `Preview` antiga é ancestral de `main`;
- [x] atualizar `Preview` por fast-forward, sem force;
- [x] disparar CI/Companion no SHA alinhado.

### Fase 3 — configuração administrativa

- [ ] criar/confirmar Environment `preview`;
- [ ] criar/confirmar Environment `production`;
- [ ] cadastrar secrets mínimos;
- [ ] revisar permissões/approvals dos Environments;
- [ ] configurar branch/ruleset protection para `Preview` e `main`;
- [ ] exigir checks adequados.

Esta conexão de automação pode não possuir permissão para ler/escrever essas superfícies administrativas. Nesse caso, a ausência de acesso deve ser tratada como **não verificada**, nunca como “já configurado”.

### Fase 4 — armar Preview

Somente após Fase 3:

1. `TDA_CICD_BOOTSTRAP_READY=true`;
2. `TDA_PREVIEW_CD_ENABLED=true`;
3. manter `TDA_PRODUCTION_CD_ENABLED` ausente/false;
4. fazer mudança controlada em `Preview` ou dispatch explícito do HEAD atual;
5. validar deployment URL;
6. validar `/api/health`;
7. validar `/api/version`;
8. validar Home e `/sessoes`;
9. revisar runtime errors;
10. homologar manualmente.

### Fase 5 — enforcement de promoção

Depois do Preview real funcionar:

```text
TDA_ENFORCE_PROMOTION_SOURCE=true
```

Confirmar que:

- PR `Preview -> main` passa;
- PR de outra branch diretamente para `main` falha no `promotion-source`.

### Fase 6 — armar Production

Somente após homologação explícita:

```text
TDA_PRODUCTION_CD_ENABLED=true
```

Primeira release deve ser acompanhada passo a passo no workflow.

## Supabase — boundary e overlay

Project ref canônico:

```text
dmrqnbdvbkfqzctcerbx
```

Boundary do reboot TDA:

```text
20260906210333
```

Tudo anterior ao boundary pode pertencer ao legado remoto e não precisa existir neste repo.

Tudo a partir do boundary precisa respeitar o conjunto autoritativo de `supabase/migrations`.

### Preparação do overlay

Production cria um workdir descartável no runner e executa:

```text
supabase init
supabase link
supabase migration fetch
```

O history remoto é usado apenas para dar contexto completo à CLI.

Depois:

- lista migrations remotas;
- lista migrations TDA do repo;
- recusa filename deployável inválido;
- recusa migration local anterior ao boundary;
- recusa migration remota TDA-era ausente do repo;
- copia os SQL autoritativos do repo sobre o overlay.

### Dry-run

Antes de qualquer apply:

```text
supabase db push --dry-run --skip-vault
```

Falha aqui encerra a release.

### Apply

O apply usa o mesmo overlay e somente migrations autorizadas.

### Verificação pós-apply

O workflow apaga a cópia de migrations do overlay, faz novo `migration fetch` e compara novamente.

O conjunto remoto a partir do boundary deve ser **exatamente igual** a `supabase/migrations`.

Diferença para qualquer lado falha a release antes da troca de tráfego.

### Advisors

Advisors rodam depois da verificação de migration history. Findings existentes podem representar baseline conhecido, mas novos findings relevantes precisam ser avaliados; não transformar advisor em decoração de Natal do log.

## Vercel — contrato operacional

Team ID pinado:

```text
team_9wuTfarCQ3L63xtufPKUDzi0
```

Project ID pinado:

```text
prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
```

Domínio canônico:

```text
https://dnd.faysk.dev
```

A integração Git deve continuar sem auto-deploy.

### Preview

Deployment direto do artefato de Preview. Nenhum alias Production é alterado.

### Production

Deployment inicial usa:

```text
--prod --skip-domain
```

Esse deployment é o candidate testável.

Somente depois de banco + smoke:

```text
vercel promote <deployment>
```

O mesmo deployment validado recebe tráfego canônico.

## Smoke gates

### Preview

Obrigatório:

- `/api/health` retorna `ok=true`;
- `environment=preview`;
- commit corresponde ao source SHA;
- `/` responde;
- `/sessoes` responde.

### Production staged

Obrigatório:

- `/api/health` retorna `ok=true`;
- `environment=production`;
- commit corresponde ao source SHA;
- `/api/version` possui release esperada;
- `/` responde;
- `/sessoes` responde.

### Production canônica

Depois do promote:

- `/api/health` responde no domínio oficial;
- `/api/version` corresponde à release recém-promovida;
- Home responde;
- nenhum redirect normal escapa para alias `*.vercel.app`.

## Release receipt

Após sucesso total, Production registra GitHub Release com ID:

```text
prod-<12-char-short-sha>
```

O receipt precisa conter ao menos:

- source SHA;
- release id;
- staged/tested deployment;
- domínio canônico;
- Supabase project ref;
- migration overlay/history gate;
- dry-run;
- apply/verificação;
- staged smoke;
- canonical smoke.

## Falhas e resposta operacional

### Production CD `skipped`

Primeiro verificar gates de ativação. Durante bootstrap, `skipped` é comportamento correto.

### Source SHA recusado

A branch avançou depois que o evento foi criado ou houve dispatch com SHA arbitrário. Reexecutar a partir do HEAD atual; não desabilitar o guard.

### Secret ausente

Corrigir no GitHub Environment correspondente. Não passar secret por input/manual env no workflow.

### Migration TDA-era remota desconhecida

Abortar. Investigar quem alterou o history/schema e reconciliar deliberadamente antes de novo deploy.

### Dry-run falha

Não aplicar manualmente “só para ver”. Corrigir migration/estado e repetir o ciclo.

### Apply passa mas history exato falha

Não promover tráfego. Investigar migration history remoto antes de prosseguir.

### Staged smoke falha

Não promover. O domínio oficial deve continuar na release anterior.

### Promote passa e canonical smoke falha

Tratar como incidente de release. Se o candidate anterior é conhecido como bom e compatível com o schema atual, usar rollback manual.

### Advisor encontra dívida conhecida

Comparar com baseline documentado. Findings conhecidos não significam sucesso automático; findings novos precisam de classificação.

## Rollback

### App-only

Usar `Production Rollback` com deployment conhecido como bom e confirmação `ROLLBACK_TDA`.

### Banco backward-compatible

É permitido retornar o app mantendo schema mais novo quando contrato anterior permanece válido.

### Banco não backward-compatible

Não fazer rollback cego do app. Criar correção/compatibilidade deliberada.

### Conteúdo/mídia

Rollback do app não implica apagar objetos R2 ou reverter publicação de dados. Tratar audience/publication separadamente.

## Evidência do bootstrap de 2026-09-10

### Integração inicial

A PR #129 introduziu a esteira e foi integrada à `main` por squash.

Na validação do commit de integração:

- CI passou integralmente;
- Companion passou;
- Production CD foi criado pelo `workflow_run` e terminou `skipped`;
- nenhuma DDL foi executada por esse merge;
- Vercel não criou deployment Git automático;
- Production canônica permaneceu no release anterior;
- `/api/health` continuou saudável;
- `/api/version` permaneceu ausente na release antiga, confirmando que o código novo não havia sido publicado.

### Migration history observado

Após o merge, o Supabase continuou com:

```text
TDA migrations a partir do boundary: 13
boundary: 20260906210333
latest: 20260910012546
```

Esse dado é evidência temporal de bootstrap, não uma constante eterna. Novas migrations legítimas devem aumentar o conjunto.

### Alinhamento de Preview

Em 2026-09-10, antes do alinhamento, `Preview` apontava para `7305109d84cb5ce70eee07deabbc0b821f50f218` e era ancestral direta da `main`.

A branch foi atualizada por **fast-forward com `force=false`** para o HEAD então atual da `main`:

```text
bb57edd6d8ea837be04a8979cfd938ec306e7945
```

A operação foi aceita pelo GitHub sem force, portanto não reescreveu histórico divergente de `Preview`.

O update disparou CI e Companion para o SHA alinhado. O resultado terminal desses runs deve ser registrado no fechamento desta mesma alteração documental antes de considerar o bootstrap operacional encerrado.

## Checklist de manutenção

Quando alterar a esteira:

- [ ] atualizar ADR se a decisão estrutural mudou;
- [ ] atualizar este runbook se o procedimento mudou;
- [ ] manter versões de CLI/actions pinadas conscientemente;
- [ ] validar sintaxe real das CLIs pinadas;
- [ ] revisar permissões GitHub do workflow;
- [ ] revisar secrets mínimos;
- [ ] garantir que Preview não recebe write irrestrito de Production;
- [ ] garantir que `main` não publica automaticamente pela Vercel Git integration;
- [ ] executar CI completo no SHA alterado;
- [ ] registrar mudança operacional relevante.

## Critério de “100% operacional”

A infraestrutura versionada está completa quando:

- workflows estão integrados;
- branches estão alinhadas;
- CI/Companion passam;
- guards impedem deploy durante bootstrap;
- documentação e ADR estão integrados.

A entrega cloud está completamente **ativada** somente quando, além disso:

- Environments/secrets foram confirmados;
- branch protection/rulesets foram confirmados;
- Preview real foi publicado e homologado;
- promotion-source foi exigido;
- Production foi armada deliberadamente;
- primeira release Production completou migration gates + staged smoke + promote + canonical smoke + receipt.

Não chamar a segunda condição de concluída apenas porque o código da esteira existe.
