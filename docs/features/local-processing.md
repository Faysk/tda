# Processamento local no Edit

> Status: ASR local, runs/revisão e publicação explícita implementados; auto-sync de job permanece `not_configured`
> Owner: Processamento UI/adapters (Painelzinho); API/export local: Motorzinho; importação cloud: Carteiro
> Última revisão: 2026-10-08
> Fonte de verdade: `src/features/edit/processing`, `src/app/edit/processamento`, `local-companion/tda_companion`, [spec de revisão/publicação](transcript-review-publication.md) e testes associados

`/edit/[campaign]/processamento` é a superfície operacional canônica para conexão com o TDA Companion, ingest local de sessões Craig, fila local, telemetria e eventos. O processamento pesado e os áudios permanecem no computador do usuário; o site cloud não depende do PC estar ligado para continuar disponível.

O contrato editorial pós-processamento é definido em [Transcrição — runs locais, revisão, comparação e publicação versionada](transcript-review-publication.md), ADR-0016 e ADR-0021. A regra central é: **concluir ASR não publica nada**.

## Campaign context no processamento

ADR-0020/#1128 tornam campaign um contexto explícito antes de qualquer submissão que possa criar/ligar sessão ou chegar ao handoff cloud.

No slice Web preparado por #1128:

- `/edit/[campaign]/processamento` fixa a campaign no path; `/edit/processamento` permanece apenas como entrypoint de compatibilidade/seleção e não assume `yuhara-main` como autoridade implícita;
- o servidor enumera somente campaigns **ativas** cobertas por `campaign.local.process`; grant `project/tda` cobre campaigns ativas conforme a política RBAC, enquanto grants de campaign restringem a consulta aos slugs autorizados;
- zero campaigns elegíveis produz estado vazio explícito; uma única opção é canonicalizada para `/edit/[campaign]/processamento`; múltiplas opções exigem escolha do operador;
- query string, select e `localStorage` expressam intenção, nunca autorização: a campaign escolhida é resolvida e reautorizada server-side antes da workspace aparecer; no submit ela é revalidada antes de qualquer upload/preparação local e novamente imediatamente antes de criar o job, cobrindo revogação/arquivamento durante uma preparação longa;
- campaign faz parte da identidade da intenção/idempotency, junto de source/operação/parâmetros relevantes;
- recovery pointer, last-session pointer e receipts metadata-only são namespaced por campaign, impedindo colisão A/B com o mesmo `sessionId`; no rollout, os dois pointers legados single-campaign são migrados somente para `yuhara-main`, nunca reaproveitados por outra campaign;
- selecionar outra campaign na UI não retaggeia job/run já iniciado. Se existe formulário local pendente, enqueue incerto, mutação ou trabalho queued/running, a troca exige confirmação e faz navegação completa; o Agent continua autoritativo sobre o trabalho original;
- retry/recovery preserva a campaign original da intenção;
- o mesmo source em campaigns diferentes representa intenções distintas e auditáveis;
- Session Workspace/Intent/Assembly usam a campaign selecionada em todas as operações locais;
- a workspace Web não apresenta nem oferece ações de fila/revisão para jobs/runs atribuídos a outra campaign; respostas de resultado cujo `campaignId` diverge do contexto selecionado falham fechadas em vez de abrir/reclassificar o run;
- run local legado sem `publicationTarget` não herda a campaign aberta: fica numa área explícita de recuperação, fora das métricas/contagens da campaign. Reparar o destino exige provenance confirmada; ausência de origem mantém o run preservado e não vinculado;
- handoff usa a campaign imutável da assembly e o servidor cloud reautoriza capability, resolve `campaigns.slug` e procura a session por `campaign_id + source_session_id` antes do write atômico; mismatch falha fechado;
- criação de campaign é fluxo administrativo separado. Quando originada pelo CTA do Processamento, o retorno carrega o novo technical slug, mas a tela volta a verificar `campaign.local.process`; criar identidade não auto-concede acesso nem cria session/entity/canon;
- run ASR bruto continua imutável e não vira canon/publicação por receber campaign context.

A URL canônica é `/edit/[campaign]/processamento`. O entrypoint `/edit/processamento` continua aceitando a seleção compatível e encaminha escolhas normais para a rota campaign-scoped; a identidade local do processamento continua sendo o technical slug validado no servidor.

### Endereços por nome de campanha — #1560

O fluxo #1560 usa `public_slug` (`routeKey`) no segmento de navegação do
Processamento. O servidor resolve essa referência somente entre campanhas ativas
autorizadas e entrega o `technicalSlug` original ao painel. Links técnicos antigos
redirecionam para o endereço público atual; picker e menu global usam o mesmo
endereço. RBAC, jobs, pointers, idempotency e ownership continuam usando a identidade
técnica estável. A resolução de caminho não concede acesso nem muda uma sessão.

Em 2026-10-07, o registry autenticado confirmou **Destino Sem Fim** com endereço
`destino-sem-fim` (corrigido pelo editor de campanhas) e **Passos Retomados** com
`passos-retomados`. Essa operação de registry já foi salva; os novos caminhos Web
de Processamento foram publicados e os links técnicos antigos redirecionam.

### Recuperação e distribuição observadas — #1552 / #1561

Seguimento em 2026-10-07: os dois ZIPs reais chegaram ao Edit privado como uma
sessão com 8.019 falas, duas partes, um receipt e nenhuma publicação pública.
O benchmark de cinco minutos concluiu quatro perfis com runtimes Whisper 1.1.12
e Qwen 1.0.20 na RTX 4070 Laptop / SM 8.9. Qwen Fast preservou o restante após
ignorar a janela sem reconhecimento 54–114 s da faixa 1, com um aviso explícito.
Instalação e suite GPU do Companion 0.3.23 passaram, mas a exportação ZIP revelou
um defeito de escopo. O candidato 0.3.24 corrige esse endereço e projeta VRAM
pico/média e cobertura a partir do arquivo de métricas validado por hash;
histórico sem coleta permanece sem valor. A comparação recolhe os avisos e a
memória em detalhes, preservando a leitura principal. O 0.3.24 foi aceito e
promovido; a correção de legendas pontuais segue no 0.3.25, cujo aceite próprio
está descrito abaixo. Estes resultados não são WER/CER nem aceite em RTX 2080.

O teste autenticado de 2026-10-07 encontrou Web Production em
`9d40dee03a2d6978e30e7669f3255e188f75bd35`, mas Agent instalado **0.3.18**,
Whisper **1.1.9** e Qwen **1.0.17**. `ready` do serviço não comprova que todas as
capacidades de recuperação ou runtimes do contrato atual estão disponíveis.

O candidato #1552 apresenta download de atualização dentro do bloqueio sem
cleanup, prioriza retry seletivo quando disponível e remove o anúncio anterior de
gravações prontas ao detectar falhas terminais. Ele preserva runs concluídos e não
simula reset no browser. Build/typecheck, testes de contexto e fixtures multi-ZIP
desktop/mobile foram validados; aceite com ZIPs reais e reconexão do Companion
atualizado permanece em #1561, separado da promoção Stable #1558.

