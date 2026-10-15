# Continuidade do backlog — 15/10/2026

> Status: candidato reconciliado; validação local, sem integração/publicação
> Owner: operations / governance / CI
> Baseline remota: `main@256e45b5ffddc1196b149f7c29c0da8eb3e0998e`; base reconciliada `67b3480f5f4837c5f3f1f0d3e3708ecce5361333`.

## Resultado e limites

As linhas #1733 e #1736 foram reconciliadas preservando os contratos de Node, CodeQL Production/Main Preview e tracing de navegação. A correção test-only #1735 foi incorporada. Conflitos de ordenação foram resolvidos mantendo ambos os conjuntos de testes. Nenhum teste/gate foi removido.

Validação: `pnpm check` e `pnpm build` passaram em Node 24.20.0/pnpm 12.3.4. Os 242 testes `tools/ci/*.test.mjs` passaram em WSL Linux/Node 24.20.0; no Windows os casos que criam symlinks recebem EPERM da máquina e não foram considerados verdes. Os dez testes de desktop/watchdog passaram em Windows/Python 3.12 com requirements-test.lock. A suíte completa com FastAPI 0.143.1 resolveu e passou 1433 testes, com 17 skips previstos, em Windows/Python 3.12.13. Os 36 testes afetados de RC/compatibilidade/release passaram após os novos pins ASR. O teste de fixture de atestação agora usa basename portátil; o CLI de readiness usa fileURLToPath. `.gitattributes` preserva LF nos contratos e scripts, sem mudar o conteúdo dos YAML.

CI remoto do novo SHA, revisão independente, controles administrativos e aceites físicos continuam pendentes. Os dois casos históricos de navegação (Back/Forward e screenshot de contraste) passaram 15 repetições cada: 30/30 em Chromium desktop-1080p, com trace retido somente em falha. Reprodução local verde não estabelece causa raiz de intermitência em Linux CI.

## Freshness consultada em 15/10/2026

A auditoria PyPI/Hugging Face apontou FastAPI 0.143.1, CTranslate2 4.8.3 e Qwen NumPy 2.5.4. FastAPI e requirements-test.lock foram reconciliados para 0.143.1, com instalação uv constraints bem-sucedida. Os patches CTranslate2 4.8.3 e NumPy 2.5.4 agora estão preparados nos candidatos novos Whisper 1.1.13 e Qwen 1.0.21; constantes de RC foram sincronizadas. A auditoria de freshness passou sem novas exceções. Os 36 testes de compatibilidade/RC/release passaram; ainda faltam resolução Linux, packaging isolado e aceite físico dos bytes exatos. Nenhum RC foi publicado ou declarado suportado. Exceções já existentes de Torch, Transformers, PyAV, uv e Python foram preservadas. Os alertas Dependabot retornaram 403 com mensagem de recurso desabilitado; não há prova de ausência de CVEs. Code scanning retornou zero alertas abertos visíveis pela conexão, sem estender esse resultado a outras fontes.

## Proteções remotas observadas por API autenticada

GET branch protection agora foi autorizado pelo gh local; a limitação 403 anterior era da integração consultada, não do estado do repositório. Snapshot sanitizado:

| Controle | Estado observado | Consequência |
|---|---|---|
| Required status | `required-ci`, app 15368 | CodeQL não é check requerido separado |
| Branch atualizada | `strict=false` | atualização obrigatória antes do merge não aplicada |
| Reviews | zero aprovações; stale dismissal/last-push/code-owner false | revisão humana não é imposta por essa regra |
| Admin | enforce_admins=true | administradores incluídos no gate configurado |
| Force push/delete | false/false | bloqueados |
| Rulesets | lista vazia | proteção clássica acima continua existente |
| Auto-merge | allow_auto_merge=false | automerge desabilitado |
| Environments | preview/production sem protection_rules | sem required reviewers por Environment |

O owner confirmou nesta execução que mantém o repositório sozinho. Não exigir aprovação independente impossível; preservar publicação manual e checks, e preparar enforcement de CodeQL/freshness sem bypass. Endurecimento administrativo exige impacto e snapshot de recuperação antes de aplicar. Não executar merge sintético falho contra main para testar. Essa evidência não encerra #1658.

