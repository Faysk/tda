# TDA — Frota de bots e automações (inventário + arquitetura-alvo)

> Status: inventário vigente; automações adicionais propostas
> Owner: operations / governance / CI / Companion / release
> Última revisão: 2026-10-13
> **Baseline verificável:** [`main@67cc217`](https://github.com/Faysk/tda/tree/67cc21704639658679886d92514033213a528f17).
> **Epic:** [#1651](https://github.com/Faysk/tda/issues/1651). **Runbook:** [automation-bot-runbook.md](automation-bot-runbook.md).

## 1. Missão, escopo e limites

O objetivo é coordenar uma **frota lógica de dez responsabilidades** usando, sempre que suficiente, Dependabot e GitHub Actions existentes; **não significa construir dez apps ou serviços externos**. Estado observado, estado desejado e decisões futuras permanecem separados.

**Política vigente (AGENTS.md):** control plane GitHub, free-first, mudanças via PR/testes; `main` é linha canônica; sem deploy por push; Preview é homologação; publicação deliberada/operador. Não criar SaaS pago nem novo secret permanente por conveniência; não acessar áudio/transcrições privadas, credenciais, bancos produtivos ou buckets para executar testes. Atualizações do Companion/ASR não valem como aceites físicos Windows/GPU.

**Deferimentos:** PR automático não é merge automático; merge não é Production; RC imutável não é Stable; CodeQL verde não é suíte funcional verde; status `protected:true` não prova configuração de status checks; testes sintéticos não são receipts físicos.

## 2. Foto do repositório em 13/10/2026

- `main`: `67cc21704639658679886d92514033213a528f17`, `protected=true` (metadado da branch); consulta detalhada de branch protection retornou 403. Listagem de rulesets retornou [] — resultado da permissão dessa conexão, **não** prova de falta de proteções.
- `.github/workflows/`: **29 YAML**. Esse número representa arquivos versionados, **não** prova de 29 workflows habilitados remotamente ou todos executados recentemente. Estado, último run e remediação de legados são trabalho de [#1668](https://github.com/Faysk/tda/issues/1668).
- `.github/dependabot.yml`: três ecossistemas — npm em `/` semanal (production/development agrupados, max 3); pip em `/local-companion` diário (companion-runtime agrupado, max 5); github-actions em `/` diário, sem grupos explícitos.
- 8 PRs de `dependabot[bot]` abertos na fotografia: [#1643](https://github.com/Faysk/tda/pull/1643) Next + Supabase + AWS, [#1644](https://github.com/Faysk/tda/pull/1644) Playwright + @types/node, [#1645](https://github.com/Faysk/tda/pull/1645) setup-uv, [#1646](https://github.com/Faysk/tda/pull/1646) setup-node, [#1647](https://github.com/Faysk/tda/pull/1647) FastAPI, [#1648](https://github.com/Faysk/tda/pull/1648) CodeQL init, [#1649](https://github.com/Faysk/tda/pull/1649) CodeQL analyze, [#1650](https://github.com/Faysk/tda/pull/1650) upload-artifact.
- **Achado confirmado:** #1647 modifica FastAPI no `pyproject.toml`, mas não no `requirements-test.lock`; o [freshness gate 38202483008](https://github.com/Faysk/tda/actions/runs/38202483008) falhou com `DIRECT_LOCK_MISMATCH` e [CI 38202483200](https://github.com/Faysk/tda/actions/runs/38202483200) falhou na resolução uv. **Não é falha do gate** — o gate protegeu a instalação.
- **Achado limitado:** [CI 38101781316](https://github.com/Faysk/tda/actions/runs/38101781316) de #1643 falhou em dois cenários Playwright de navegação/World. Causalidade da atualização de libs permanece indeterminada.

## 3. Catálogo: 29 workflows observados e 1 candidato novo

As colunas **trigger**, **escopo** e **permissão declarada** refletem o YAML na baseline; não equivalem a confirmação de execução remota, Environment ou aprovação. `R` significa token read-only e `W` alguma permissão de escrita explícita. A permission real deve ser auditada por job e organização (#1657).

| # | Workflow em `.github/workflows/` | Gatilhos declarados | Domínio / efeito autorizado | Token |
|---:|---|---|---|---|
| 01 | [`acceptance-fixture.yml`](../../.github/workflows/acceptance-fixture.yml) | PR, push main (paths) | Harness de aceitação/fixtures; não substitui aceite físico | R |
| 02 | [`campaign-isolation.yml`](../../.github/workflows/campaign-isolation.yml) | PR (paths) | Isolamento de campanhas, browser e contratos | R |
| 03 | [`ci.yml`](../../.github/workflows/ci.yml) | PR, push main | Classificação, validação, checks obrigatórios e suites seletivas | R |
| 04 | [`codeql.yml`](../../.github/workflows/codeql.yml) | PR, push main, cron semanal | Análise estática JS/TS/Python, security-events | W* |
| 05 | [`standalone-surfaces.yml`](../../.github/workflows/standalone-surfaces.yml) | PR, push main | Testes de superfícies independentes | R |
| 06 | [`world-command-palette-e2e.yml`](../../.github/workflows/world-command-palette-e2e.yml) | PR, dispatch | E2E Chromium de navegação/world | R |
| 07 | [`world-map-scale-e2e.yml`](../../.github/workflows/world-map-scale-e2e.yml) | PR (paths) | E2E do mapa/zoom | R |
| 08 | [`companion-dependency-freshness.yml`](../../.github/workflows/companion-dependency-freshness.yml) | PR, push main, cron diário, dispatch | Pins/locks Python, runtimes e revisions upstream | R |
| 09 | [`companion.yml`](../../.github/workflows/companion.yml) | workflow_call, dispatch | Build/teste Agent/Desktop/MSI | R |
| 10 | [`companion-rc.yml`](../../.github/workflows/companion-rc.yml) | workflow_run CI, dispatch | Publicar candidato Companion RC imutável com atestação | W |
| 11 | [`companion-promote.yml`](../../.github/workflows/companion-promote.yml) | dispatch | Promoção governada Companion Stable | W |
| 12 | [`companion-stable-postflight.yml`](../../.github/workflows/companion-stable-postflight.yml) | dispatch | Verificação pós-Stable | R |
| 13 | [`companion-0316-production-validation-stable.yml`](../../.github/workflows/companion-0316-production-validation-stable.yml) | workflow_run Companion RC | Bridge excepcional de candidato 0.3.16 exato; revisar lifecycle | W |
| 14 | [`companion-039-recovery-stable.yml`](../../.github/workflows/companion-039-recovery-stable.yml) | workflow_run CI | Bridge de recuperação 0.3.9 exata; revisar lifecycle | W |
| 15 | [`companion-legacy-031-recovery.yml`](../../.github/workflows/companion-legacy-031-recovery.yml) | PR, dispatch | Teste/recuperação legado 0.3.1 | R |
| 16 | [`qwen-runtime.yml`](../../.github/workflows/qwen-runtime.yml) | PR (paths) | Planejamento/teste runtime Qwen Windows | R |
| 17 | [`qwen-runtime-package.yml`](../../.github/workflows/qwen-runtime-package.yml) | PR, push main/Preview, dispatch | Build de archive Qwen, despacho RC quando elegível | R |
| 18 | [`whisper-runtime.yml`](../../.github/workflows/whisper-runtime.yml) | PR, dispatch | Build/smokes runtime Whisper | R |
| 19 | [`runtime-rc.yml`](../../.github/workflows/runtime-rc.yml) | workflow_run Whisper Runtime, dispatch | RC Qwen/Whisper, hash/provenance/attestations | W |
| 20 | [`runtime-promote.yml`](../../.github/workflows/runtime-promote.yml) | dispatch | Promoção governada runtime Stable | W |
| 21 | [`qwen-1012-stable-bootstrap.yml`](../../.github/workflows/qwen-1012-stable-bootstrap.yml) | push main (path próprio) | Bootstrap excepcional de RC exato 1.0.12 | W |
| 22 | [`qwen-1012-production-validation-stable.yml`](../../.github/workflows/qwen-1012-production-validation-stable.yml) | workflow_run Runtime RC, dispatch | Bridge Stable 1.0.12 version-specific | W |
| 23 | [`deploy-preview.yml`](../../.github/workflows/deploy-preview.yml) | workflow_run CI, dispatch | Preview de PR por SHA e origem verificados | W* |
| 24 | [`deploy-main-preview.yml`](../../.github/workflows/deploy-main-preview.yml) | workflow_run CI, dispatch | Preview da main/artefato versionado | W |
| 25 | [`production-cd.yml`](../../.github/workflows/production-cd.yml) | **dispatch manual** | Production staged → smoke → promote → receipt com confirmação humana | W |
| 26 | [`production.yml`](../../.github/workflows/production.yml) | dispatch manual | Job `retired`; não assumir safe-to-delete sem pesquisa | — |
| 27 | [`rollback.yml`](../../.github/workflows/rollback.yml) | dispatch | Rollback controlado | W* |
| 28 | [`issue-structure-governance.yml`](../../.github/workflows/issue-structure-governance.yml) | push main (paths), dispatch | Sync milestones, subissues, dependencies | W |
| 29 | [`label-governance.yml`](../../.github/workflows/label-governance.yml) | push main (paths), dispatch | Sync labels canônicas de issues | W |
| 30 | [`dependabot-evidence-ledger.yml`](../../.github/workflows/dependabot-evidence-ledger.yml) | workflow_run CI de PR, dispatch manual de reconsulta | **CANDIDATO #1664**: ledger por SHA/PR, CodeQL e required jobs; somente leitura | R |

O número **29** é a fotografia da `main` em 13/10/2026; a linha **30** é o novo workflow **candidato deste PR**, não ativo na `main` até revisão/merge. Ele nunca executa a cabeça de um PR, não possui `write` e não concede autorização de merge. Quando integrado, atualizar a fotografia para 30 workflows versionados. A operação gera apenas Job Summary com o estado dos checks do run consultado, sem comentários automáticos. Se CodeQL estiver pendente, a reconsulta manual `workflow_dispatch` recebe o ID do CI run exato; a primeira execução não inventa resultado final.


`W*` restringe-se a ações específicas (ex.: CodeQL escreve security-events; Preview escreve deployments; rollback escreve deployments), e **não** significa acesso global de administração. Workflows legados com branch/evento conservados exigem confirmação de elegibilidade antes de mexer; os bridges 0.3.16/0.3.9 e Qwen 1.0.12 não se confundem com política corrente de novos Stable.

### Grafo de fluxo principal (alto nível)

`Dependabot PR → CI/CodeQL/freshness → Preview de PR (quando válido) → revisão humana → merge main → CI push/main → Main Preview versionado → Production CD manual + confirmação + SHA/receipt`.

Trilha ASR independente: `mudança local-companion/runtime → builds/testes/RC imutável → aceite Windows/GPU do artefato exato → promoção Stable por workflow governado`. Bridges históricas de Stable são exceções auditáveis; não habilitar esse fluxo para novos bots sem decisão explícita.

## 4. Frota lógica proposta (papéis/ownership)

| Papel | Implementação preferida | Entrada | Saída verificável | Limite de autoridade | Issue |
|---|---|---|---|---|---|
| **Scout** | Dependabot nativo | manifest/version/advisory | PR estruturado | abrir PR; nunca promover | [#1653](https://github.com/Faysk/tda/issues/1653), [#1654](https://github.com/Faysk/tda/issues/1654) |
| **Lockkeeper** | job/CLI determinístico | pyproject, lock, runtime manifests | diff/erro reprodutível | sem escrever produção | [#1652](https://github.com/Faysk/tda/issues/1652) |
| **Risk Analyst** | regra versionada, IA opcional | dependências + arquivos + changelog | risk report por SHA | não aprovar merges | [#1660](https://github.com/Faysk/tda/issues/1660) |
| **Security Sentinel** | CodeQL + ações de policy | PR, SHA, permissions, advisories | segurança/provenance/alertas | sem secrets no PR | [#1657](https://github.com/Faysk/tda/issues/1657), [#1667](https://github.com/Faysk/tda/issues/1667) |
| **Gatekeeper** | CI/classify + contract tests | diff + matriz de risco | required checks exatos | nunca reinterpretar skipped como sucesso | [#1656](https://github.com/Faysk/tda/issues/1656) |
| **Compatibility Marshal** | freshness + runtime owner | pins HF/Qwen/Whisper/Win/CUDA | proposta de upgrade/aceite físico pendente | nunca reclassificar smoke como GPU receipt | [#1655](https://github.com/Faysk/tda/issues/1655) |
| **PR Concierge** | check summary idempotente | risk + runs | resumo com evidências | sugestão não vinculante | [#1660](https://github.com/Faysk/tda/issues/1660) |
| **Triage Marshal** | cron/check Github-native | alertas, PRs e repetição de falhas | fila e próximo passo | não fechar/mergear silenciosamente | [#1661](https://github.com/Faysk/tda/issues/1661), [#1663](https://github.com/Faysk/tda/issues/1663) |
| **Release Sentinel** | controladores existentes + contracts | CI/Preview/RC/Stable SHA + approval | veto ou receipt de release | Production humana, artefatos imutáveis | [#1659](https://github.com/Faysk/tda/issues/1659) |
| **Observer/Librarian** | ledger GitHub-native + docs | conclusões/URLs/versioned schema | métricas/digest/runbook | sem dados privados, sem writes em produção | [#1664](https://github.com/Faysk/tda/issues/1664), [#1666](https://github.com/Faysk/tda/issues/1666) |

**Papéis de suporte:** verificação administrativa #1658, teste adversarial #1665, lifecycle legacy #1668, auto-merge apenas estudo desligado #1662. Não instalar connector, app ou plataforma paga sem justificativa.

## 5. Regras de priorização e roteamento (proposta, não executada)

| Classe | Regra de PR e revisão | Validação mínima | Decisão |
|---|---|---|---|
| Security advisory | triage prioritária, sem cooldown de versão | origem advisory + matriz do componente | revisão humana urgente |
| npm critical: Next/Supabase/AWS | PR separado e changelog avaliado | build, auth/DB ou media, E2E relevante | humano |
| npm dev/testing | agrupamento coerente com teste do próprio runner | lock + actionlint/Playwright de impacto | humano inicialmente |
| GitHub Actions CodeQL | agrupar init/analyze na mesma versão/SHA | actionlint, workflow security, CodeQL | humano |
| Python Companion | manifest+lock juntos, wheels para Win/Linux | freshness, uv constraints, MSI smoke | humano |
| Qwen/Whisper/model revisions | separar família/manifest/revision/exception | smoke; receipt físico exato antes de Stable | humano |
| mudança de workflow privilegiado | PR separado por trust boundary | testes negativos de triggers/token/provenance | humano obrigatório |
| docs sem efeito externo | PR + validação leve, segundo regras atuais | Markdown links/contexto, CI | humano inicialmente |

Cool-down de version updates é configurável; não atrasar security updates. **Auto-merge não ativado:** [#1662](https://github.com/Faysk/tda/issues/1662) condiciona qualquer experimento a prova de branch protection, gates e autorização futura.

## 6. Dependências e ordem do backlog

- **P1 / primeiro:** [#1652](https://github.com/Faysk/tda/issues/1652) lock Python, [#1656](https://github.com/Faysk/tda/issues/1656) matriz de gates, [#1657](https://github.com/Faysk/tda/issues/1657) trust boundary, [#1658](https://github.com/Faysk/tda/issues/1658) verificar proteção, [#1659](https://github.com/Faysk/tda/issues/1659) release fence, [#1661](https://github.com/Faysk/tda/issues/1661) triage dos 8 PRs.
- **P2 / estruturar:** [#1653](https://github.com/Faysk/tda/issues/1653) npm, [#1654](https://github.com/Faysk/tda/issues/1654) Actions, [#1655](https://github.com/Faysk/tda/issues/1655) ASR, [#1660](https://github.com/Faysk/tda/issues/1660) risco, [#1663](https://github.com/Faysk/tda/issues/1663) alertas, [#1664](https://github.com/Faysk/tda/issues/1664) evidências, [#1665](https://github.com/Faysk/tda/issues/1665) fixtures, [#1666](https://github.com/Faysk/tda/issues/1666) docs, [#1667](https://github.com/Faysk/tda/issues/1667) supply chain, [#1668](https://github.com/Faysk/tda/issues/1668) lifecycle legacy.
- **P3 / estudar depois:** [#1662](https://github.com/Faysk/tda/issues/1662) opt-in automerge, **sem ativação no estado atual**.

Para ownership jurídico de publicação usar sempre [runbook de release](release-runbook.md) e [Companion dependency policy](companion-dependency-policy.md); essa frota não os substitui.

### Matriz concreta: alterações de dependências npm/pnpm (#1656)

**Implementação candidata (PR da #1656; não presumir publicada):** mudança em `package.json` ou `pnpm-lock.yaml` é tratada como potencial alteração de **qualquer runtime Web**, mesmo que o diff não contenha arquivos de funcionalidades. O classificador ativa `navigation`, `db`, `processing`, `lembra`, `sessions`, `media`; mantém `companion=false` (Python/MSI tem grafo de dependências diferente). Por conservadorismo, o classificador não tenta inferir qual pacote transitivo de um lock alterou um único domínio. Essa expansão custa minutos de CI, mas evita passar um PR alterando Next/Supabase/AWS sem testar consumidores.

Além dos gates baseados no classificador, `ci.yml` exige que `statistics-e2e`, `permissions-e2e` e `transcript-edit-e2e` sejam executados quando a mudança for npm/pnpm e proíbe tratá-los como `skipped` no `ci-gate`. `campaign-isolation.yml` também escuta mudanças npm/pnpm em PR e push main. O teste `tools/ci/dependency-risk-contract.test.mjs` mantém essas relações obrigatórias junto de `classify-changes.test.mjs`, sem fazer rede, mutação nem publicação.

**Limites:** não é prova de branch protection remota (#1658), nem adiciona gate físico GPU/MSI para mudanças exclusivamente Web. Pacotes/versionamentos de Python, CUDA, Torch, Whisper, Qwen e artefatos imutáveis continuam sob #1655. Antes de otimizar a matriz por pacote individual, acrescentar negativos que demonstram que nenhum domínio consumidor fica indevidamente `skipped`.

## 7. Escopo e evidência para encerrar

Cada entrega deve indicar: arquivos alterados, SHA antes/depois, PR, checks efetivamente executados, paths/casos negativos, riscos residuais, documentação dona atualizada e por que nenhuma publicação involuntária ocorreu. Segurança, CI, branch protection e aceites físicos são provas diferentes. Ver [runbook de operação](automation-bot-runbook.md) e [epic #1651](https://github.com/Faysk/tda/issues/1651).

**Regra de manutenção:** adicionar/remover workflow, credencial, trigger, dependência crítica, promoção ou regra de bot exige atualizar esta matriz no mesmo PR e comprovar que o conjunto de gates necessário permanece preservado.
