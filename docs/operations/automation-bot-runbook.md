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

## Continuidade verificada em 15/10/2026

O [recibo de continuidade](backlog-continuity-2026-10-15.md) registra a reconciliação dos candidatos, testes, todos os PRs/issues abertos, lifecycle remoto e gaps de proteção agora legíveis pela API. O snapshot anterior de 403 permanece histórico. Sem merge/publicação ou alteração administrativa.

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

### Política proposta nos PRs #1653/#1654

O candidato de configuração separa explicitamente Next, Supabase, AWS SDK/R2, React e @xyflow/react de grupos npm triviais, e Playwright, Biome, Node types, TypeScript e Vitest de updates de desenvolvimento de baixo risco. Grupos gerais só aceitam `minor`/`patch` via `update-types`; `major` fica separado por padrão. `npm`/GitHub Actions passam a triage semanal às terças; `pip` permanece diário, mas FastAPI, CUDA, Whisper e Qwen não entram no grupo `companion-test-tooling`. Os grupos CodeQL incluem tanto version updates como security updates, com `init`/`analyze` na mesma família. Os cronogramas usam `Europe/Lisbon`; cooldown de versão **não** adia PRs de segurança.

Essas regras **não** resolvem automaticamente o `requirements-test.lock` customizado: #1652 continua com patch e testes próprios. Também não alteram política de release ou habilitam automerge. Ver testes `tools/ci/dependabot-policy.test.mjs` e governança #1656/#1657.

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

### Verificador de attestation de manifesto RC — #1667 (consulta opt-in)

O comando `tools/ci/rc-attestation-consumer.mjs` é uma **ferramenta de consumidor manual/CI futuro**, não está ligado à promoção Stable: `node tools/ci/rc-attestation-consumer.mjs companion rc-assets/TDACompanion-candidate.json <CANDIDATE_SOURCE_SHA> <SIGNER_WORKFLOW_RUN_HEAD_SHA>` ou `runtime rc-assets/TDARuntime-candidate.json <CANDIDATE_SOURCE_SHA> <SIGNER_WORKFLOW_RUN_HEAD_SHA>`. Os dois SHAs devem ser coletados **independentemente de fontes confiáveis**: o primeiro do commit/candidato RC imutável, o segundo do **commit do workflow assinante** (`githubWorkflowSHA`) comprovado pelos metadados confiáveis da attestation e do run GitHub Actions (não é o campo `sourceRepositoryDigest`). Eles podem ser diferentes em um dispatch manual. Jamais preencher o segundo com o primeiro por conveniência, nem confiar apenas nos campos contidos em um JSON baixado.

O script valida nome/schema/version/source/tree, build run ID positivo e **tag RC exata derivada da versão e dos primeiros 12 caracteres do SHA do candidato** (incluindo `channel=rc` no Companion e stable tag coerente no Runtime), chama o CLI oficial `gh attestation verify` com `--repo Faysk/tda`, `--signer-workflow Faysk/tda/.github/workflows/{companion-rc,runtime-rc}.yml`, `--signer-digest <SIGNER_WORKFLOW_SHA>`, `--predicate-type https://slsa.dev/provenance/v1`, `--deny-self-hosted-runners` e `--format json`; reprova execução não-zero, ausência de attestation verificável, predicate/subject/hash divergente. O digest do sujeito é calculado localmente sobre os bytes exatos do manifest RC. Não executa `gh release edit/upload/create`, não publica, não grava receipts nem dá autorização de promoção.

**Matriz de escopo:**
- **Companion RC:** attestation emitida sobre MSI, checksum, ZIP, payload manifest e candidate manifest no produtor. Este verificador confirma **somente o candidate manifest**; a verificação criptográfica do MSI e demais sujeitos ainda precisa de execução/aceite próprio.
- **Whisper/Qwen Runtime RC:** produtor emite attestation de checksums dos assets e do candidate manifest. Este verificador cobre **somente o candidate manifest** e não torna desnecessária a comparação dos archives físicos e `verify_candidate_assets`.
- **Stable consumidor geral:** promoção segue dependendo de receipts instalados/físicos, hash de artefato, tag e target exato. A nova ferramenta **não altera os workflows de promoção** e `permits_promotion=false` é invariável.