No seguimento físico de #1561, o operador instalou Agent **0.3.21** e a leitura de
health confirmou `ready`. Whisper **1.1.10** e Qwen **1.0.18** foram instalados e
validados contra os hashes oficiais. Os dois perfis Qwen passaram pelo gate físico
da RTX 4070 Laptop; o benchmark real dos quatro perfis foi iniciado com o primeiro
ZIP. Esse estado ainda não comprova conclusão do benchmark nem handoff editorial.
O reset preservou fontes/histórico, mas a retomada com o Whisper antigo produziu
`WHISPER_RUNTIME_PROTOCOL_REQUIRED`: a preparação da intenção recuperada permanece
uma pendência de UX em #1552.

O erro de download `ERR_BLOCKED_BY_CLIENT` foi observado no Chrome em #1567, embora
o MSI completo tenha sido baixado e seu hash verificado. O candidato declara o
link como download nativo e o teste desktop/mobile confirma que a página permanece
no Processamento; isso não desativa proteção do cliente nem comprova eliminação do
erro no redirecionamento real de Production.

## Estado atual

### Histórico de implementação — Overview — #580

A Overview dá precedência ao job em execução e à submissão. Progresso com
denominador válido pode começar em `0%`; sem denominador, a etapa permanece
visível sem barra nem mensagem de erro. `updated_at` não é tratado como
heartbeat. Métricas persistidas são rotuladas como **Último resultado concluído**
e ficam ocultas enquanto outro job está ativo. Elapsed continua indisponível
até um timestamp autoritativo persistido ser exposto pelo contrato (#603).
Benchmark é uma tab funcional para comparação exploratória local: usa a mesma
source Craig e o mesmo corte temporal de 0–300 s nos quatro perfis, executados
sequencialmente com artefatos já preparados. O receipt é sanitizado e registra a
identidade da amostra, lineage e métricas factuais; não contém transcript/áudio,
não cria run publicável e não escolhe vencedor. A referência humana local e as
[métricas objetivas de qualidade](processing-benchmark-quality.md) usam o bundle
imutável preservado; benchmarks sem referência ativa continuam explicitamente com
qualidade não medida. Este benchmark não substitui o aceite físico
de release definido em #478.
Desde #1233, prontidão de transcrição e prontidão de benchmark são contratos
separados. Whisper Runtime 1.1.5 permanece aceito para transcrição normal, e 1.1.7
foi o primeiro runtime a satisfazer o gate de execução/métricas do benchmark. Com
#1413, o contrato atual também exige que o worker congelado persista a evidência
textual imutável: por isso `benchmark_ready` exige Whisper >=1.1.10 e Qwen >=1.0.18.
Compatibilidade de artefato/rollback continua separada do protocolo de dispatch.
Para Whisper, o Craig atual exige worker >=1.1.10; versões anteriores podem continuar
verificáveis como artefatos históricos, mas não são anunciadas como prontas para
transcrição nem para o Benchmark atual. O Companion 0.3.21 anuncia a capability
`processing.benchmark.runtime-readiness-v2` e publica `benchmark_ready` separado
de `ready`. Cliente sem essa capability falha fechado para benchmark, sem bloquear
transcrição normal. A preparação iniciada por esta tab envia `purpose=benchmark`
e pode atualizar apenas o runtime necessário, preservando modelos, caches e dados.
Um benchmark só conclui quando cada um dos quatro receipts carrega lineage sanitizada com
o runtime artifact selado (worker/archive SHA-256) e a GPU NVIDIA efetivamente casada com
a execução; evidência ausente ou parcial falha fechado e não vira resultado comparável.

A evidência textual do benchmark é local, imutável e separada dos runs editoriais. Cada
perfil concluído persiste o próprio `tda_transcript_v1` canônico e um
`tda_benchmark_profile_artifact_v1` sob `Data/benchmarks/<benchmark-id>/profiles/`.
Somente depois dos quatro perfis verificados o Agent grava `benchmark.json`
(`tda_benchmark_bundle_v1`) como commit marker final. O bundle registra hashes/tamanhos,
sample 0–300 s, lineage, métricas e somente hash + comprimento de contexto/glossário; não
duplica áudio Craig, não cria `staging/.../runs`, compatibility mirror, review,
publicação ou sync cloud. Limpar a fila não remove o bundle. Retry forma outro
`benchmark-id`; replay idempotente da mesma tentativa só reutiliza bytes já validados.

Cada perfil também preserva diagnóstico estruturado no mesmo diretório:
`metrics.json`, `events.jsonl` e `telemetry.jsonl` quando o sampler está
disponível. `metrics.json` inclui todos os `stage_seconds` de
`engine_processing_v1`, total/RTF, fator realtime marcado como derivado, contagens,
proveniência fresh/reused, lineage de modelo/runtime/GPU, fingerprint de
contexto/glossário e timing autoritativo do supervisor. Preparação externa continua
explicitamente fora do timing da engine.

`events.jsonl` é capturado no boundary supervisor↔worker depois de validação do
protocolo e da sequência. Transições de stage, warnings, errors, recovery e terminal
ficam estruturadas por código; progress/heartbeat/eventos repetitivos podem ser
agregados em `BENCHMARK_EVENT_AGGREGATE` com count, primeiro/último worker seq e
janela relativa. O orçamento é limitado e evidência obrigatória excedida falha
fechado, em vez de ser silenciosamente truncada e chamada de raw.

A telemetria é best-effort, por padrão a cada ~1 s e limitada a 900 amostras por
perfil. A GPU é casada por UUID/PCI físico reportado pela execução, não pelo ordinal
NVML isolado. Cobertura, amostras esperadas/capturadas e motivo de ausência são
persistidos; VRAM e utilização GPU, CPU e RAM são agregados sobre a janela completa.
Temperatura/potência permanecem `null` enquanto a API local não as expuser com
semântica confiável. Falha do sampler não falha a transcrição.

O `benchmark.json` final inclui caminho, SHA-256 e tamanho desses diagnósticos para
cada perfil, tornando-os parte verificável da identidade do bundle. Persistência usa
allowlist e não recebe dump de environment, PATH/cwd, paths de instalação,
hostname/usuário, Authorization/cookies/tokens, speaker, filenames, áudio nem texto
da transcrição. Contexto e glossário entram apenas como hash + comprimento; o log
global `companion.log` não é copiado nem fatiado como evidência.

O receipt `tda_processing_benchmark_v1` continua pequeno: referências aditivas
(`benchmark_id`, hash/tamanho do bundle e SHA/tamanho do transcript por perfil) apontam
para conteúdo carregado sob demanda em
`GET /api/v1/benchmarks/<benchmark-id>` e
`GET /api/v1/benchmarks/<benchmark-id>/profiles/<profile>/transcript`. Esses endpoints
são privados, origin/session-bound no browser e verificam o artefato solicitado antes de
devolver texto. Receipts históricos sem `benchmark_id` continuam válidos como
performance-only e nunca têm transcript reconstruído por inferência.

Validação deste comportamento: `tests/processing/panel.spec.ts` cobre progresso
zero, ausência de denominador e a separação entre job ativo e métricas de run
terminal. Este estado descreve o candidato de código; não implica integração ou
publicação.

### Histórico de implementação — Command bar — #608 / #622

A barra persistente condensa lifecycle, telemetria da máquina, contadores e ações
contextuais; detalhes de hardware/versão ficam em Diagnóstico. Falha de uma amostra
mantém os valores anteriores, sem zerá-los. O controller separa falha operacional
(health/jobs), telemetria, eventos e biblioteca. Cada domínio limpa somente seu
erro ao recuperar; um catálogo não consultado mantém seu aviso anterior. Falha de
Resultados/eventos aparece na view dona, sem declarar a telemetria desatualizada.

O timestamp de leitura de telemetria só avança quando essa leitura tem sucesso.
Na ausência do vínculo físico da #641, o resumo escolhe deterministicamente o
menor índice do inventário e o identifica como `GPU N da máquina`; não afirma que
essa GPU executa ASR nem preenche lineage histórica com a amostra atual. Diagnóstico
continua exibindo o inventário completo. Ver diagnóstico de uma falha fixa o job
solicitado durante polling; sair da view, inclusive pelo atalho de atenção, libera
esse foco sem projetar eventos de outro job no cockpit ativo.

Validação usa fixtures sintéticas em desktop/mobile, falhas independentes por
domínio, recuperação parcial, inventário fora de ordem, temas e reduced motion.
Merge não confirma publicação; não há mudança de banco, áudio ou formato de run.

A linha de código vigente **TDA Companion 0.3.28** cobre:

- workbench próprio do Edit;
- conexão automática com o Agent em `http://127.0.0.1:8765/api/v1` via sessão temporária origin-bound;
- fila local persistida;
- eventos estruturados para log;
- telemetria best-effort de CPU, RAM, GPU e VRAM;
- aplicativo Windows `TDACompanion.exe`;
- instalador `TDACompanion-x64.msi` por usuário;
- link controlado pelo próprio TDA para baixar a versão instalável mais recente do Companion;
- ingest seguro de ZIP Craig pelo loopback local, com staging content-addressed e metadados sanitizados;
- submissão real de `transcription.craig` ao pipeline canônico do Companion;
- Desktop de execução local sem fluxo editorial duplicado: fila/stage/liveness, telemetria, logs, diagnóstico e manutenção;
- perfis atuais `qwen-quality`, `qwen-fast`, `whisper-detailed` e `whisper-turbo`, derivados das capabilities anunciadas pelo Agent;
- escrita local atômica de transcript somente após conclusão/validação do worker;
- **múltiplos runs concluídos imutáveis por source**, identificados por job + attempt;
- `run.json` versionado com lineage, modelo/perfil, hashes e métricas factuais;
- espelho `staging/<source>/transcript.json` mantido somente para compatibilidade 0.3.x, sem ser a fonte de verdade;
- migração não destrutiva de `transcript.json` legado válido para run histórico;
- endpoint local autenticado `GET /api/v1/sources/<source_id>/runs` com apenas metadados sanitizados;
- resultado do job com `sync.status = "not_configured"`.

O processamento Craig já é ASR real ponta a ponta no Agent, iniciado pela Web e acompanhado tanto na Web quanto no Desktop. `synthetic.fixture` continua existindo somente como ensaio sintético quando anunciado. Sincronização/publicação cloud permanece desativada: conclusão local não implica importação, revisão, canon ou publicação.

### Versão de código versus artefato publicado

A linha de código atual é o **TDA Companion 0.3.28**. O candidato inclui a fronteira de erros públicos por valores estáticos e validação explícita de identidade/containment dos receipts de qualidade (#1625); o canal Stable é 0.3.27; o candidato 0.3.28 exige aceite próprio e promoção deliberada. Versão no código não prova, sozinha, publicação Stable/RC nem aceite físico do artefato; release continua presa aos gates e receipts do pipeline. A correção #1614 mantém registros e contadores de cada página de jobs num snapshot SQLite consistente; exige atualizar o Agent e não altera os runtimes ASR. O aceite de 0.3.25 descrito abaixo é histórico e não certifica este novo candidato.

Na exportação SRT/VTT, segmentos pontuais reconhecidos são preservados como cues
de pelo menos 1 ms. Isso normaliza somente a representação da legenda; o JSON
canônico, seus hashes e o texto permanecem iguais. O ZIP inclui
`subtitle-timing.json` por perfil para declarar a regra e contar os ajustes.
Não apresentar esse mínimo de exibição como medição de fala ou ganho de qualidade.

O MSI 0.3.25 passou pelos recibos próprios de aceite instalado v3 e físico v2
na RTX 4070 Laptop / SM 8.9. A exportação do benchmark preservado (executado no
0.3.24) passou na API instalada 0.3.25, mantendo os quatro hashes canônicos e
125/126/72/76 falas. Isso não mede WER nem valida outro modelo de GPU.

O RC **0.3.26**, source `247f0edb4d168e792dffd7b8ce15fafc5d0d1bc7`, passou pelos
[receipts próprios de aceite instalado v3](../companion/acceptance/companion-rc-v0.3.26-247f0edb4d16.json)
e [físico v2](../companion/acceptance/companion-rc-v0.3.26-247f0edb4d16.physical.json).
O MSI instalado corresponde aos hashes da release oficial; recovery, conflito de
porta, retomada BITS e preservação da fonte foram medidos. Os quatro perfis
passaram na RTX 4070 Laptop / SM 8.9 com fala sintética em português de 110,588 s,
Whisper 1.1.12 e Qwen 1.0.20, sem gravar transcrições. Esse gate de GPU não mede
qualidade humana nem substitui o aceite anterior dos dois Craig reais. A promoção
Stable exige seu próprio receipt e não é inferida destes dois aceites.

Na Web, ZIP privado com `Content-Length` conhecido até 16 MiB usa o download
normal do navegador, mesmo quando a API de seleção de arquivo está disponível.
O feedback informa **download iniciado**, sem afirmar que o arquivo já foi salvo.
Quando o Companion envia um stream sem esse header, a Web lê um prefixo limitado
a 16 MiB mais o chunk que cruza o limite. Se o stream termina nesse limite, usa
o download normal; se ultrapassa, preserva o prefixo e continua por stream
quando a escrita nativa está disponível, sem acumular o restante em memória.
Arquivos maiores continuam usando escrita por
stream quando suportada; somente a conclusão da escrita informa **salvo**. Cancelamento
e falha têm feedback próprio, preservam os arquivos locais e liberam nova tentativa.
URLs de blob são liberadas após 60 segundos para não invalidar o download prematuramente.

O Companion 0.3.21 mantém **Whisper Runtime 1.1.4** como mínimo de formato/rollback histórico, mas exige **Whisper Runtime 1.1.10** para o protocolo Craig corrente; o mínimo normal continua **Qwen Runtime 1.0.12**. Benchmark usa mínimos próprios definidos em `runtime_compat.py`, atualmente Whisper 1.1.10 e Qwen 1.0.18. Durante rollout RC, o primeiro uso aceita somente o candidato publicado exato e verificado da versão compatível; um manifest Stable abaixo do mínimo de dispatch é ignorado como destino de transcrição e o fluxo pode preparar o RC publicado. Gate físico por perfil continua obrigatório para Qwen e para qualquer aceite de release que exija evidência da GPU real.

## Runs locais imutáveis — Slice 1

O Slice 1 implementa a fundação de **múltiplos runs por source**, sem overwrite entre Qwen/Whisper/retries.

Layout efetivo deste corte:

```text
Data/staging/craig-<source_sha>/
  manifest.json
  tracks/...
  transcript.json                 # somente mirror de compatibilidade 0.3.x
  runs/
    run-<job_id>-a1/
      transcript.json             # output bruto imutável
      run.json
    run-<job_id>-a2/
      transcript.json
      run.json
```

O uso de `staging/<source>` neste primeiro corte preserva o package root já consumido pelos engines e evita mover tracks/fontes durante a introdução do novo lifecycle. Não existe rotina automática que transforme `transcript.json` da raiz em fonte autoritativa: os diretórios de run são a evidência persistida.

Regras implementadas:

- nova tentativa ASR cria `run-<job>-a<attempt>` distinto;
- run concluído anterior nunca é reescrito por novo processamento;
- `run.json` é escrito somente depois do transcript final e funciona como commit do run concluído;
- diretório parcial/sem `run.json` não aparece como resultado concluído;
- hash integral pode revalidar o transcript do run;
- a listagem normal valida estrutura/tamanho sem rehash pesado a cada poll; publish futuro deve voltar a verificar hash integral antes de confiar nos bytes;
- contexto e glossário são representados no manifest por SHA-256 neste corte, sem expor o texto na listagem;
- transcript legado válido é copiado byte a byte para um run histórico e o original é preservado;
- mirror da raiz cujo hash já corresponde a um run existente não cria falso run legado duplicado;
- transcript legado inválido/corrompido não é promovido nem apagado automaticamente;
- a listagem local não retorna transcript integral nem caminho absoluto.

A área **Resultados** lista runs locais concluídos com suas métricas e permite abrir a revisão local. Comparação A/B, archive/Trash e publicação revisionada seguem os limites descritos na [spec dona](transcript-review-publication.md).

Exemplo de estado que a fundação passa a suportar:

```text
Craig source
  ├── Qwen Quality — concluído
  ├── Whisper Detailed — concluído
  ├── Qwen Quality + outro contexto — concluído
  └── tentativa interrompida — sem run concluído promovido
```

Cada run concluído preserva seu output bruto. Correções humanas futuras criarão revision derivada. A biblioteca local poderá comparar runs antes de publicar e continuará útil depois da primeira publicação para reprocessar, substituir ou restaurar conteúdo.

## Download e instalação

A tela de Processamento oferece uma ação compacta **Baixar TDA Companion** para Windows x64. O href fica sob controle do próprio TDA:

```text
/api/downloads/companion/windows
```

O resolver consulta releases públicas do repositório e escolhe a **maior versão instalável válida** entre:

- Stable `companion-vX.Y.Z`;
- RC/prerelease `companion-rc-vX.Y.Z-<source_sha12>`.

Para a mesma versão, Stable tem preferência sobre RC. Drafts e releases sem o asset/checksum esperado são recusadas. A UI exibe versão + canal e o download fica preso ao **tag exato** selecionado, evitando mostrar uma versão e baixar bytes de outra release concorrente.

Releases `prod-*` do site e runtimes auxiliares não entram nessa seleção.

Assim o frontend não depende de `/releases/latest` global nem de versão hardcoded.

O MSI instala em `%LOCALAPPDATA%\TDA\Companion`, mantém dados sob `%LOCALAPPDATA%\TDA` e cria atalho no Menu Iniciar. O antigo `DnDScribeCompanion.exe` não é usado, consultado ou modificado.

O MSI deste corte ainda não possui assinatura Authenticode configurada; a interface não deve afirmar que existe publisher assinado.

## Workbench de processamento

A tela segue a regra de que uma superfície operacional deve mostrar primeiro o trabalho. A primeira viewport prioriza:

1. tabs de trabalho com o estado compacto do Companion; problemas de conexão/telemetria ganham espaço e recuperação acionável;
2. trabalho ativo e stage/progresso factual ao lado da submissão de nova transcrição;
3. amostra atual de GPU/VRAM/CPU/RAM durante execução; sem job ativo, métricas do último run concluído claramente identificado;
4. indicação compacta de fila/atenção; listas completas ficam nas tabs Fila e Resultados;
5. detalhes e log do job observado ficam em Diagnóstico.

Sem job ativo, a área de processamento permanece compacta e informa se há trabalho aguardando. Métricas persistidas de um run nunca são atribuídas ao job ativo; valores não disponíveis permanecem desconhecidos. A UI não calcula ETA nem duração de execução até existir fonte temporal autoritativa.

Quando a biblioteca de runs entrar na UI, **fila operacional** e **resultados editoriais concluídos** devem continuar conceitos visualmente distintos. Um run antigo não pode parecer trabalho ainda em execução.

O título é compacto. A navegação própria do Edit é restrita a destinos de trabalho; o logo TDA é a saída intencional para a superfície pública.

O contexto de campanha reserva a área da marca/fade e do perfil fixos no desktop. Até 900 px, o workspace começa abaixo do chrome global; nome da campanha e seletor não ficam cobertos pela marca nem pelo botão da conta.

O estado desconectado não deve inventar dados. Métricas desconhecidas usam `—`/estado vazio. A página tenta conectar automaticamente ao Agent; se ele não estiver aberto, mostra uma ação direta **Abrir TDA Companion** e uma ação **Tentar novamente**. Credenciais não fazem parte da UX normal. Quando conectado, a faixa do computador mostra dados operacionais.

## Ingest Craig e perfis

A superfície Web envia o ZIP Craig somente para o Agent em loopback. O Companion cria um snapshot local, calcula identidade por conteúdo e reutiliza staging existente quando seguro. O frontend recebe apenas metadados necessários ao trabalho; caminho absoluto do disco não deve ser exposto ao JavaScript.

O hash integral das faixas pertence ao ingest/deep verification. No dispatch normal, o worker revalida manifesto, path e tamanho sem reler todos os bytes (`verify_tracks=false`). Isso evita que sessões grandes fiquem minutos em I/O antes da primeira etapa de ASR. O stage `source_validation` e heartbeats atualizam liveness real enquanto o pipeline entra em execução.

O envelope JSON local usa um orçamento autoritativo de **4096 bytes UTF-8** para requests POST da API v1. `context` e `glossary` continuam limitados semanticamente a **1200 valores Unicode** cada, mas a Web mede o JSON completo — incluindo kind, campaign/session/source/profile e os dois textos — antes da submissão. Um payload acima do orçamento é recusado localmente com diagnóstico acionável e o Agent mantém o mesmo limite fail-closed com `BODY_TOO_LARGE`. Contagem de caracteres não substitui a contagem de bytes de transporte.

O **TDA Web é a única entrada de produto para nova transcrição**: seleção do ZIP, perfil, contexto e glossário acontece em `/edit/[campaign]/processamento` (ou pelo entrypoint compatível `/edit/processamento` antes da seleção). O Desktop não possui mais o formulário concorrente; **Execução local** monitora fila/stage/liveness e concentra logs, diagnóstico, runtimes e manutenção.

Os perfis executáveis vêm de `capabilities`:

- `qwen-quality` — melhor precisão e opção recomendada;
- `qwen-fast` — Qwen priorizando velocidade;
- `whisper-detailed` — Whisper com maior qualidade;
- `whisper-turbo` — Whisper priorizando velocidade.

Qwen prepara runtime/modelos e executa o gate necessário antes do job. Para aceitação física, uma faixa Craig suficientemente longa pode gerar uma janela temporária de 180 s escolhida por energia; essa amostra é local e removida após o gate. O receipt do gate não deve carregar transcript integral.


## Intenção única de processamento

Na submissão simples, o CTA principal representa a intenção final do operador:
**começar a transcrição**. Depois desse clique, as etapas determinísticas seguem
automaticamente no mesmo fluxo: validação/staging do ZIP Craig, revalidação de
capabilities, preparação ou reaproveitamento de runtime/modelo/gate quando
necessária e enqueue idempotente do job. A interface continua expondo cada stage
e suas falhas factuais, mas não exige um botão de “continuar” entre etapas que
não carregam uma nova decisão humana.

Staging e validação do ZIP fazem parte do submit automático. Não existe CTA separado **Analisar ZIP** no fluxo normal; ferramentas de inspeção/reparo permanecem técnicas/recovery somente para
o caso em que o operador quer montar uma sessão com várias gravações antes de
processá-las. Estimativas podem aparecer assim que a source staged existe, mas
não viram uma confirmação obrigatória no caminho simples. Estados bloqueados,
incluindo incompatibilidade de runtime, continuam fail-closed antes de upload,
preparação ou criação de job quando o contrato de segurança assim exigir.

## Polimento do workspace — candidato #1571 / PR #1566

**Aceite visual reaberto em 07/10/2026.** As capturas de Production enviadas pelo
usuário demonstram que os ajustes abaixo não constituem acabamento concluído.
O candidato passa a reduzir o cartão de conclusão, recolher manutenção em
“Mais opções”, eliminar avisos de recuperação já superados e separar a revisão
da biblioteca individual. O retorno à biblioteca preserva a revisão e bloqueia
saída com alterações não salvas. Identificadores técnicos são expansíveis.
No benchmark, a execução destacada não é repetida no histórico; resultados
concluídos continuam disponíveis para comparação. Validação automatizada e
publicação não substituem aceite visual das cinco abas em uso real.
Uma revisão sem alterações pode ser concluída explicitamente, persistindo o
rascunho antes da aprovação. Isso não aprova nem envia a sessão automaticamente.
Depois do receipt de handoff, a ação principal abre a biblioteca da campanha
(canonicalizada pelo servidor autorizado para seu nome público); a ação
secundária abre a sessão diretamente no contexto técnico da mesma campanha.
O usuário não precisa escolher novamente a campanha na entrada legada global.

Quando Qwen Fast termina com `QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN`, a sessão oferece
“Processar com Qwen Quality” mediante confirmação explícita. O Companion preserva
os ZIPs e o histórico e cria novas execuções Quality para todas as gravações;
não mistura resultados Fast e Quality na mesma montagem nem exige selecionar
novamente os arquivos. A execução original continua marcada como falha. O
benchmark mantém sua comparação parcial e não recebe texto emprestado de outro
modelo. A recuperação foi validada em navegador sintético desktop/mobile; o
aceite físico desta recuperação permanece separado.
A lista de recursos técnicos do Diagnóstico fica recolhida e a Fila/Benchmark
usam texto de no mínimo 12 px nas declarações tipográficas fixas.

As cinco abas recebem uma orientação curta sobre finalidade e próxima ação;
detalhes permanecem nos disclosures existentes. A Fila distingue pausa de novas
execuções do trabalho atual; Diagnóstico esclarece que pausar a visualização não
pausa o processamento. Preparação, eventos de runtime e etapas observados no
Whisper são apresentados em português sem confundir segmento com job concluído.
O modo técnico preserva os códigos originais. A entrada de aba usa uma transição
de opacidade de 180 ms apenas quando movimento reduzido não está solicitado,
sem deslocar tabelas ou cabeçalhos fixos durante a troca.
Busca, filtros, cabeçalhos da fila, revisão e avisos usam rótulos em português;
identificadores técnicos e valores do protocolo continuam preservados.
No cockpit, atividade factual é o título e humor é detalhe. O log humanizado
mantém o fato antes da frase identificada como comentário, inclusive nas linhas
agrupadas; um pack customizado não substitui mais o estado factual do trabalho.
O contexto da faixa/voz no cockpit usa o evento mais recente da tentativa atual,
sem reaproveitar a voz de uma faixa anterior ou de outra tentativa (#1572).

Evidências locais: 61 testes de UX passaram (320 px a 4K, zoom, teclado,
fila densa, falha e log); check/build passaram. O aceite real dos dois ZIPs,
Qwen Fast e publicação continuam separados. Estes dados validam o candidato.

## Estimativa local calibrada de processamento

O candidato da PR #1566 preserva e apresenta as métricas dos perfis concluídos
também em um benchmark parcial: tempo medido, velocidade, modelo, runtime e GPU
quando presentes no recibo. Recibos antigos sem essas métricas permanecem legíveis.
Uma falha continua explicitamente parcial e não entra na calibração como 4/4.
Palavras e avisos não são indicadores de precisão. A comparação de qualidade
exige referência revisada, com erros e omissões medidos; esse aceite continua
separado das medições de desempenho físico (#1569 / #1570).

Depois que o ZIP Craig é analisado/staged localmente, a Web pode apresentar uma
faixa de duração por perfil usando o contrato `tda_processing_estimator_v1`.
O denominador é `audio_work_seconds` (soma factual das durações das tracks), não
a duração cronológica da sessão e não o percentual visual da fila.

A calibração v1 é deliberadamente conservadora:

- usa somente runs locais concluídos cuja métrica `engine_processing_v1` é
  elegível como trabalho ASR fresh; runs legados ou com checkpoint reuse não
  ensinam throughput fresh;
- exige a mesma identidade de profile/engine/model/model revision/runtime,
  bytes do worker, compute type e GPU/compute capability; quando UUID/PCI físico
  está disponível, runs de outra placa com o mesmo nome também são excluídos;
- dois runs fresh compatíveis tornam-se a fonte principal, limitada aos runs
  recentes e com mediana/faixa robusta + rejeição de outlier; sem esses runs, um
  benchmark compatível pode servir somente como prior bootstrap de confiança baixa;
- preparação necessária aparece separadamente e não é escondida dentro de uma
  promessa de tempo de download;
- nenhum áudio, transcript, path ou telemetria de calibração precisa sair do
  Companion/local browser para a cloud.

O benchmark de cinco minutos continua sendo evidência exploratória separada, mas
pode inicializar a estimativa quando ainda não existem dois runs fresh
compatíveis. Esse prior é sempre rotulado com confiança baixa e não vira um voto
permanente: um run fresh + benchmark continua baixa confiança; a partir de dois
runs fresh compatíveis, os runs dominam e o benchmark deixa de compor a faixa.
Assim, ordem, cache, warm state e thermal state de um único round sequencial não
são promovidos silenciosamente a precisão alta.

Durante um job, a faixa restante é recalculada a partir das durações das tracks
ainda não concluídas. Ela não usa `elapsed / percent` e não trata um text
checkpoint como se ASR + alignment já estivessem concluídos: somente trabalho
factualmente fechado deixa o denominador restante. Até existir um modelo
versionado de custo por stage em execução, a faixa é uma estimativa calibrada de
trabalho de áudio restante, não ETA garantido de wall-clock.

## Progresso e dados editoriais

A UI usa somente progresso que o Companion realmente reporta. `completed/total/unit` pode ser convertido em porcentagem quando esses valores existem; ausência de medida não vira estimativa.

A tela não inventa título, resumo, thumbnail ou classificação. Dados como duração, quantidade de arquivos, participantes, data e contagem de palavras entram somente quando a fonte real os fornecer.

O pipeline real pode fornecer contexto por track, incluindo `track`, `total_tracks`, `speaker` e `percent`. A interface deve refletir o paralelismo realmente executado pelo engine e não simular múltiplas faixas avançando ao mesmo tempo quando isso não estiver acontecendo.

Depois do término, métricas como palavras, segmentos, warnings, elapsed/RTF, modelo/revision e percentual revisado podem alimentar a auditoria local definida na spec de revisão. Campo ausente continua desconhecido; não se fabrica nota de qualidade.

Na Visão geral, progresso `completed/total` com denominador positivo pode mostrar `0%`; quando a unidade termina e a consolidação continua, mostrar a contagem e o stage sem declarar o job concluído. Telemetria de `/system` é sempre a amostra atual da máquina. Métricas de run aparecem somente quando não há job ativo e sob o rótulo **Último resultado concluído**; vêm do run imutável e campos ausentes aparecem como `—`. Duração de sessão só aparece quando o run declara semântica `session_extent_v1`. `updated_at` é a última atualização registrada do job, não um heartbeat nem prova isolada de que o worker continua vivo. Elapsed só pode ser mostrado a partir de timestamp autoritativo persistido no job/attempt, nunca do primeiro poll da página.

## Eventos e zueira

`GET /api/v1/jobs/{job_id}/events` fornece eventos factuais. A camada de apresentação pode adicionar comentários leves e engraçados, mas a telemetria original permanece separada.

Exemplos:

- `TRACK_PROGRESS` com speaker conhecido pode gerar uma segunda linha divertida sobre a voz daquele participante;
- redução de ruído só pode gerar piada sobre chiado se a etapa real existir;
- conversa ao fundo só aparece depois de uma detecção real;
- cachorro só aparece depois de um evento real correspondente.

O Companion persiste fatos, não piadas. A interface nunca deve fingir que executou uma operação só para ficar engraçada.

A alternância **Humanizada | Técnica** também é a política de densidade do log. Na Humanizada, spam rotineiro de sucesso explicitamente allowlisted é agregado automaticamente em uma linha operacional com contagem; warning, error, recovery, checkpoint e transições relevantes continuam factuais e não são escondidos por essa agregação. Na Técnica, a sequência estruturada é autoritativa e não recebe pacing cosmético: cada evento factual disponível continua acessível individualmente, preservando ordem, `seq`, contagem e filtros. Não existe preferência global **Agrupar repetitivos**. Se volumes técnicos futuros exigirem otimização visual, virtualização/row folding deve preservar contagem e acesso aos eventos originais em vez de mudar a semântica do log.

A interpolação de placeholders da camada Humanizada acontece em **uma única passagem sobre o template original**. Valores factuais inseridos são texto terminal: se um speaker contiver `{gpu}`, `<script>` ou qualquer outra sequência parecida com template/markup, esse valor não é reinterpretado como outro placeholder, HTML ou uma segunda linguagem de apresentação.


### Linguiça no Log — packs locais v1

A biblioteca custom da #606 usa `tda_activity_pack_v1` e, neste MVP, segue o modelo **browser-local untrusted data**. A capability `campaign.processing.barks.manage` decide server-side se a superfície administrativa aparece; ela não transforma `localStorage` em uma fronteira de segurança contra alguém que controla o próprio navegador/DevTools.

O namespace local é `profileId + campaign`. Cada leitura revalida o JSON pelo parser fechado antes de um pack participar da camada Humanizada. Não existe endpoint Web→Companion para mutar packs nesta versão.

Import é fail-all: limite de bytes → JSON → rejeição recursiva de `__proto__`/`constructor`/`prototype` → schema/campos fechados → semântica/event allowlist → preview → commit local. O campo `enabled` vindo do arquivo não autoativa conteúdo: todo import entra desativado e exige ativação explícita depois do preview. Conflito de `pack_id` nunca sobrescreve silenciosamente.

A identidade determinística de template é `(pack_id, template_id)`; dois packs podem ter o mesmo `template_id`, mas IDs duplicados dentro do mesmo pack são inválidos. O catálogo elegível é ordenado por essa identidade antes do seed, então a ordem de importação não altera a seleção.

Eventos aceitos em v1: `QWEN_WINDOW_TRANSCRIBED` e `WHISPER_SEGMENT_TRANSCRIBED`. Eventos críticos continuam fora da allowlist. Variáveis aceitas: `speaker`, `profile`, `attempt`, `track`, `total_tracks`, `window`, `segment`, `gpu` e `gpu_utilization`. Conditions declarativas aceitas: `speaker`, `profile`, `window_min`, `window_max`, `gpu_utilization_min` e `attempt_min`. Não existe linguagem de expressão, regex do pack, HTML, Markdown executável, handler, import, URL executável ou segunda passagem de interpolação.

O log Técnico continua lendo somente os eventos factuais do Companion. Packs custom só entram na apresentação Humanizada. Export contém configuração/templates do pack, nunca contexto runtime de speaker/evento/telemetria.

## Telemetria

Quando `system.telemetry` é anunciado, a UI consulta `GET /api/v1/system` e recebe uma projeção limitada de SO, CPU, RAM e GPUs. CPU/RAM usam `psutil`; NVIDIA GPU/VRAM usam NVML através de `nvidia-ml-py`.

Ausência de GPU NVIDIA, driver incompatível ou falha do sensor resulta em telemetria parcial e não desconecta a fila.

## Conexão local e segurança

A página consulta primeiro o health público mínimo para confirmar que existe um Agent compatível em `127.0.0.1:8765`. Em seguida chama `POST /api/v1/session` e recebe uma credencial temporária criada pelo próprio Agent. Não existe cópia/cola de token na UX normal.

A sessão do navegador:

- é aleatória e vive somente em memória;
- é armazenada no Agent apenas pelo digest SHA-256;
- é vinculada à Origin exata que fez o bootstrap;
- expira e some quando o Agent reinicia;
- não revela o token mestre persistido do Companion.

A credencial da sessão do navegador não vai para cookie, localStorage, sessionStorage, query string, log ou envio cloud. A única persistência Web local deste fluxo é a identidade **metadata-only** de um enqueue ainda sem resposta confirmada: escopo do perfil/campanha e assinatura da requisição ficam somente como SHA-256, junto da `Idempotency-Key`, IDs mínimos e timestamp. Contexto, glossário, token, áudio, transcript, path e bytes do ZIP nunca entram nesse registro. O registro expira em 24 horas, é limitado por escopo e é removido assim que o POST recebe resposta confirmada. Requests mantêm CORS, `credentials: omit`, `redirect: error`, `cache: no-store`, `referrerPolicy: no-referrer` e limites de payload/resposta.

O Companion escuta somente loopback, exige Host correto, restringe Origin e não descobre outros PCs. Se estiver fechado, a Web oferece `tda-companion://open` por ação explícita do usuário e tenta a conexão novamente; o site continua funcional mesmo sem o PC.

O token mestre continua disponível apenas como mecanismo técnico/nativo e não deve voltar a ser requisito de uso normal.

Áudio Craig e artefatos de preparação permanecem locais. O resultado Web não transporta transcript integral para frontend/cloud como efeito colateral do processamento.

## Fila e ações

Antes do `POST /jobs`, a Web persiste a identidade bounded da intenção de enqueue. Se o Agent tiver commitado o job mas a resposta HTTP se perder, um reload que reconstrói exatamente a mesma source/session/profile/configuração reutiliza a mesma `Idempotency-Key`; o próprio POST idempotente reconcilia a identidade sem depender da janela de `GET /jobs`. Uma resposta confirmada remove esse pending, portanto uma ação explícita posterior de processar novamente recebe chave nova. Reutilizar a chave não pula revalidação de capability, runtime/modelo ou preparação.

Disponibilidade atual do Companion e histórico recuperado da sessão são estados distintos. Um `timeout` ou `unreachable` ocorrido durante uma operação do composer/intenção é apresentado como erro enquanto continua atual. Depois de uma leitura nova e bem-sucedida de capabilities ou do snapshot completo da sessão, esse mesmo incidente deixa de competir com o estado **Pronto**: a Web o mantém uma única vez como histórico não bloqueante, iniciado por **“Na tentativa anterior…”**, e preserva separadamente a ação pendente do workspace. Reconectar não promove parts, não inventa run e não altera a contagem concluída; somente job/run confirmado altera o progresso. Se o ZIP original precisar ser selecionado novamente, a mesma source/session/profile/configuração recupera a identidade de enqueue ainda pendente; bytes diferentes com a mesma identidade lógica de gravação continuam exigindo decisão explícita de variante em vez de substituição automática.

Falha recuperável/interrupção permite **Repetir trabalho**. Esse retry terminal é diferente da reconciliação de enqueue: ele cria uma nova `attempt`, mas os engines podem reutilizar checkpoints locais por faixa quando a assinatura de source/profile/context/glossary/runtime continua compatível. Cada faixa reutilizada reaparece como progresso da nova tentativa; o checkpoint não reativa a tentativa anterior. Cancelar exige confirmação. Retomar fila confirma que trabalhos pendentes podem voltar a executar; pausar impede novos claims sem interromper o trabalho já ativo.

Em sessões com múltiplas gravações, **Recomeçar do zero** é uma operação diferente de Retry e de **Nova transcrição**. A ação exige confirmação, falha fechada enquanto houver job da sessão queued/running e grava no Companion um corte de geração autoritativo. Seleções de run, participant mapping e decisões de cronologia/composição da workspace são limpas; jobs/runs/assemblies anteriores continuam preservados como evidência, mas ficam inelegíveis para a geração corrente. A Web limpa também as identidades de enqueue/recovery do navegador, cria novas chaves para cada source e envia os jobs da nova geração com reutilização de checkpoint desativada. Os ZIPs/source staged permanecem como entrada local; reset não apaga publicação cloud nem altera outra campaign/session. Job terminal não recuperável nunca é apresentado como Retry seguro: nesse caso o caminho explícito é recomeçar a geração ou abrir o diagnóstico.

**Excluir sessão local** é a operação destrutiva de recuperação quando o operador quer abandonar a sessão local inteira em vez de preservar a geração anterior. Ela exige ausência de jobs queued/running, remove workspace, intent, decisões de composição e estado operacional terminal da sessão no Companion, limpa os ponteiros de recuperação do navegador e volta ao formulário vazio. O Companion mantém um fence técnico mínimo para impedir que artefatos antigos eventualmente ainda presentes no disco sejam elegíveis ou reutilizados ao recriar o mesmo session id. Publicações cloud não são alteradas.

No Qwen strict, a durabilidade é dividida em duas camadas. Depois que todas as janelas de uma **track** terminam o ASR, o texto e idioma por janela são persistidos atomicamente em um checkpoint técnico `tda_qwen_text_checkpoint_v1` antes do forced alignment. Esse artefato vive somente em `.checkpoints/<signature>/qwen-text-v1/`, não é transcript alinhado, não cria `run.json` e nunca é listável/publicável como resultado. Retry compatível pode reaproveitá-lo; antes do reuse o Companion valida schema, assinatura, hash interno, metadados da track e o SHA-256 real do FLAC staged. Mudança de source/perfil/model revision/runtime/receita/contexto/glossário ou dos bytes da track invalida/falha fechado. A granularidade é deliberadamente **por track**: crash no meio de uma track pode repetir aquela track, mas tracks cujo ASR terminou e foi checkpointado não precisam ser retranscritas por falha posterior do aligner.

Retry terminalizado cria nova `attempt` e, portanto, identidade de run distinta. Checkpoints seguros podem evitar retranscrever faixas já concluídas, mas **não continuam nem mutam o run anterior**: a nova tentativa reconstrói o próprio progresso e, se concluir, grava um novo run imutável. Resultado concluído anterior nunca é substituído por uma tentativa nova.

### Precedência entre cancelamento e commit do run

Para `transcription.craig`, cada `job_id + attempt` possui um fence local persistente em `.attempt-fences/`. Cancelamento e commit competem pelo **mesmo winner marker** com regra first-writer-wins:

- **cancel vence** quando a API reserva o fence antes da fase de commit; o job passa a `cancelled`, o worker não pode criar `run.json` para aquele attempt e qualquer diretório de run ainda não commitado é removido fail-closed;
- **commit vence** quando o worker reserva o fence depois de escrever/validar `transcript.json` e imediatamente antes do commit atômico de `run.json`; cancelamento tardio não reclassifica o attempt e responde conflito enquanto o commit termina ou `JOB_TERMINAL` depois do sucesso;
- se o Agent cair depois de `run.json` e antes de atualizar a fila, o startup reconcilia o run íntegro e conclui o mesmo attempt como `succeeded`;
- a listagem de runs correlaciona `job_id/attempt`, fence e estado da fila: attempt cancelado não é exposto como run concluído, inclusive para contradições históricas anteriores ao fence;
- o fence é scoped por attempt, portanto decisões de uma tentativa não alteram runs de tentativas anteriores nem bloqueiam um retry posterior;
- runs válidos de outras identidades/attempts não são apagados para resolver a corrida.

A decisão do fence não transforma partial/checkpoint em resultado. **Somente `run.json` válido continua sendo o commit marker autoritativo do run imutável.** Partials e checkpoints continuam não listáveis.

O ensaio sintético existe apenas quando `synthetic.fixture` é anunciado e não usa áudio/modelo/GPU para produzir transcrição.

## Resultado, revisão e publicação

A direção de UX após conclusão é:

```text
Processamento concluído
Resultado salvo localmente.
Nada foi publicado no TDA.

[ Revisar resultado ]
[ Comparar ]
[ Processar novamente ]
[ Publicar no TDA ]
```

A área **Resultados** já expõe revisão e comparação A/B local. A comparação aceita
somente dois runs concluídos da mesma fonte e exige a capability
`transcription.review.base`: o Companion devolve uma projeção somente-leitura do
transcript bruto imutável em
`GET /api/v1/sources/<source_id>/runs/<run_id>/review/base`, mesmo quando já
existe um draft humano. Abrir A/B não cria nem altera `draft.json`; somente a
escolha explícita de Run A ou Run B entra no fluxo editorial normal.

O alinhamento continua track-local, enquanto filtros e navegação usam
`timeline_start/timeline_end` absolutos da sessão. Métricas dos dois runs ficam
visíveis como fatos, mas a UI marca a comparabilidade de performance como
**limitada** quando faltam timing `engine_processing_v1` fresh, semântica de
duração equivalente, identidade exata do runtime ou identidade física de
execução. A comparação nunca escolhe vencedor automaticamente.

Companions sem `transcription.review.base` continuam compatíveis com a biblioteca
e revisão existentes; a Web não oferece A/B nesses Agents em vez de cair para um
snapshot editorial potencialmente mutado.

Publicação deve consumir **resultado/revision aprovado**, não o evento terminal do worker.

Depois de publicado, o mesmo source continua podendo gerar novos runs. A revisão ativa no site permanece intacta até uma nova publicação/substituição ser confirmada.

## Sincronização

A UI atual continua mostrando **Sincronização não configurada.** Conclusão local não significa envio, importação, revisão, canon ou publicação.

O handoff futuro passa a ser explicitamente:

```text
run concluído
  -> revisão/comparação local
  -> ação Publicar
  -> identidade server-side
  -> autorização explícita
  -> persistência de revision completa
  -> receipt/readback
  -> ativação atômica da revision
```

A candidata histórica de transcript import contém primitives úteis de hash/idempotência/atomicidade, mas deve ser adaptada a esse lifecycle antes de ser ativada.

## Retenção e armazenamento

Neste Slice 1, runs concluídos e source/staging permanecem locais até ação futura explícita de cleanup. Não foi adicionada limpeza automática de runs.

Archive e painel de armazenamento permanecem backlog separado. Delete local confirmado é destrutivo conforme ADR-0021; tombstone/quarantine existem para atomicidade/recovery e não oferecem restore de 7 dias. Limpeza de source não pode apagar transcrições concluídas implicitamente e deve explicar quando novo processamento exigir selecionar o ZIP Craig novamente.

## Validação

Gates web:

```text
pnpm check
pnpm build
pnpm test:processing
```

Gates do Companion:

- pytest em Windows e Linux;
- build do wheel;
- build do `TDACompanion.exe`;
- build do `TDACompanion-x64.msi`;
- smoke do executável empacotado;
- instalação real do MSI no runner Windows;
- inicialização + health do app instalado;
- desinstalação real do MSI;
- rollback/upgrade/preserve/purge quando o workflow correspondente for afetado;
- gates dos artifacts Whisper/Qwen e dependency freshness no SHA candidato.

Cobertura específica do Slice 1 inclui:

- dois runs do mesmo source coexistindo sem overwrite;
- retry/attempt com identidade distinta;
- mirror de compatibilidade mudando sem mutar run anterior;
- migração legada idempotente e não destrutiva;
- legado inválido sem promoção/delete implícito;
- tamper detectado por hash integral;
- listagem sanitizada sem transcript/path local;
- worker reprocessando sem criar falso run legado a partir do mirror;
- boundary HTTP de runs com autenticação/CORS estreitos.

Slices futuros devem acrescentar testes para:

- revisão sem mutar output bruto;
- comparação A/B por speaker/timeline;
- publish explícito/idempotente;
- substituição preservando anterior;
- restore/unpublish/delete conforme escopo;
- ausência de áudio bruto em payload cloud.

Esses testes automatizados não substituem o gate de qualidade/desempenho em GPU física. A aprovação física final dos perfis que a exigem deve registrar runtime/model revision, GPU/VRAM observada, elapsed/RTF e avaliação qualitativa adequada ao perfil.

### Histórico de implementação — Métricas animadas — #601 / PR #623

A barra interpola somente os números visuais de GPU/CPU/RAM por 350–700 ms,
com easing sem overshoot. O controller, o timestamp da amostra e o `meter`
acessível recebem imediatamente o target factual; valores intermediários não
são amostras nem são persistidos. Novo target parte do valor visual atual.
Movimento reduzido e aba oculta encerram o RAF e saltam ao target; desmontar
cancela o frame pendente. Valores de memória reservam largura tabular.

Progresso usa `scaleX` e mantém `progress` acessível factual. Identidade do job,
tentativa e stage delimitam a animação: novo attempt/stage remonta a barra,
impedindo interpolação regressiva entre execuções. Dentro desse contexto o
valor continua sendo o informado pelo worker, sem inventar uma medição maior.
Microtransições de estado duram 180 ms e respeitam movimento reduzido.

Validação: testes sintéticos do interpolador e navegador cobrem rebase,
telemetria acessível, cancelamento em aba oculta, movimento reduzido, reset
de tentativa e largura estável. A validação local/CI não publica o frontend.

### Histórico de implementação — Fila operacional — #610 / PR #624

Aceite adicional de 0.3.27: os receipts instalado v3 e físico v2 estão em
`docs/companion/acceptance/companion-rc-v0.3.27-55f3813dd2a9.json` e
`.physical.json`, vinculados ao MSI SHA-256
`585f47ade01d31cfabcf1be617ff4604652a940d2c2f390ded2654da1c27c5dd`.
Os quatro perfis passaram na RTX 4070 Laptop; ingestão e recuperação usaram
o ZIP Craig real de quatro faixas. Promoção e download Stable ainda exigem
seus próprios resultados operacionais. Os runtimes ASR permanecem iguais.

A Fila usa tabela HTML no desktop, com rolagem e cabeçalho próprios, e linhas
empilhadas no mobile. O recorte inicial contém ativos; filtros locais de atenção,
concluídos, cancelados e todos, busca e ordenação operam sobre os jobs carregados.
Paginação e totais globais continuam gates separados (#651/#634). Sessão/source
identifica a linha; profile, tentativa, stage, medida factual e erro completam o
contexto. Não são inventados speaker, checkpoint ou duração por row.

O disclosure Mais usa portal fixo no viewport, flip vertical e margem horizontal.
Escape/Shift+Tab restauram o trigger; Tab no fim continua a sequência da página;
foco/click externos fecham. Scroll que move o anchor, resize, troca de filtro ou
desmontagem removem o popup, mantendo o scroll owner e sticky header da tabela.
Abrir Diagnóstico seleciona explicitamente o job daquela linha. Limpar uma row
da fila preserva runs imutáveis, revisões e fontes; a confirmação distingue essa
operação de apagar um resultado. A autoridade após cleanup segue no gate #644.

Validação sintética do candidato inclui lista de 30 jobs, última linha, bounds
e hit testing do popup, foco/teclado, 1024x768, proxy de zoom 512x384 e 320px.
Screenshots desktop/mobile foram inspecionados. Código validado não é publicação.

### ZIP FLAC comum — candidato 0.3.28 / #1631

Além do export Craig, o importador local aceita um ZIP plano contendo somente
FLACs com nomes comuns (por exemplo, exports do Audacity). O nome sem extensão
vira o rótulo da faixa; números determinísticos e paths físicos canônicos são
atribuídos sem renomear os arquivos originais. Faixas no mesmo ZIP compartilham
o zero temporal: representam gravações simultâneas já alinhadas. Trechos em
sequência devem ser ZIPs distintos ordenados na sessão; não é inventado horário
absoluto, alinhamento acústico nem identidade Discord.

Metadados Craig misturados com nomes comuns são recusados para não reinterpretar
um export parcialmente inválido. Os limites de tamanho, compressão, quantidade,
nomes únicos, raiz plana e links permanecem. Manifest reload valida o nome e
rótulo junto com hash, tamanho e path canônico. Áudio permanece local.

Validação local com o ZIP real de dois FLACs passou ingestão e reload: durações
1930.205 e 1935.545 segundos. Isso ainda não certifica release instalada ou
transcrição concluída; esses estados serão registrados no issue #1631.
