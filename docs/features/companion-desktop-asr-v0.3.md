# TDA Companion v0.3 — Desktop, Agent e ASR

> Status: especificação aceita para implementação
> Owner: local-companion / processing
> Última revisão: 2026-09-11
> ADR: `docs/adr/0013-companion-agent-desktop-asr.md`

## Princípio do produto

**A Web gerencia o trabalho; o Companion gerencia a máquina que executa o trabalho.**

A Web continua responsável por sessões, fila editorial, revisão, resultados e publicação. O Desktop cuida de Agent, saúde, consumo, logs técnicos, diagnóstico, modelos, update, storage e manutenção.

## Arquitetura

```text
Windows login
  -> TDACompanion.exe --agent
       -> loopback API 127.0.0.1:8765
       -> SQLite / queue / events
       -> telemetry / system logs
       -> model registry / updates
       -> ASR worker subprocess

TDACompanion.exe --ui
  -> WebView2 local UI -> Agent

TDA Web/Edit
  -> pareamento explícito -> Agent
```

Fechar a janela não encerra o Agent nem o processamento. Crash da UI não afeta Agent. Crash do worker não derruba Agent/API/UI.

## Startup e raízes locais

O Agent permanece per-user, sem Windows Service administrativo. `Iniciar com o Windows` usa startup por usuário.

Layout alvo:

```text
%LOCALAPPDATA%\TDA\
├── Companion\versions\<version>\
├── State\
├── Data\
├── Logs\
├── Cache\updates\
└── Models\
```

Upgrade substitui binários, mas preserva State/Data/Models. A migração 0.2→0.3 preserva token de pareamento, device id e `jobs.sqlite3`. Nenhum diretório DnDScribe é consultado ou modificado.

## Desktop

Tkinter deixa de ser UI de produto. A implementação preferida é WebView2/Edge Chromium via camada leve Python compatível com PyInstaller, com assets HTML/CSS/JS locais e tokens do Design System TDA.

Navegação:

```text
Visão geral
Logs
Diagnóstico
Configurações
```

### Visão geral

Mostrar:

- estado e uptime do Agent;
- versão e update disponível;
- Windows/CPU/GPU;
- GPU e VRAM;
- CPU e RAM;
- espaço livre do volume de Data;
- processando / na fila / concluídos / com atenção;
- Abrir TDA;
- pausar/retomar novas execuções;
- reiniciar Agent;
- abrir pasta local.

O Desktop não replica sessões, mundo, lores ou revisão editorial.

### Tray

Quando habilitado, menu mínimo:

```text
Abrir Companion
Abrir TDA
Pausar/retomar fila
Reiniciar Agent
Encerrar Agent
```

O botão X apenas oculta/fecha a UI conforme preferência. `Encerrar Agent` é uma ação diferente e exige cuidado com job ativo.

## Logs técnicos

Separar `system logs` de `job events`.

Log técnico estruturado contém timestamp, level, component, code, mensagem curta e contexto pequeno. Componentes: bootstrap, agent, api, storage, queue, worker, asr, aligner, gpu, models, update, installer e diagnostics.

Não registrar segredo de pareamento, Authorization, áudio ou texto integral de transcrição.

Baseline de retenção: rotação de 10 MiB, até 5 arquivos ou 14 dias. Debug desligado por padrão em release.

## Diagnóstico

Checks não destrutivos:

- Agent e loopback API;
- ownership/uso da porta 8765;
- escrita em State/Data;
- SQLite integrity check;
- espaço livre;
- WebView2 runtime;
- NVIDIA/NVML;
- runtime CUDA da engine instalada;
- integridade dos modelos;
- spawn do ASR worker;
- endpoint de update.

Export gera ZIP sanitizado com manifest/system/health/model state/logs recentes, sem credenciais, áudio ou transcrição integral.

## Configurações

- iniciar com Windows;
- tray;
- update automático apenas para verificação;
- tema;
- comportamento ao fechar;
- paths/tamanho de Data e Models;
- copiar/regenerar pareamento;
- instalar/remover modelos;
- versão/API/build;
- reparar;
- desinstalar.

## Update

Novo endpoint cloud alvo:

```text
GET /api/downloads/companion/windows/manifest
```

Retorna versão estável, tag, asset MSI, tamanho e SHA-256. O Companion baixa para Cache, verifica SHA-256 e só então inicia o fluxo MSI.

Não interromper job ativo para atualizar. Sem assinatura Authenticode confiável, a aplicação da atualização exige confirmação explícita.

## MSI e desinstalação

WiX/MSI continua per-user.

Dois fluxos:

1. **Remover aplicativo e manter dados** — remove binários, startup, atalhos e integrações; preserva State/Data/Models.
2. **Remover completamente** — também remove State/Data/Logs/Cache/Models e `%LOCALAPPDATA%\TDA` se vazio.

CI deve validar fresh install, upgrade N-1→N, uninstall mantendo dados e purge completo, incluindo processo encerrado e porta loopback fechada.

## API local

`api_version="1"` permanece enquanto mudanças forem aditivas. Capabilities candidatas:

```text
agent.desktop
agent.logs
agent.diagnostics
agent.updates
models.manage
transcription.craig
transcription.qwen3
transcription.whisper
alignment.qwen3
```

A UI Desktop não justifica enfraquecer CORS/Origin do browser. Ações sensíveis continuam privadas.

## ASR — quatro perfis

Idioma padrão: português explícito.

| ID | Modelo |
| --- | --- |
| `qwen-fast` | `Qwen/Qwen3-ASR-0.6B` |
| `qwen-quality` | `Qwen/Qwen3-ASR-1.7B` |
| `whisper-turbo` | `dropbox-dash/faster-whisper-large-v3-turbo` |
| `whisper-detailed` | `Systran/faster-whisper-large-v3` |