Use `node --test tools/ci/rc-attestation-consumer.test.mjs` para as **8 fixtures sintéticas** de downgrade de schema, SHA/cert origin errado via argumentos pinados, signer workflow incorreto, digest/predicate alterado, retorno CLI vazio/falhando, versões e família. Mocks testam **política e fail-closed**, não geram assinatura Sigstore real. Prova física Windows/GPU e validadores de payload ficam fora; antes de ligar esta ferramenta a um gate real de Stable, validar um **RC novo de teste** e o resultado oficial `gh` de um artefato real. Não retroativamente bloquear bridges históricos por indisponibilidade de attestations que não foram produzidas. [Referência oficial GitHub CLI](https://cli.github.com/manual/gh_attestation_verify). #395 mantém Authenticode; #1659 os controles de release; #1667 o vínculo de attestation.

### Verificação de todos os assets baixados de RC — #1667 (SHA-256 local e opt-in)

`node tools/ci/rc-local-asset-integrity.mjs companion /caminho/TDACompanion-candidate.json /caminho/assets <SOURCE_SHA>` ou `runtime /caminho/TDARuntime-candidate.json /caminho/assets <SOURCE_SHA>` lê **apenas arquivos já disponíveis no disco**, nunca chama `gh`, não faz download de modelos, não executa binários nem modifica release. O manifesto precisa obedecer schema/tag/version/source/tree/run ID verificados pelo candidato RC. É **complementar** ao `rc-attestation-consumer.mjs`: assinar um manifesto não prova automaticamente que cada binário baixado corresponde aos hashes nele listados.

A conferência local percorre todas as linhas do manifesto: Companion exige MSI, checksum sidecar, ZIP exato da versão e payload manifest; Runtime exige a lista declarada de archives/partes/sidecars. Há validação de nomes restritos (sem `../`, paths absolutos, colisão case-insensitive), tamanhos positivos e SHA-256 completo de cada arquivo, por stream de 1 MiB (sem carregar archives grandes em RAM). Rejeita symlinks, tipos não regulares e divergências de inode/tamanho durante a abertura. Para Companion ainda lê a sidecar pequena e exige o hash informado do MSI igual ao hash dos bytes verificados.

**Sem exagerar a prova:** `local_asset_integrity=verified-sha256` só se **todos os arquivos baixados** do candidato local passarem. `github_attestation=not-checked`, `physical_receipts=not-checked`, `authorizes_stable=false` e `authorizes_production=false` sempre. É possível executar primeiro a verificação criptográfica da attestation do manifesto do PR #1683 e depois conferir **todas** as referências locais com este verificador; isso ainda não é equivalente a aceite físico, rollback ou permissionamento.

Testes `node --test tools/ci/rc-local-asset-integrity.test.mjs` (11 casos sintéticos, incluindo symlink no checksum sidecar e reabertura limitada): MSI/sidecar/hash, Qwen em partes, edição de bytes mantendo tamanho, checksum discordante com manifesto refeito, path traversal, lista vazia/duplicada, arquivo ausente, symlink e source/tag divergentes. Os testes só escrevem sob diretórios temporários locais e não processam modelos reais. **O uso operacional exige recebimento controlado dos assets e fixture de CI com RC pequeno; não alterar bridges Stable históricos por falta de atestado**.

### Contrato de publicação: não perder subjects attested (#1667)

`tools/ci/rc-provenance-policy.mjs` e os seis testes de mutação em `tools/ci/rc-provenance-policy.test.mjs` acrescentam contrato **estático** ao `workflow-contract` para **ambos** produtores RC. O Companion deve atestar MSI, checksum, ZIP, payload e candidate manifest usando `actions/attest@<SHA40>` **antes** da publicação; o Runtime deve gerar o ficheiro de checksums, atestar esse conjunto e o manifesto candidato com action pinada e **antes** da publicação; ambos exigem `id-token: write` e `attestations: write`. Mutações sintéticas removem cada subject, degradam o pin para tag flutuante, removem permissões ou transferem o passo de attest para depois da publicação: todas devem reprovar.

A análise funciona por âncoras textuais deliberadamente específicas dos dois YAMLs; não substitui `actionlint`, prova OIDC remota, integridade de todos os pacotes de distribuição, bundles Sigstore ou execução real. Não confundir resultado verde com liberação de release. Alterações de layout YAML podem exigir atualização explícita da política e revisão humana, **não exclusão do teste**.

### Confirmar run assinante no GitHub antes da attestation (#1667)

O wrapper **opcional e somente leitura** `node tools/ci/rc-signer-run-verify.mjs companion|runtime /caminho/candidate.json <SOURCE_SHA_DO_CANDIDATO> <RC_SIGNER_RUN_ID>` complementa `rc-attestation-consumer.mjs`. Ao contrário de aceitar o digest do workflow fornecido manualmente, ele resolve esse digest a partir do recurso GitHub Actions `GET /repos/Faysk/tda/actions/runs/<id>` usando `gh api`. O run precisa corresponder à **identidade exata do workflow RC** (`Companion RC` ou `Runtime RC`), caminho YAML permitido, repositório e origem `Faysk/tda`, evento `workflow_run` ou `workflow_dispatch`, branch `main`, conclusão `success`, SHA 40 hexadecimal e número de tentativa positivo. Qualquer run incompleto, forge/fork, evento inesperado, origem ausente ou API indisponível reprova **antes** de tentar validar a attestation.

Depois de validar os **metadados do run selecionado**, passa seu `head_sha` à ferramenta de attestation via `--signer-digest` e exige resposta coerente de certificado/manifesto. **Limitação criptográfica:** `--signer-digest` valida o commit do workflow, não o **ID único do run**; dois runs RC podem compartilhar o mesmo SHA e um manifesto válido daquele workflow não fica automaticamente vinculado ao ID informado. O wrapper devolve `unique_attestation_signer_run=not-verified` e jamais declara que o run escolhido assinou o manifesto. Um futuro check de run ID precisa de campo confiável específico no **certificado verificado**, não só metadata enviada no `statement.predicate`. O **RC_SIGNER_RUN_ID** é o run do workflow **Companion RC / Runtime RC**, e **não** o campo `workflow_run_id` do candidate manifest (que identifica o build de origem). Não assumir que são iguais; isto é especialmente relevante em `workflow_dispatch`. O `SOURCE_SHA_DO_CANDIDATO` também deve ser aferido pela tag/RC imutável, independentemente do JSON baixado. A invocação tem dois `gh` apenas de leitura (`gh api` GET e `gh attestation verify`), e retorna `authorizes_stable=false` e `authorizes_production=false`.

**Limite importante:** verificar a identidade metadata do run não atesta artefatos binários nem valida quem aprovou/promoveu o RC; continua obrigatório comparar SHA-256 de todos os assets, receipts físicos e assinatura Authenticode. CI executa doze testes (incluindo caso de dois runs diferentes no mesmo SHA, mocks adversariais e duas amostras públicas de schema), não chamadas reais às APIs durante o teste: fork/head diferente, trigger inadequado, workflow falso, run cancelado/pendente, API indisponível e resultados inconsistentes são rejeitados. As amostras públicas de metadata foram conferidas via GitHub API em [Companion RC run 38456813611](https://github.com/Faysk/tda/actions/runs/38456813611) e [Runtime RC run 37838272496](https://github.com/Faysk/tda/actions/runs/37838272496), ambos `success` com `head_branch=main`, origem `Faysk/tda` e paths esperados, **sem baixar/abrir assets nem executar attestation**. Antes de usar operacionalmente, confirmar a leitura de um run RC escolhido e realizar `gh attestation verify` contra manifesto do RC exato; não ligar este wrapper aos workflows de promoção nem bloquear Stable histórico sem decisão específica.

### Auditoria combinada, sem publicação — #1667

`node tools/ci/rc-evidence-audit.mjs companion|runtime /caminho/candidate.json /caminho/assets <SOURCE_SHA_CONFIÁVEL> <SIGNER_RC_RUN_ID>` compõe **duas provas distintas** sem misturá-las: primeiro consulta o run RC assinado em API GET e faz `gh attestation verify` do manifesto exato (identidade do repositório/workflow via certificado, commit do workflow assinante via `--signer-digest`), depois **reabre o manifesto** e recalcula o SHA-256 de todos os assets locais declarados. Ele exige que os SHA-256 do **mesmo manifesto** e a tag RC sejam idênticos nos dois resultados; se alguém substituir o arquivo entre os passos, `RC_AUDIT_SIGNED_MANIFEST_CHANGED_BETWEEN_CHECKS` bloqueia o relatório. Não executa o CLI em CI; apenas mocks, fixtures e runners locais explícitos. Manifestos simbólicos são negados e leitores verificam inode/tamanho antes da leitura por file descriptor.

O relatório `tda-rc-combined-evidence-v1` contém apenas identificadores do candidato, SHA/digest, contagem/tamanho dos assets verificados e estados. Não copia ficheiros, não consulta dados pessoais, não carrega runtime Qwen/Whisper na GPU, não faz `gh release`, dispatch, upload, alteração de canal, merge ou autorização automática. Resultado positivo **não é aprovação**: `unique_signer_run_attribution=not-verified`, `physical_acceptance=not-checked`, `authenticode=not-checked`, `remote_release_state=not-checked` e `authorizes_stable=false` / `authorizes_production=false`. A associação criptográfica do **run ID específico** continua pendente, porque `--signer-digest` atesta o **workflow SHA**, não o ID do run; o SHA de origem e o ID informado também exigem seleção externa confiável.

Os testes `rc-evidence-audit.test.mjs` cobrem rejeição de resultado falso, digests/tags divergentes, parcialidade de assinatura, falta de assets, entradas inválidas, erro de leitura, e impossibilidade de liberar canal. `rc-local-asset-integrity.test.mjs` e `rc-attestation-consumer.test.mjs` incluem arquivos com nomes válidos que são **symlinks de manifesto**, rejeitados antes de consulta/validação. A validação de um release RC **real** exigirá execução opt-in com acesso às attestations e assets verdadeiros, os recibos físicos e revisão de política; CI sintético não prova isso.

### Matriz rastreável de supply-chain — implementação vs prova executada (#1667)

| Fronteira | Implementado em código / artefato | Prova/attestation física confirmada nesta rodada | Estado residual |
| --- | --- | --- | --- |
| Dependabot → PR (npm/pnpm e Python) | `dependabot.yml`, lock/manifests, `bot-dependency-risk.mjs` no classificador, propostas de allowlist e triage determinístico | Testes sintéticos de política + CI por SHA nos PRs de auditoria | `advisories=not-queried`, licença/OSV/upstream não comprovados; auto-merge **off** |
| PR → CI, CodeQL e merge | CI e CodeQL; observer lê SHA/PR exatos e explicita checks externos não consultados | #1685: CI, CodeQL e isolamento `success` no mesmo SHA | Regras remotas/proteção de branch/required checks administrados **não comprovados (403)** |
| Companion RC publisher | `companion-rc.yml`: SHA/source/asset hashes, `actions/attest@SHA40` com subjects MSI, checksum, ZIP, payload e candidate JSON | Revisão estática + mutações negativas sintéticas | Uma prova Sigstore real do candidato específico **não executada** |
| Whisper/Qwen Runtime RC publisher | `runtime-rc.yml`: checksums dos runtime assets, attestation `subject-checksums` e candidate manifest, identidade/tags/hashes | Revisão estática + mutações negativas sintéticas | Attestation real de archives/checksum list **não executada**; arquivos multi-GB não lidos |
| RC consumer opt-in (PRs #1683–#1687) | `rc-attestation-consumer.mjs` + `rc-signer-run-verify.mjs` + `rc-local-asset-integrity.mjs` + `rc-evidence-audit.mjs`: SHA de manifesto idêntico no signer e hasher, asset SHA256 local, id/tag/família | **Somente mocks**, symlink/tamper e dois metadados públicos de runs RC; nenhum `gh attestation verify` real | Execução do operador **não instalada na main** até merge; identidade criptográfica do **run ID exclusivo** não comprovada |
| Companion Stable | `companion-promote.yml`: confirmação manual, source/manifest/MSI/receipts instalados/físicos, re-download e mesmo release object | Política existente em código; **sem** nova promoção/teste físico | Consumer Sigstore ainda **não é gate automático**; #395 Authenticode separado |
| Runtime Stable | `runtime-promote.yml`: confirmação manual, archive/hash/receipts físicos, download e mesmo release object | Política existente em código; **sem** nova promoção/teste físico | Consumer Sigstore ainda **não é gate automático**; nenhuma alteração de runtime publicado |
| Production Web | `production-cd.yml`: disparo manual, SHA/main/CI/Preview e confirmação humana | Gates de contrato sintéticos do PR de auditoria | Releases e Environments remotos não tocados; não confundir CodeQL verde com publicação |

**Leitura da matriz:** `implementado` ≠ `executado` ≠ `aplicado em Production`. Critério de promoção nunca nasce desses novos comandos; continua sendo o fluxo humano de promoção, verificação física, recibos e regras administrativas reais. Qualquer status `unknown` é bloqueante para automatizar publicação. Hash/local/manifesto assinado não prova licença de dependência nem atualizações sem CVE. A matriz é restrita aos workflows citados; não presume cobertura de todas as publicações históricas.

### Comparação dos assets publicados em um RC (metadados GET) — #1667

O terceiro consumidor **opt-in e sem writes** é `node tools/ci/rc-public-release-audit.mjs companion|runtime /caminho/candidate.json /caminho/assets <SOURCE_SHA_CONFIÁVEL> <RC_SIGNER_RUN_ID>`. Ele primeiro requer o resultado positivo de `rc-evidence-audit.mjs` (run de assinatura consultado via GET, attestation GH sobre o manifesto, SHA-256 de **todos os arquivos RC locais**, mesma versão/tag/digest), em seguida reabre os bytes do manifesto e exige **o mesmo SHA-256 pela terceira vez**, antes de consultar `gh api repos/Faysk/tda/releases/tags/<RC_TAG>` (**GET**). Rejeita metadados sem `draft=false` + `prerelease=true`, release tag ou target_commitish diferentes do SHA indicado, `published_at` inválido, assets ausentes/extras/duplicados ou com `state != uploaded`, sem `digest: sha256:<64 hex>`, tamanho ou hash discordante. O conjunto esperado é **o manifesto candidato e exatamente os assets nele declarados**; não aceita publicação de arquivos extras silenciosos. Isto é conservador e pode reprovar RCs históricos aos quais foram anexados receipts, sem alterar esses RCs.

Depois do GET do release, o consumidor consulta também **`GET /repos/Faysk/tda/git/ref/tags/<RC_TAG>`** e, se o ref for anotado, segue apenas os objetos tag por no máximo quatro saltos (`GET /git/tags/<SHA>`), com detecção de ciclos, até exigir objeto `commit` cujo SHA seja igual à fonte confiável. A tag leve observada para [Companion RC v0.3.26](https://github.com/Faysk/tda/releases/tag/companion-rc-v0.3.26-b72eb1ffd316) apontava para `b72eb1ffd316e0c371d5d121899e56a9c8b844e3` na API. O novo relatório separa as garantias **metadata GitHub e alvo atual do ref tag** de uma assinatura/imutabilidade: `remote_release_state=matched-release-and-tag-ref-at-fetch`, `git_tag_object_target=verified-at-fetch`, mas `release_immutability=not-proven`, `unique_signer_run_attribution=not-verified`, `physical_acceptance=not-checked` e autorização de Stable/Production **sempre false**. A API GitHub é fonte confiável para o **snapshot consultado**, mas release metadata/tag podem ser editados por quem tem acesso ao repositório; verificar `target_commitish` não equivale a resolver o ref Git anotado ou provar ausência de mutações posteriores. O script não executa `gh release`, não baixa MSI/modelos, não publica nem promove nada.

Há **15 grupos de testes sintéticos** (draft/stable indevido, source/tag stale, nomes duplicados/extra, arquivo removido, digest e tamanho divergentes, troca do manifesto entre auditoria assinada e GET, symlink, API inacessível, sucesso falso e não autorização) mais um snapshot baseado em metadata **pública** de [Companion RC v0.3.26](https://github.com/Faysk/tda/releases/tag/companion-rc-v0.3.26-b72eb1ffd316), observado em 14/10/2026, sem baixar os assets. Para RCs maiores Qwen/Whisper, um operador deve considerar o custo de SHA-256 sequencial local; a CI só executa fixtures minúsculas. Futura política de tag-ref exata e receipts físicos permanece independente.

### Integridade semântica de runtime RC — Whisper/Qwen (#1667)

Revisão do consumidor RC comparada aos contratos Python existentes: `local-companion/tda_companion/runtime_release_evidence.py` (`_parse_candidate`, `_create_whisper_candidate`, `_create_qwen_candidate`) e `qwen_runtime_bundle.py` (`parse_qwen_runtime_bundle_manifest`). **Hash de cada arquivo declarado não basta para alegar completude**, caso um candidate manifeste apenas parte dos arquivos. No consumo opt-in, agora exigimos:

- **Identity comum:** `runtime_id=whisper-ctranslate2` ou `qwen3-transformers` compatível com `family`, `platform=windows-x64` e `runtime_archive_sha256` SHA-256 completo, além de tag/source/run já verificados. Divergência bloqueia antes da invocação de attestation.
- **Whisper:** lista **exatamente** `TDAWhisperRuntime-<version>-windows-x64.zip` seguida da sua `.sha256`. Após SHA-256 individual e read seguro de sidecar pequena, esta deve conter o digest correspondente e o nome exato da archive; o `runtime_archive_sha256` do candidate deve coincidir.
- **Qwen:** lista **exatamente** `TDAQwenRuntimeBundle-<version>-windows-x64.json` e 1 a 16 partes com nomes `TDAQwenRuntime-<version>-windows-x64.zip.part001...016`, ordenadas e sem buracos. O bundle JSON é relido com limite de 512 KiB e `O_NOFOLLOW`, validado em schema `tda_qwen_runtime_bundle_v1`, `runtime_id`, plataforma, versão, arquivo, hash esperado de archive, quantidade/índices/nomes/hashes/tamanhos de cada parte e soma dos tamanhos (`<=16 GiB`). Isso **não** remonta/executa o modelo nem recalcula o hash da archive montada, e o relatório **não** deve afirmar `archive_reassembled_verified`.

Esses controles são **complementares** à confirmação Sigstore, sidecars, recibos físicos e `verify_candidate_assets` em Python. Os testes adicionais alteram hashes do bundle JSON para simular alguém que consegue reescrever uma lista candidata e mantê-la internamente incompleta: os contratos passam a **reprovar** o bundle inconsistente mesmo se todos os arquivos presentes tiverem seu próprio SHA-256 correto. Validação somente sintética até executar um RC controlado sob autorização, sem mudar Stable e sem processar GPU/áudio privado.

### Companion RC: conferência de conteúdo do payload manifesto (#1667)

O consumidor local do Companion também deve verificar **conteúdo**, não apenas SHA256/tamanho de `TDACompanion-payload-manifest.json`. O contrato já existe em `local-companion/tda_companion/payload_evidence.py:load_payload_manifest` e `release_evidence.py:_verify_payload_identity`. Após hash dos quatro assets RC e checksum sidecar do MSI, a auditoria opt-in relê o payload com limite de 512 KiB, file descriptor/no-follow, exige `schema=tda_companion_payload_v1`, keys exatas (`schema,version,source_sha,source_tree_sha,files`) e identidade de versão/source/tree iguais ao candidate manifest **assinado**. A lista `files` deve conter exatamente `TDACompanion.exe`, `TDACompanionMaintenance.exe`, `run-physical-acceptance.ps1`, `run-installed-acceptance.ps1` e `install-rc-runtimes.ps1`; cada hash e tamanho positivo é validado.

Novas fixtures sintéticas reescrevem os bytes do payload **e recalculam seu hash no candidato** antes da verificação. Mesmo com SHA de cada asset declarado consistente, source/tree/version antigo, schema falso, ficheiro omitido ou hash inválido agora falha antes do relatório de integridade. Isso **não** valida que os executáveis extraídos do ZIP instalado correspondem aos hashes internos do payload, não verifica Authenticode nem recebimentos físicos; as outras fronteiras de instalação/rollback continuam obrigatórias. O objetivo é impedir falsa afirmação de completude do payload com relação ao candidate RC.

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

O módulo `tools/ci/dependency-triage.mjs` pode gerar relatório legível a partir de um **snapshot sintético JSON local**: `node tools/ci/dependency-triage.mjs /caminho/para/snapshot.json`. Ele **não consulta a API GitHub**, não lê secrets, não utiliza LLM, não modifica PR/issue/check, não agenda mensagens e não faz `merge`, `dispatch` ou deploy. Sua finalidade é validar regras e fingerprints antes da etapa futura de integração real com um collector read-only por SHA. Cada fingerprint usa `repo+PR+head SHA+causa+versão da política`, incluindo severidade/ID da advisory confirmada e nomes dos jobs falhos ordenados; entregas repetidas sem alteração devolvem exatamente o mesmo fingerprint e são coalescidas em um registro; duas versões conflitantes do mesmo PR no mesmo lote reprovam em vez de escolher silenciosamente uma delas, mudanças de SHA/causa entre lotes exigem novo registro. O Markdown mostra apenas metadados mínimos, sem payloads privados.

Ordem de classificação: `stale` se identidade/PR atual não está comprovada; `security-critical` para advisory `critical/high` **confirmada no SHA**, independentemente de cooldown ou CI; `needs-human` para advisory `medium/low` conhecida; `blocked-by-lock` para divergência determinística direta entre manifest e lock; `failed-tests` para CI vermelho/cancelado/timeout **sem reclassificar falha de navegador como CVE**; `needs-human` quando advisories, lock, CI ou CodeQL estão ausentes/stale/unknown; e `ready-for-review` somente com evidências centrais completas e atuais. O último rótulo **não equivale a merge-readiness** (regras administrativas, checks adicionais e approvals não são validados aqui).

Regressões sintéticas: `node --test tools/ci/dependency-triage.test.mjs` (12 casos) testa eventos duplicados, SHA/rebase, mudanças de causa, advisory crítica e não crítica, lock drift, CI com falha sem falsa vulnerabilidade, e oito snapshots simulados dos PRs #1643–#1650. O canal de alerta e SLAs reais de #1663 continuam **não definidos** até decisão do owner, acesso à API e revisão de privacidade/retention. **Não usar um digest local como prova de ausência de vulnerabilidades**.

### Regra de confiança do Observer `workflow_run` (#1657/#1664/#1667)

Como `dependabot-evidence-ledger.yml` é acionado em `workflow_run: CI completed`, seu contexto é diferente daquele do PR não confiável. A regressão `github-actions-security.test.mjs` impede que uma edição futura introduza checkout do head de um PR, `pull_request_target`, permissão `write` ou job-level override, credenciais persistentes, submodules/LFS ligados ou comandos `gh pr merge` / `gh release`. Exige checkout da **default branch revisada**, token somente com `contents/actions/pull-requests: read`, `GH_TOKEN` normal e execução do ledger local. Sete mutações artificiais precisam falhar; nenhuma automação de escrita foi incluída. A verificação é estática por padrões concretos de YAML e deve evoluir com o workflow; não prova controles remotos de Environment ou branch protection.

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
