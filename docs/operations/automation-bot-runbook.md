# TDA — Runbook dos bots de manutenção e dependências

> Status: procedimentos observados e propostas futuras
> Owner: operations / governance / CI
> Última revisão: 2026-10-13
> **Referência:** [catálogo da frota](automation-bot-fleet.md), [epic #1651](https://github.com/Faysk/tda/issues/1651), [CI/CD](ci-cd.md), [release](release-runbook.md), [Companion](companion-dependency-policy.md).
> **Baseline inventariada:** `main@67cc21704639658679886d92514033213a528f17`.

## Invariantes antes de agir

1. **Não fazer merge para fazer teste.** Resolver, revisar, reproduzir e testar no PR. Ninguém deve contornar gates para produzir verde.
2. **Bot propõe; humano decide.** Não há autorização para auto-merge, refazer releases imutáveis, promover Stable nem Production.
3. **Tokens e secrets nunca entram no contexto de código/PR não confiável.** Não executar checkout de PR de terceiro em workflow privilegiado (especialmente com `pull_request_target`).
4. **Consistência por SHA.** Um check verde de outro SHA, rerun de commit anterior ou job `skipped` não prova elegibilidade.
5. **Windows/GPU/ASR.** Suíte Linux e smoke sintético não substituem aceite físico MSI/GPU dos bytes exatos.
6. **Não mexer em dados privados.** Nenhuma gravação, áudio Craig real, logs sensíveis, tabelas produtivas ou R2 necessário neste runbook.
7. **Produção deliberada.** `production-cd.yml` atual só por `workflow_dispatch`, com revisão/confirm explícitos. Preview automático de PR não autoriza promoção.

## 1. Triagem diária (procedimento humano hoje)

1. Abrir [Pull Requests](https://github.com/Faysk/tda/pulls) filtrando `author:app/dependabot`; registrar PR/head SHA, bibliotecas, semver, risco, CI e segurança.
2. Antes de triage, conferir a [política Dependabot](https://github.com/Faysk/tda/blob/main/.github/dependabot.yml) e ler `Files changed`; anotação automatizada do futuro Risk Analyst é auxiliar, não evidência de teste.
3. Se existe alteração de `pyproject.toml`, conferi-la contra `requirements-test.lock` e os gates de freshness; falha do lock exige corrigir **ambos**, não afrouxar `check-companion-dependency-freshness.py`.
4. Se existe alteração de `package.json` ou `pnpm-lock.yaml`, exigir lock congelado, build e suites condicionadas ao componente; Next/Supabase/AWS podem afetar várias áreas.
5. Se existe alteração em `.github/workflows/`, exigir revisão de triggers, `uses` pinado por SHA, actionlint e fronteira de tokens.
6. Separar `blocked-by-code`, `blocked-by-constraints`, `test-failure`, `transient-environment`, `security-review` e `needs-admin-evidence`. Guardar URL do run/step, e não só ícone.
7. Nenhuma decisão automática de fechamento/merge/dispatch neste estado. O [triage workstream #1661](https://github.com/Faysk/tda/issues/1661) registra decisões dos oito PRs existentes.

### Snapshot de problemas exemplares

| PR | Diagnóstico verificável | Conduta |
|---|---|---|
| [#1647](https://github.com/Faysk/tda/pull/1647) | [freshness 38202483008](https://github.com/Faysk/tda/actions/runs/38202483008) aponta `DIRECT_LOCK_MISMATCH:fastapi:0.143.0:0.142.4`; CI não resolve extras Python | manter bloqueado; atualizar lock coerente; inspecionar mudança OTEL; repetir Linux/Windows |
| [#1643](https://github.com/Faysk/tda/pull/1643) | [CI 38101781316](https://github.com/Faysk/tda/actions/runs/38101781316) registra dois Playwright failures de navegação | investigar com logs/artefatos e baseline comparativo; **não concluir causalidade Next** |
| [#1648](https://github.com/Faysk/tda/pull/1648) / [#1649](https://github.com/Faysk/tda/pull/1649) | CodeQL init/analyze atualizados separadamente | avaliar grupo coerente em #1654 antes de agir; SHA/versões iguais |
| demais #1644–#1646, #1650 | Updates tooling sem diagnóstico fechado no inventário | consultar checks/compatibilidade por head SHA; decisão após triage, não assumir verde |

## 2. Lock Python / Companion (`#1652`)

**Arquivos de verdade:** `local-companion/pyproject.toml` (pins diretos), `local-companion/requirements-test.lock` (constraints de testes), manifests por família ASR, `dependency-freshness-exceptions.json` e `tools/check-companion-dependency-freshness.py`.

**Antes de correção:** reproduzir com ambiente limpo Python 3.12 compatível; comparar dependências diretas e lock. Se `uv pip install -c local-companion/requirements-test.lock -e ./local-companion[test]` falhar por duas versões exatas, o comportamento correto do CI é reprovar. Não fazer `--no-deps` como contorno.

**[PROPOSTO]** Comando determinístico de regenerar lock em branch não privilegiada, validação de hash/diff e instalação Linux + Windows. Até esse comando existir, atualizar manualmente lock inteiro/constraints no PR de manutenção, revisando transitivas. Evitar atribuir o comportamento a limitação genérica do pip sem observar formato e backend usado.

**Gates mínimos:** freshness pin/exception, resolução uv, import/smoke, testes unitários e MSI/Win quando alterações alcançarem packaging. Se mudança afeta runtime HF/Whisper/Qwen, seguir runbook próprio e exigir artefato novo/impressão SHA; nunca reciclar Stable anterior.

## 3. npm/Next/Supabase/R2 e Playwright (`#1653` / `#1656`)

- **Next:** SSR, rotas, auth, navegação e builds são superfície crítica; ler documentação Next correspondente instalada antes de alterar código; E2E deve ser executado, não dado como skipped.
- **Supabase client:** boundary RLS/auth/campanhas; executar testes sintéticos/locais de contrato e isolamento; não chamar Supabase Production para conferir PR.
- **AWS SDK/S3-R2:** simular upload/read-back/hash/MIME nos testes; não criar nem apagar objetos privados.
- **Playwright:** validar runner, Chromium, fixtures e E2E; não comparar só typecheck.
- **pnpm:** preservar `--frozen-lockfile` e pin Node aprovado; registrar package/diff e impacto. Erro de teste deve ser investigado sem alegação de causa não demonstrada.

**[PROPOSTO]** separação de grupos críticos e matriz programável que exige jobs correspondentes por SHA, com safe default para mudança não classificada: revisão humana/gates completos.

## 4. GitHub Actions / CodeQL (`#1654` / `#1657`)

Verificar que toda Action externa conserva SHA completo no `uses`, comentário de versão (quando usado), publisher esperado e permissões mínimas. **Version pin da action e versão da ferramenta instalada são conceitos separados** (ex.: `astral-sh/setup-uv@SHA` vs `version: "0.12.18"`).

**[PROPOSTO]** agrupar CodeQL `init` + `analyze` pela mesma versão, evitando PRs redundantes. Testes de segurança de workflow e actionlint devem reprovar SHA/tag flutuante, triggers inseguros, shell injection via título/branch, artefatos de outro run e leitura de secrets por PR.

### Trust boundary: auditoria sintética versionada (#1657)

**Cobertura candidata:** `tools/ci/automation-trust-policy.mjs` analisa os YAML versionados e `tools/ci/automation-trust-policy.test.mjs` executa fixtures adversariais de regressão no `workflow-contract`. Esses testes protegem cinco controladores críticos: PR Preview, Main Preview, Companion RC, Runtime RC e Production CD. Eles falham quando os marcadores de identidade por SHA/PR, CI de origem, `push main`, confirmação humana ou a ordem de checagem antes de efeito externo são removidos. A auditoria genérica também rejeita `pull_request_target`, `secrets: inherit` e `permissions: write-all` nos workflows analisados. O verificador inclui uma **allowlist por workflow/escopo de escrita declarado**, identificando novas concessões como `contents: write`, `actions: write`, `issues: write`, `deployments: write`, `security-events: write` e scopes de attestation que exigem revisão explícita. Há uma permissão `actions: write` **em job próprio** de `qwen-runtime-package.yml`, não apenas no bootstrap legado; a política a registra sem ampliar privilégios.

**Esta verificação é estática.** Não significa que tokens de Environment, proteção remota da `main`, artifact-attestation, sandbox Vercel, bridge Stable legada ou todas as variantes de `workflow_dispatch` foram auditados dinamicamente. Esse trabalho continua em #1657/#1658/#1659/#1667/#1668. Um texto malicioso que somente preserve os marcadores ainda pode passar; revisar os diffs de workflows privilegiados manualmente permanece obrigatório. Nunca usar o resultado do teste isolado como autorização de release.

## 5. Status checks, proteção de branch e riscos de corrida (`#1658`)

Em 13/10, a API acessível retornou `main.protected=true`, mas a leitura detalhada falhou 403. **Somente maintainer com acesso administrativo** pode confirmar required status checks, reviewers, bypass e Environment approvals. Inventário não prova a política remota.

Checagem antes de qualquer mudança de automerge:
- required check existe e está na lista por **nome exato e source/app esperado**;
- job da **última cabeça SHA** terminou com `success`, não `skipped`, `cancelled`, `pending`, `missing`;
- branch protection aplicada inclusive a bot e maintainer; exceções e política de merge queue, se configurada, conhecidas;
- `preview deployed`, `CI success` e `production published` são estados distintos;
- bot não tem bypass, não usa PAT amplo e não revisa o próprio PR.

## 6. Workflow-run, candidatos e publicação (`#1659`)

**Estado vigente:** `production-cd.yml` manual, com gate de SHA da main, provenance PR, CI de push, Preview e confirmação humana. `companion-rc.yml` e `runtime-rc.yml` podem produzir **RCs imutáveis** a partir de triggers guardados; `companion-promote.yml` e `runtime-promote.yml` são caminhos distintos para Stable. Bridges antigas específicas de versão continuam sujeitas a verificação de lifecycle antes de remoção.

**Nunca executar deploy para testar bots.** Em unit tests enviar eventos mockados de PR falso, SHA divergente, `workflow_run` vindo de PR, erro de receipt ou artefato errado; **todos precisam rejeitar antes de side effects**. Teste de sucesso manual deve provar seleção da fonte correta e guardas sem publicar.

Se houver rollback real, seguir [release-runbook.md](release-runbook.md). Nenhum bot reconstrói arquivo de release imutável, reusa tag, ignora Authenticode/hashes ou promove candidato sem o recibo físico exato.

### Regressão de publicação: general Stable vs bridges históricas (#1659)

O contrato de teste `tools/ci/github-actions-security.test.mjs` agora contém verificações adicionais **sem executar release**. Ele separa os três publicadores gerais (`production-cd.yml`, `companion-promote.yml` e `runtime-promote.yml`) — que devem permanecer `workflow_dispatch` apenas, sem trigger por push/PR/CI, confirmação tipada, evidência de CI/Preview/receipts e checkout sem credenciais persistentes — dos três **bridges históricos de versões exatas** `Companion 0.3.9`, `Companion 0.3.16` e `Qwen 1.0.12`. Estes bridges têm triggers de recuperação específicos, não servem para upgrades novos e não podem perder as fences de versão, main, SHA ou ancestry. O bootstrap Qwen 1.0.12 segue limitado a mudança no próprio YAML, com run e SHA fixos.

Fixtures negativas simulam introduzir `push` em Production, `workflow_run` em Stable geral, retirar aprovação tipada, retirar receipt, desviar a versão de bridge ou alargar os paths do bootstrap. Cada mudança deve reprovar sem publicação real. **Limite:** strings do YAML não substituem inspeção semântica, proteção remota, verificação física ou replay de workflow em ambiente não produtivo. Provas de hashes e attestations pertencem também à #1667.

## 7. Segurança, advisories e lifecycle (`#1663` / `#1667` / `#1668`)

- Priorizar security alerts independentemente de cooldown de versão comum. Ausência de acesso aos advisories = `unknown`, nunca `secure`. Formalizar SLAs com dono antes de implementar notificação.
- Capturar fonte do advisory, dependência afetada e caminho de exposição; não classificar tudo como vulnerabilidade explorável.
- Não apagar workflow de bridge/rollback só porque contém um número antigo; primeiro conferir último run, estado habilitado, referenciação por outros workflows, artifacts/tags e aceites históricos.
- Incompatibilidade de token, fork, workflow_run, action SHA ou artifact hash é erro bloqueante; não consertar com credencial mais poderosa por padrão.
- Segredos operacionais devem permanecer em GitHub Environments; não copiá-los para Cloud provider nem publicar traces em comentários.

### Risk Analyst determinístico no CI (#1660) — candidato

O script `tools/ci/bot-dependency-risk.mjs` analisa **somente o diff Git local** que o `classify-changes` já utiliza, sem chamada à API de advisories, sem execução de LLM e sem permissão de escrita. Quando `package.json`, `pnpm-lock.yaml`, `local-companion/pyproject.toml`, `requirements-test.lock` ou um workflow YAML muda, o script compara pins diretos npm/Python, registra alteração de lock-only como risco desconhecido alto e marca workflows como alterações de trust boundary. Gera um **Step Summary** legível, com o intervalo Git e os motivos por pacote; não comenta automaticamente no PR.

**Limites deliberados:** escala `low/medium/high` descreve **impacto de revisão**, não severidade CVE; o relatório traz `checks=not-queried` e `advisories=not-queried`, não declara pacote seguro nem CI verde. Manifestos diferentes/invalidos devem falhar explicitamente; versões não SemVer recebem `unknown` e exigem revisão. A classificação não substitui gates por domínio, triagem de vulnerabilidade, bundle runtime, Windows/GPU ou branch protection remota. Recomendação é sempre `human-review-required` quando existe update. O runner usa somente git/Node já presentes no CI; no futuro, #1660 pode compor resultados dos checks via um collector read-only por SHA.

Testes sintéticos de referência: `node --test tools/ci/bot-dependency-risk.test.mjs`. Para observação, ler o Job Summary de `classify-changes` no run CI do PR, não logs privados.

## 8. Automação futura: ciclo idempotente

**[PROPOSTO]** Ações de triagem e reporte podem ser implementadas por jobs GitHub-native. O ciclo deve ser: ingestão read-only → normalização → classificação determinística → consulta a checks por head SHA → comentário/check idempotente → triage. Nenhum modelo de IA toma decisão de publicação. Secrets, logs privados e payloads sensíveis nunca vão para prompt externo.

**Fingerprint recomendado:** repo + PR + head SHA + conjunto normalizado de deps + versão da regra. Distinguir evento reentregue, rerun do mesmo SHA, rebase com novo SHA e resolução de advisory. Usar backoff/rate limit e atualizar um único comentário assinado pelo bot quando apropriado. Em falha de API, preservar `unknown/blocked` e link para investigação.

**Auto-merge [DESLIGADO]:** issue #1662 exige autorização posterior, prova de regras administrativas, testes adversariais e denylist. Não iniciar com auto-merge nem adicionar token com capacidade de passar por cima dos checks.

### Simulador local de elegibilidade — #1662 (somente dry-run)

`node tools/ci/automerge-dryrun.mjs caminho/fixture-local.json` aceita somente uma fixture JSON explícita (um PR ou lista de até 100 PRs), devolve **decisão simulada determinística** e não importa `gh`, não consulta GitHub, não recebe token, não comenta, não fecha, não aprova nem executa merge. O arquivo de entrada é **não autenticado**; por isso até a classe `hypothetical-low-risk-candidate` devolve `authorized_to_merge=false` e `action=no-merge-dry-run`. Nunca usar a saída para alimentar diretamente `gh pr merge`.

A versão inicial só analisa patches SemVer exatos (ex.: `3.1.2 → 3.1.3`) de `prettier`/`eslint-config-prettier` em `devDependencies`, com changeset limitado a `package.json` + `pnpm-lock.yaml`. Libs de runtime, Auth/R2, engines, GitHub Actions, migrations, MSI, caminhos desconhecidos e lock sem comprovação bloqueiam. Mesmo hipoteticamente elegíveis precisam de evidência **independente e específica do SHA**: jobs únicos em `success`, inspeção integral de checks, advisories realmente verificadas, integridade lock, freshness, branch protection **confirmada por admin**, reviews e opt-in específicos. Esses campos de fixture **não são prova real**, porque qualquer pessoa pode escrever JSON fictício.

Execução de regressão: `node --test tools/ci/automerge-dryrun.test.mjs`, com fixtures sintéticas de SHA stale, check skipped, origem fork, alterações críticas, advisory incerto, bypass de approval e oito cenários que simulam os PRs históricos Dependabot (#1643–#1650). Habilitar auto-merge real requer **nova autorização expressa**, revisão da política da branch (#1658), segurança (#1657), plano de rollback e workflow separado que implemente verificações autenticadas. Este PR não contém esse workflow.


### Observer / ledger de checks por SHA (#1664) — candidato read-only

O workflow `dependabot-evidence-ledger.yml` é candidato a executar quando um run de CI de PR termina (`workflow_run: CI completed`). **Somente checkout do código da branch padrão revisada**, nunca da branch do Dependabot/fork. Permissões explícitas `contents/actions/pull-requests: read`, sem token de escrita, comments, annotations falsas, release, deploy ou merge. Ele valida o run real pela API, a identidade de **um** PR Dependabot, a origem de mesmo repositório, o SHA atual da cabeça e os jobs `classify-changes`, `workflow-contract`, `validate`, `ci-gate`, `required-ci` do **run exato**, e consulta CodeQL no SHA e PR correspondentes. Uma falha/skipped/missing/ambiguous/stale bloqueia `core-ci-verified-external-checks-unverified` (estado que prova **somente os jobs-base do CI e CodeQL**, não todos os checks, freshness ou regras da branch). Se CodeQL não terminou, marca `pending-or-unknown`.

**Reconsulta:** após CodeQL terminar, um maintainer pode usar o próprio workflow com `workflow_dispatch` e o ID do CI run, sem atualizar o estado do PR. A saída é **apenas GitHub Step Summary** do run observado (não comentário nem aprovação). Erros de API, paginação incompleta e identidade ambígua falham fechado. A issue #1658 continua dona da prova de branch protection remota e #1663 dos alertas/SLA/idempotência; nenhum estado deste ledger substitui aprovações ou gates exigidos pela branch.

**Validação sintética:** `node --test tools/ci/bot-evidence-ledger.test.mjs` cobre CI verde completo, SHA stale, fork, autor/origem errados, check ausente/skipped/duplicado, CodeQL atrasado/falhando e sanitização do Markdown. Se CodeQL estiver ausente apesar de um CI verde, **não** imprimir que o PR foi aprovado.

### Triage Marshal / digest offline (#1663) — classificação sem side effects

O módulo `tools/ci/dependency-triage.mjs` pode gerar relatório legível a partir de um **snapshot sintético JSON local**: `node tools/ci/dependency-triage.mjs /caminho/para/snapshot.json`. Ele **não consulta a API GitHub**, não lê secrets, não utiliza LLM, não modifica PR/issue/check, não agenda mensagens e não faz `merge`, `dispatch` ou deploy. Sua finalidade é validar regras e fingerprints antes da etapa futura de integração real com um collector read-only por SHA. Cada fingerprint usa `repo+PR+head SHA+causa+versão da política`, incluindo severidade/ID da advisory confirmada e nomes dos jobs falhos ordenados; entregas repetidas sem alteração devolvem exatamente o mesmo fingerprint, mudanças de SHA/causa exigem novo registro. O Markdown mostra apenas metadados mínimos, sem payloads privados.

Ordem de classificação: `stale` se identidade/PR atual não está comprovada; `security-critical` para advisory `critical/high` **confirmada no SHA**, independentemente de cooldown ou CI; `needs-human` para advisory `medium/low` conhecida; `blocked-by-lock` para divergência determinística direta entre manifest e lock; `failed-tests` para CI vermelho/cancelado/timeout **sem reclassificar falha de navegador como CVE**; `needs-human` quando advisories, lock, CI ou CodeQL estão ausentes/stale/unknown; e `ready-for-review` somente com evidências centrais completas e atuais. O último rótulo **não equivale a merge-readiness** (regras administrativas, checks adicionais e approvals não são validados aqui).

Regressões sintéticas: `node --test tools/ci/dependency-triage.test.mjs` (12 casos) testa eventos duplicados, SHA/rebase, mudanças de causa, advisory crítica e não crítica, lock drift, CI com falha sem falsa vulnerabilidade, e oito snapshots simulados dos PRs #1643–#1650. O canal de alerta e SLAs reais de #1663 continuam **não definidos** até decisão do owner, acesso à API e revisão de privacidade/retention. **Não usar um digest local como prova de ausência de vulnerabilidades**.

## 9. Evidência, testes sintéticos e definition of done

Contrato mínimo por mudança: PR + SHA, diff/manifest/lock, relatório de risco versão N, lista de required checks com IDs e estados, testes locais/CI, falhas negativas exercitadas, comentários idempotentes, documentação dona, aceite físico quando aplicável e decisão de release.

**Fixtures de [#1665](https://github.com/Faysk/tda/issues/1665) — [PROPOSTO]:** PR patch, major, lock mismatch, CVE duplicada, CodeQL init/analyze divergentes, evento de fork, workflow_run forjado, SHA stale, job skipped, artefato adulterado, prompt injection em release notes, API rate-limited, R2 mock/readback, modelo HF com revision antiga e receipt físico ausente. Resultado esperado: classificação + bloqueio seguro + **zero efeito colateral**.

**Se não conseguir provar um estado, registrá-lo:** implementado no YAML, executado em teste sintético, comprovado via run remoto e aceito fisicamente são quatro coisas diferentes.

## 10. Rotina de revisão e observabilidade

| Quando | Responsável lógico | Verificar | Evidência |
|---|---|---|---|
| A cada PR | Risk + Gatekeeper | changed deps, lock, run por SHA, origem | PR/check |
| Daily se acionado | Scout + Triage | advisories, freshness, falhas novas | issue/check, sem spam |
| Semanal [PROPOSTO] | Maintainer | aging PRs, retry causa, SLAs e exceções | digest curto |
| Antes de release | Release Sentinel + humano | SHA/Preview/receipts físicos/approval | receipt por versão |
| Ao mudar workflow | Security + docs owner | trigger, permissions, audience, path filters, rollback | contract tests + PR |

**Indicadores** [PROPOSTO]: PRs por risco, tempo até triage, recorrência de lock mismatch, tempo até atualizar CVE, taxa de job skipped/missing, custo/tempo CI e falhas por workflow. Não prometer métricas históricas inexistentes.

## Fontes de verdade

- [AGENTS.md](../../AGENTS.md) — policy de código, provider e publicação.
- [docs/delivery/issue-governance.md](../delivery/issue-governance.md) — labels/priority/issue ownership.
- [docs/operations/companion-dependency-policy.md](companion-dependency-policy.md) — versões Windows/ASR/HF e exceções.
- [docs/operations/release-runbook.md](release-runbook.md) — Production, Stage, receipts e rollback.
- [GitHub — Dependabot options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
- [GitHub — security updates groups](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/customizing-dependabot-security-prs).
- [GitHub — automating Dependabot](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions).

**Atualização deste runbook deve acompanhar PRs que mudam scripts de bot, regras de avaliação, gatilhos, fluxos de release ou caminhos de recuperação.**