Alinhador preferencial:

```text
Qwen/Qwen3-ForcedAligner-0.6B
```

### Receita Whisper preservada

A implementação nova mantém inicialmente a receita comprovada do legado:

```text
language=pt
task=transcribe
beam_size=5
vad_filter=true
min_silence_duration_ms=500
speech_pad_ms=300
word_timestamps=true
condition_on_previous_text=false
hotwords=glossary
initial_prompt com contexto de RPG/campanha
GPU-first float16
fallback int8_float16 quando suportado
CPU somente quando solicitado
```

### Receita Qwen inicial

```text
language=Portuguese
dtype=bfloat16
device_map=cuda:0
context limitado da campanha
batch adaptativo para 8 GB de VRAM
```

Transformers é a baseline Windows inicial; vLLM fica para benchmark posterior. FlashAttention só entra após validação de empacotamento/compatibilidade no runtime isolado.

## CUDA e modelos

O Companion não altera CUDA Toolkit, Python ou PATH global do usuário. Runtime de ASR é isolado e versionado.

Modelos não entram no MSI; são downloads gerenciados em `%LOCALAPPDATA%\TDA\Models`. Cada instalação registra ID, revision e hash.

A baseline CUDA/PyTorch/CTranslate2 é pinada por release e validada em RTX 4070 8 GB. Versão mais nova de CUDA só substitui a baseline quando demonstrar compatibilidade e zero regressão.

## Craig ZIP

Novo job: `transcription.craig`.

Entrada esperada: ZIP com 1..N tracks de áudio, `info.txt` opcional e `raw.dat` opcional. O ingest rejeita path traversal, paths absolutos, links inesperados, quantidade/tamanho descompactado fora do limite e archives aninhados não suportados.

Cada track guarda speaker, filename, hash, duração e `timeline_offset_seconds=0` quando o pacote Craig confirma timeline comum.

A Web não envia path arbitrário do filesystem; jobs usam IDs opacos de staging local.

## Pipeline

```text
package_validation
metadata
track_probe
speech_regions
model_prepare
transcription
alignment
cross_track_dedup
merge_timeline
turn_building
result_prepare
complete
```

VAD economiza inferência, mas não remove tempo: regiões de fala mantêm offsets absolutos.

O scheduler trabalha por janelas/regiões, não exige completar uma track inteira de horas antes das demais. Batch deve ocupar a GPU sem estourar VRAM.

## Alinhamento

O Forced Aligner Qwen suporta português e é o refinamento temporal preferido. Qwen usa o aligner diretamente; Whisper mantém timestamps nativos como fallback e pode ter o texto refinado pelo mesmo aligner.

Falha de alignment não descarta transcrição já concluída. O resultado informa `alignment_source`.

## Cross-track dedup e diálogo

Craig já fornece speaker por track, então diarização não é o mecanismo primário.

Bleed/crosstalk duplicado só é suprimido quando houver combinação forte de overlap temporal, similaridade textual e evidência de track dominante por energia/confiança. Duas falas diferentes ao mesmo tempo continuam como overlap real.

Depois, palavras/segmentos são ordenados pela timeline comum e agrupados em turnos sem alterar timestamps originais.

## Contexto e glossário

Contexto estático pode incluir participantes, personagens, NPCs, locais e termos de D&D. Contexto dinâmico pode usar poucos turnos anteriores com limite rígido.

Contexto ajuda reconhecimento; nunca deve funcionar como autorização para inventar fala ausente.

## Checkpoints

Checkpoint inclui assinatura do request, source hash, engine/profile, model revision, hash de contexto/glossário e versões de VAD/alignment. Só é reutilizado quando compatível.

O comportamento validado do legado — reaproveitar tracks concluídas após interrupção — deve permanecer.

## Output canônico

Qwen e Whisper convergem para o mesmo `tda_transcript_v1`, contendo engine metadata, language, tracks, words, turns e metrics (duração, elapsed, RTF, VRAM quando disponível). A Web não depende de classes internas da engine.

## Benchmark obrigatório

Antes de escolher um default definitivo, rodar os quatro perfis sobre áudio real revisado do TDA, incluindo PT-BR normal, fala rápida, nomes próprios, termos de D&D, overlaps, bleed, ruído, eco e risada.

Medir qualidade textual, nomes, erro temporal em pontos anotados, elapsed, RTF, pico de VRAM, uso GPU e recoverability.

## Ordem de implementação

1. Agent independente, novos roots, startup e logs.
2. Desktop WebView2, tray, diagnóstico e configurações.
3. update, repair, upgrade e uninstall/purge.
4. ingest Craig + worker subprocess + schema canônico.
5. Whisper Turbo + Detailed reais.
6. Qwen 0.6B + 1.7B + Forced Aligner.
7. dedup multitrack, merge, turn building e benchmark.
8. Web: selector de perfil, ingest e visual operacional usando apenas dados reais.

## Definition of Done v0.3

Só chamar v0.3 de concluído quando:

- Agent sobreviver ao fechamento/crash da UI;
- MSI fresh install/upgrade/uninstall/purge estiver validado;
- startup/tray/logs/diagnóstico/update estiverem funcionais;
- os quatro perfis executarem job Craig real em português;
- alignment/fallback estiver explícito;
- checkpoint/restart estiver comprovado;
- output for canônico e independente da engine;
- benchmark em RTX 4070 8 GB estiver registrado;
- docs descreverem exatamente o que está ativo.

## Referências

- https://github.com/QwenLM/Qwen3-ASR
- https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B
- https://github.com/SYSTRAN/faster-whisper
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/
- https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- https://learn.microsoft.com/windows/win32/setupapi/run-and-runonce-registry-keys
- https://github.com/CraigChat/craig