## Issues abertas: implementação e próximo aceite

| Issue | Estado de continuidade |
|---|---|
| [#1651](https://github.com/Faysk/tda/issues/1651) | Integração única preparada; falta CI/revisão e aceites das filhas. |
| [#1652](https://github.com/Faysk/tda/issues/1652) | Lockkeeper e repair/check #1670 incorporados; FastAPI atualizado a 0.143.1 com lock coerente; falta CI final. |
| [#1653](https://github.com/Faysk/tda/issues/1653) | Grupos npm #1671 incorporados e testes verdes; confirmar integração e novas propostas. |
| [#1654](https://github.com/Faysk/tda/issues/1654) | Grupos Actions/CodeQL #1671 incorporados e testes verdes; confirmar integração e propostas atômicas. |
| [#1655](https://github.com/Faysk/tda/issues/1655) | Patches ASR em candidatos versionados novos; freshness passou; gates de packaging/físico ainda pendentes. |
| [#1656](https://github.com/Faysk/tda/issues/1656) | Gates reconciliados e testes negativos locais verdes; falta CI exato. |
| [#1657](https://github.com/Faysk/tda/issues/1657) | Trust boundary e testes adversariais presentes; falta revisão independente. |
| [#1658](https://github.com/Faysk/tda/issues/1658) | API acessível; gaps reais documentados acima; enforcement não corrigido. |
| [#1659](https://github.com/Faysk/tda/issues/1659) | CodeQL completo/único e ordenação antes de efeitos presentes; falta CI exato e revisão. |
| [#1660](https://github.com/Faysk/tda/issues/1660) | Risk Analyst determinístico presente com negativos; falta integração. |
| [#1661](https://github.com/Faysk/tda/issues/1661) | Seis Dependabot PRs ainda abertos; falhas antigas não provam causalidade dos updates. |
| [#1662](https://github.com/Faysk/tda/issues/1662) | Simulador dry-run presente; auto-merge permanece desligado por decisão vigente. |
| [#1663](https://github.com/Faysk/tda/issues/1663) | Digest offline presente; canal/SLA e collector operacional ainda pendentes. |
| [#1664](https://github.com/Faysk/tda/issues/1664) | Ledger read-only presente; falta integração e execução operacional por SHA. |
| [#1665](https://github.com/Faysk/tda/issues/1665) | 238 testes de contrato verdes Linux; não substituem toda aceitação operacional. |
| [#1667](https://github.com/Faysk/tda/issues/1667) | Verificadores RC e negativos presentes; receipt físico e assets reais não validados nesta execução. |
| [#1668](https://github.com/Faysk/tda/issues/1668) | Inventário remoto e últimas execuções abaixo; nenhuma retirada autorizada/realizada. |
| [#1693](https://github.com/Faysk/tda/issues/1693) | Captura Chromium em repetição local; não declarar causa raiz pela ausência de falha. |
| [#1729](https://github.com/Faysk/tda/issues/1729) | Back/Forward em repetição local com trace em falha; diagnóstico Linux CI ainda necessário. |
| [#1734](https://github.com/Faysk/tda/issues/1734) | Deadline do watchdog incorporado; dez testes desktop verdes no Windows; CI Windows final pendente. |

## PRs abertos: mapa de incorporação

Incorporação por ancestralidade de commits não equivale a merge, aprovação ou check verde. PRs sem ancestralidade precisam de revisão do delta; #1735 foi cherry-picked. Candidatos/experimentos anteriores permanecem abertos até a decisão de consolidação.

| PR | Base | Estado na candidata | Falhas no snapshot remoto |
|---|---|---|---|
| [#1643](https://github.com/Faysk/tda/pull/1643) | `main` | delta independente / conferir | navigation-e2e, ci-gate, required-ci |
| [#1644](https://github.com/Faysk/tda/pull/1644) | `main` | delta independente / conferir | navigation-e2e, ci-gate, required-ci |
| [#1645](https://github.com/Faysk/tda/pull/1645) | `main` | delta independente / conferir | audit, navigation-e2e, ci-gate, required-ci |
| [#1646](https://github.com/Faysk/tda/pull/1646) | `main` | delta independente / conferir | navigation-e2e, ci-gate, required-ci |
| [#1647](https://github.com/Faysk/tda/pull/1647) | `main` | delta independente / conferir | audit, campaign-processing-integration, processing-e2e, campaign-isolation-regression-gate, benchmark-quality-gate, multi-recording-gate, session-workflow-gate, companion-domain / synthetic (windows-latest, .venv/Scripts/python.exe), companion-domain / synthetic (ubuntu-latest, .venv/bin/python), companion-domain / windows-installer (TDACompanion-x64.msi), ci-gate, required-ci |
| [#1650](https://github.com/Faysk/tda/pull/1650) | `main` | delta independente / conferir | audit, navigation-e2e, companion-domain / synthetic (windows-latest, .venv/Scripts/python.exe), ci-gate, required-ci |
| [#1670](https://github.com/Faysk/tda/pull/1670) | `main` | incorporado na reconciliação final | audit |
| [#1671](https://github.com/Faysk/tda/pull/1671) | `main` | incorporado na reconciliação final | nenhuma observada; conferir pendentes |
| [#1675](https://github.com/Faysk/tda/pull/1675) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1676](https://github.com/Faysk/tda/pull/1676) | `main` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1677](https://github.com/Faysk/tda/pull/1677) | `main` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1678](https://github.com/Faysk/tda/pull/1678) | `main` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1679](https://github.com/Faysk/tda/pull/1679) | `main` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1680](https://github.com/Faysk/tda/pull/1680) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1681](https://github.com/Faysk/tda/pull/1681) | `integration/1651-bot-controls-ci-security-evidence` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1682](https://github.com/Faysk/tda/pull/1682) | `feat/1662-automerge-policy-dryrun-only` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1683](https://github.com/Faysk/tda/pull/1683) | `integration/1651-bot-controls-ci-security-evidence` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1684](https://github.com/Faysk/tda/pull/1684) | `feat/1667-offline-rc-attestation-verifier` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1685](https://github.com/Faysk/tda/pull/1685) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1686](https://github.com/Faysk/tda/pull/1686) | `integration/1651-all-bot-supply-chain-controls` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1687](https://github.com/Faysk/tda/pull/1687) | `feat/1667-authenticated-rc-signer-run` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1688](https://github.com/Faysk/tda/pull/1688) | `feat/1667-unified-rc-evidence-audit` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1689](https://github.com/Faysk/tda/pull/1689) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1690](https://github.com/Faysk/tda/pull/1690) | `integration/1651-full-bot-and-rc-provenance-stack` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1691](https://github.com/Faysk/tda/pull/1691) | `fix/1667-runtime-rc-candidate-completeness` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1692](https://github.com/Faysk/tda/pull/1692) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1694](https://github.com/Faysk/tda/pull/1694) | `integration/1651-bots-rc-semantic-integrity` | ancestral incorporado | navigation-e2e, processing-e2e, session-editorial-e2e, companion-domain / synthetic (windows-latest, .venv/Scripts/python.exe), companion-domain / synthetic (ubuntu-latest, .venv/bin/python), companion-domain / windows-installer (TDACompanion-x64.msi), ci-gate, required-ci |
| [#1695](https://github.com/Faysk/tda/pull/1695) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1696](https://github.com/Faysk/tda/pull/1696) | `integration/1651-bots-rc-risk-analyst-safe` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1697](https://github.com/Faysk/tda/pull/1697) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1698](https://github.com/Faysk/tda/pull/1698) | `integration/1651-bots-rc-codeql-matrix-proof` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1699](https://github.com/Faysk/tda/pull/1699) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1700](https://github.com/Faysk/tda/pull/1700) | `integration/1651-bots-rc-observer-base-freshness` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1701](https://github.com/Faysk/tda/pull/1701) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1702](https://github.com/Faysk/tda/pull/1702) | `integration/1651-bots-rc-full-archive-proof` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1703](https://github.com/Faysk/tda/pull/1703) | `fix/1660-range-operator-classification` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1704](https://github.com/Faysk/tda/pull/1704) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1705](https://github.com/Faysk/tda/pull/1705) | `integration/1651-bot-trust-risk-and-rc` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1706](https://github.com/Faysk/tda/pull/1706) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1707](https://github.com/Faysk/tda/pull/1707) | `integration/1651-bots-package-config-lock-proof` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1708](https://github.com/Faysk/tda/pull/1708) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1709](https://github.com/Faysk/tda/pull/1709) | `integration/1651-bots-git-path-status-failclosed` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1710](https://github.com/Faysk/tda/pull/1710) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1711](https://github.com/Faysk/tda/pull/1711) | `integration/1651-bots-git-status-risk-parity` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1712](https://github.com/Faysk/tda/pull/1712) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1713](https://github.com/Faysk/tda/pull/1713) | `integration/1651-bots-pnpm-hook-patch-blast-radius` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1714](https://github.com/Faysk/tda/pull/1714) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1715](https://github.com/Faysk/tda/pull/1715) | `integration/1651-all-dependency-optional-gates` | experimento NEVER MERGE | nenhuma observada; conferir pendentes |
| [#1716](https://github.com/Faysk/tda/pull/1716) | `integration/1651-all-dependency-optional-gates` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1717](https://github.com/Faysk/tda/pull/1717) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1718](https://github.com/Faysk/tda/pull/1718) | `integration/1651-global-next-node-ci-self-gates` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1719](https://github.com/Faysk/tda/pull/1719) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1720](https://github.com/Faysk/tda/pull/1720) | `integration/1651-global-proxy-vercel-security-gates` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1721](https://github.com/Faysk/tda/pull/1721) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1722](https://github.com/Faysk/tda/pull/1722) | `integration/1651-vercelignore-unit-config-gate` | experimento NEVER MERGE | nenhuma observada; conferir pendentes |
| [#1723](https://github.com/Faysk/tda/pull/1723) | `integration/1651-vercelignore-unit-config-gate` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1724](https://github.com/Faysk/tda/pull/1724) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1725](https://github.com/Faysk/tda/pull/1725) | `integration/1651-nvm-node-runtime-parity` | delta independente / conferir | nenhuma observada; conferir pendentes |
| [#1726](https://github.com/Faysk/tda/pull/1726) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1727](https://github.com/Faysk/tda/pull/1727) | `integration/1651-production-codeql-receipt` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1728](https://github.com/Faysk/tda/pull/1728) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1730](https://github.com/Faysk/tda/pull/1730) | `integration/1651-main-preview-codeql-gate` | ancestral incorporado | companion-domain / synthetic (windows-latest, .venv/Scripts/python.exe), ci-gate, required-ci |
| [#1731](https://github.com/Faysk/tda/pull/1731) | `main` | ancestral incorporado | companion-domain / synthetic (windows-latest, .venv/Scripts/python.exe), ci-gate, required-ci |
| [#1732](https://github.com/Faysk/tda/pull/1732) | `integration/1651-vercelignore-unit-config-gate` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1733](https://github.com/Faysk/tda/pull/1733) | `main` | ancestral incorporado | nenhuma observada; conferir pendentes |
| [#1735](https://github.com/Faysk/tda/pull/1735) | `main` | delta #1735 cherry-picked | nenhuma observada; conferir pendentes |
| [#1736](https://github.com/Faysk/tda/pull/1736) | `integration/1651-navigation-failure-trace` | ancestral incorporado | nenhuma observada; conferir pendentes |

## Lifecycle dos workflows versionados

O GitHub conserva 66 registros, incluindo paths históricos ausentes da árvore e o workflow dinâmico Dependabot. `active` no registro não demonstra gatilho executável de um arquivo ausente da branch atual. A candidata possui 30 YAML; a main baseline possui 29. Não apagar registros/receipts nem habilitar recuperação histórica com base apenas no nome. Último run é o último retornado para o workflow, não evidência de CI da candidata.

| Workflow | Lifecycle | Estado remoto | Último run observado |
|---|---|---|---|
| [acceptance-fixture.yml](../../.github/workflows/acceptance-fixture.yml) | active | active | [37541597738](https://github.com/Faysk/tda/actions/runs/37541597738) push / completed / success / `9d40dee03a2d` |
| [campaign-isolation.yml](../../.github/workflows/campaign-isolation.yml) | active | active | [38659327736](https://github.com/Faysk/tda/actions/runs/38659327736) pull_request / completed / success / `80139af3a0a7` |
| [ci.yml](../../.github/workflows/ci.yml) | active | active | [38659718392](https://github.com/Faysk/tda/actions/runs/38659718392) pull_request / completed / success / `3faef2c4e2b6` |
| [codeql.yml](../../.github/workflows/codeql.yml) | active | active | [38659327603](https://github.com/Faysk/tda/actions/runs/38659327603) pull_request / completed / success / `80139af3a0a7` |
| [companion-0316-production-validation-stable.yml](../../.github/workflows/companion-0316-production-validation-stable.yml) | manual-recovery / exceção histórica; preservar fences | active | [38456891104](https://github.com/Faysk/tda/actions/runs/38456891104) workflow_run / completed / success / `256e45b5ffdd` |
| [companion-039-recovery-stable.yml](../../.github/workflows/companion-039-recovery-stable.yml) | manual-recovery / exceção histórica; preservar fences | disabled_manually | [36156411957](https://github.com/Faysk/tda/actions/runs/36156411957) workflow_run / completed / success / `1550f438172c` |
| [companion-dependency-freshness.yml](../../.github/workflows/companion-dependency-freshness.yml) | active | active | [38567106411](https://github.com/Faysk/tda/actions/runs/38567106411) schedule / completed / failure / `256e45b5ffdd` |
| [companion-legacy-031-recovery.yml](../../.github/workflows/companion-legacy-031-recovery.yml) | manual-recovery / exceção histórica; preservar fences | active | [38202432912](https://github.com/Faysk/tda/actions/runs/38202432912) pull_request / completed / success / `79cc661d69cd` |
| [companion-promote.yml](../../.github/workflows/companion-promote.yml) | active | active | [37840850820](https://github.com/Faysk/tda/actions/runs/37840850820) workflow_dispatch / completed / success / `6895c1eb5833` |
| [companion-rc.yml](../../.github/workflows/companion-rc.yml) | active | active | [38456813611](https://github.com/Faysk/tda/actions/runs/38456813611) workflow_run / completed / success / `256e45b5ffdd` |
| [companion-stable-postflight.yml](../../.github/workflows/companion-stable-postflight.yml) | active | active | [37703377069](https://github.com/Faysk/tda/actions/runs/37703377069) workflow_dispatch / completed / success / `087feaca2a99` |
| [companion.yml](../../.github/workflows/companion.yml) | active | active | [37837880065](https://github.com/Faysk/tda/actions/runs/37837880065) workflow_dispatch / completed / success / `1066d58d8128` |
| [dependabot-evidence-ledger.yml](../../.github/workflows/dependabot-evidence-ledger.yml) | candidato; ainda ausente da main | não registrado | não observado / não registrado |
| [deploy-main-preview.yml](../../.github/workflows/deploy-main-preview.yml) | active | active | [38660319453](https://github.com/Faysk/tda/actions/runs/38660319453) workflow_run / completed / skipped / `256e45b5ffdd` |
| [deploy-preview.yml](../../.github/workflows/deploy-preview.yml) | active | disabled_manually | [36156411945](https://github.com/Faysk/tda/actions/runs/36156411945) workflow_run / completed / skipped / `1550f438172c` |
| [issue-structure-governance.yml](../../.github/workflows/issue-structure-governance.yml) | active | active | [38453338645](https://github.com/Faysk/tda/actions/runs/38453338645) push / completed / success / `dbbf2317b152` |
| [label-governance.yml](../../.github/workflows/label-governance.yml) | active | active | [35529978331](https://github.com/Faysk/tda/actions/runs/35529978331) push / completed / success / `eda0cd91a2de` |
| [production-cd.yml](../../.github/workflows/production-cd.yml) | active | active | [37846987593](https://github.com/Faysk/tda/actions/runs/37846987593) workflow_dispatch / completed / success / `d3f41c1db820` |
| [production.yml](../../.github/workflows/production.yml) | historical/disabled; stub inerte | disabled_manually | [36156412386](https://github.com/Faysk/tda/actions/runs/36156412386) workflow_run / completed / success / `1550f438172c` |
| [qwen-1012-production-validation-stable.yml](../../.github/workflows/qwen-1012-production-validation-stable.yml) | manual-recovery / exceção histórica; preservar fences | active | [37836557035](https://github.com/Faysk/tda/actions/runs/37836557035) workflow_run / completed / success / `1066d58d8128` |
| [qwen-1012-stable-bootstrap.yml](../../.github/workflows/qwen-1012-stable-bootstrap.yml) | manual-recovery / exceção histórica; preservar fences | active | [36497878615](https://github.com/Faysk/tda/actions/runs/36497878615) push / completed / success / `3a01e678523b` |
| [qwen-runtime-package.yml](../../.github/workflows/qwen-runtime-package.yml) | active | active | [38202538366](https://github.com/Faysk/tda/actions/runs/38202538366) pull_request / completed / success / `8a8193b32650` |
| [qwen-runtime.yml](../../.github/workflows/qwen-runtime.yml) | active | active | [38202538401](https://github.com/Faysk/tda/actions/runs/38202538401) pull_request / completed / success / `8a8193b32650` |
| [rollback.yml](../../.github/workflows/rollback.yml) | active | active | não observado / não registrado |
| [runtime-promote.yml](../../.github/workflows/runtime-promote.yml) | active | active | [37698394423](https://github.com/Faysk/tda/actions/runs/37698394423) workflow_dispatch / completed / success / `b08381ea7878` |
| [runtime-rc.yml](../../.github/workflows/runtime-rc.yml) | active | active | [37838272496](https://github.com/Faysk/tda/actions/runs/37838272496) workflow_dispatch / completed / success / `1066d58d8128` |
| [standalone-surfaces.yml](../../.github/workflows/standalone-surfaces.yml) | active | active | [38202538423](https://github.com/Faysk/tda/actions/runs/38202538423) pull_request / completed / success / `8a8193b32650` |
| [whisper-runtime.yml](../../.github/workflows/whisper-runtime.yml) | active | active | [38202538446](https://github.com/Faysk/tda/actions/runs/38202538446) pull_request / completed / success / `8a8193b32650` |
| [world-command-palette-e2e.yml](../../.github/workflows/world-command-palette-e2e.yml) | active | active | [38202438045](https://github.com/Faysk/tda/actions/runs/38202438045) pull_request / completed / success / `10ffb29ead1e` |
| [world-map-scale-e2e.yml](../../.github/workflows/world-map-scale-e2e.yml) | active | active | [38202538400](https://github.com/Faysk/tda/actions/runs/38202538400) pull_request / completed / success / `8a8193b32650` |

A matriz de triggers, permissões e consumidores continua em [automation-bot-fleet.md](automation-bot-fleet.md). O teste de trust e os contratos de release verificam origem push/main, SHA, checks e fences das bridges; simulações não substituem monitoramento de corridas entre runs reais. Duplicidade de gatilho CI/CodeQL no Main Preview depende do guard de recibo exato e concurrency; revisar antes de integrar. Nenhum workflow foi removido ou reabilitado.

## Recuperação e próximos gates

Se a candidata falhar, corrigir o delta e repetir somente os checks afetados antes do CI completo no novo SHA. Manter as branches de origem e receipts até aprovação da integração única. Rollback de código via revert do PR integrado; não modificar artefatos RC/Stable históricos. Mudanças administrativas exigem snapshot anterior e restauração exata aprovada, sem desabilitar required-ci para liberar merge.
