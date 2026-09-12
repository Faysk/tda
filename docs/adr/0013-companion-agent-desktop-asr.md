# ADR-0013 — TDA Companion como Agent local, Desktop de controle e runtime ASR multi-engine

> Status: accepted
> Data: 2026-09-11
> Owner: local-companion / processing
> Relacionados: ADR-0003, ADR-0007, `docs/features/local-processing.md`, `docs/integrations/local-companion-v1.md`

## Contexto

O TDA depende de processamento local para tarefas pesadas, mantendo o produto cloud disponível independentemente do computador do usuário. O corte `TDA Companion 0.2.x` provou instalação MSI por usuário, loopback API, fila persistida, eventos, telemetria e integração com `/edit/processamento`, mas ainda possui três limitações estruturais:

1. a janela desktop e o servidor local pertencem ao mesmo processo/lifecycle; fechar a janela encerra o serviço;
2. a interface Windows atual em Tkinter é apenas bootstrap técnico e não representa o Design System do TDA;
3. o supervisor HTTP ainda executa somente `synthetic.fixture`; o ASR preservado não é job oficial.

Também existe conhecimento validado no legado que não deve ser descartado. Os perfis `Whisper large-v3-turbo` e `Whisper large-v3`, via faster-whisper/CTranslate2, funcionaram em sessões reais em português com idioma fixo, VAD, word timestamps, beam search, glossário/hotwords, checkpoints por track, GPU-first e fallback de compute type.

Ao mesmo tempo, Qwen3-ASR introduziu em 2026 modelos 0.6B/1.7B com suporte explícito a português, contexto e um Forced Aligner 0.6B com suporte a português e timestamps de palavra. O formato Craig utilizado pelo TDA traz uma faixa FLAC por participante dentro de um ZIP; as tracks compartilham uma timeline comum. Portanto o produto não precisa inferir speaker por diarização quando a identidade da track é conhecida.

## Decisão

### 1. Separar lifecycle do Agent e da UI

O `TDACompanion.exe` passa a ter modos explícitos:

```text
TDACompanion.exe --agent
TDACompanion.exe --ui
TDACompanion.exe --diagnose
```

O **Agent** é o dono de:

- loopback API;
- SQLite local;
- fila/jobs;
- eventos factuais;
- telemetria;
- logs técnicos;
- model registry/downloads;
- supervisor de workers pesados;
- estado de update.

A **UI Desktop** é cliente local do Agent. Fechar a janela não encerra trabalhos. Encerrar o Agent é uma ação separada e protegida quando houver trabalho ativo.

### 2. Agent por usuário, não Windows Service administrativo

O Companion permanece `perUser`, sem exigir elevação. O Agent inicia no login do usuário através de mecanismo per-user do Windows e executa sem janela.

Não será introduzido Windows Service/LocalSystem neste corte. O processamento pertence à sessão e aos arquivos do usuário; manter o runtime per-user reduz permissões, instalação administrativa e diferenças de ownership.

### 3. Desktop com WebView2 e Design System TDA

Tkinter deixa de ser a UI de produto após a transição. O Desktop usará WebView2 através de uma camada leve compatível com o runtime Python empacotado, preferencialmente `pywebview`, consumindo assets locais HTML/CSS/JS.

A UI reutiliza semanticamente os tokens oficiais do TDA e possui quatro superfícies:

- **Visão geral** — saúde do Agent, hardware, consumo, atividade local e ações principais;
- **Logs** — logs técnicos do sistema, separados dos eventos editoriais/jobs mostrados na Web;
- **Diagnóstico** — checks não destrutivos e export de pacote sanitizado;
- **Configurações** — startup, tray, updates, storage, modelos, pareamento, reparar e desinstalar.

A Web continua sendo o lugar principal para sessões, fila editorial, resultados, revisão e publicação. O Desktop não replica o Edit.

### 4. Separar installation, state, data, logs, cache e models

Layout alvo:

```text
%LOCALAPPDATA%\TDA\
├── Companion\
│   ├── current-version.txt
│   └── versions\<version>\...
├── State\
│   ├── pairing-token.txt
│   ├── settings.json
│   └── install-metadata.json
├── Data\
│   └── jobs.sqlite3
├── Logs\
├── Cache\
│   └── updates\
└── Models\
    ├── qwen3-asr-0.6b\
    ├── qwen3-asr-1.7b\
    ├── qwen3-forced-aligner-0.6b\
    ├── faster-whisper-large-v3-turbo\
    └── faster-whisper-large-v3\
```

Upgrade do Companion substitui binários, mas não remove State/Data/Models. Migração 0.2→0.3 preserva token, device id e jobs.

### 5. Logs técnicos e eventos de jobs são conceitos distintos

Eventos de job continuam persistindo fatos de negócio/processamento (`TRACK_PROGRESS`, `MODEL_LOADED`, etc.). A Web pode acrescentar comentários leves ou engraçados em apresentação, sem alterar o fato persistido.

O Agent ganha logger técnico estruturado/rotacionado com campos como:

```json
{
  "at": "2026-09-11T14:00:00Z",
  "level": "info",
  "component": "worker",
  "code": "ASR_WORKER_READY",
  "message": "ASR worker ready",
  "context": {"engine": "qwen3", "profile": "quality"}
}
```

Tokens, conteúdo de áudio, texto integral de transcrição e segredos não entram em logs técnicos.

### 6. Update pelo próprio Companion, com verificação antes de aplicar

A Web mantém o download inicial do MSI. Depois de instalado, o Companion consulta um manifest estável do TDA com versão, asset, tamanho e SHA-256.

Update:

1. verifica versão;
2. baixa MSI para `Cache\updates`;
3. verifica SHA-256;
4. não interrompe job ativo;
5. inicia helper de atualização;
6. encerra UI/Agent de forma coordenada;
7. aplica upgrade MSI;
8. valida nova instalação/health;
9. reinicia Agent.

Auto-update totalmente silencioso só deve ser habilitado após assinatura de código confiável. Sem Authenticode, instalação de update exige confirmação explícita.

### 7. MSI é a autoridade de instalação/desinstalação

Scripts PowerShell portáteis podem continuar como ferramentas de desenvolvimento, mas a instalação de produto usa o MSI.

A desinstalação oferece dois níveis:

- **Remover aplicativo e manter dados** — remove binários/startup/atalhos/integrações, preserva State/Data/Models;
- **Remover completamente** — além do anterior, remove State/Data/Logs/Cache/Models e `%LOCALAPPDATA%\TDA` se vazio.

`100% removido` significa ausência de artefatos pertencentes ao TDA: processos, listener 8765, startup entry, atalhos, chaves de registro do produto, binários e raízes locais escolhidas. Não significa apagar caches internos do Windows Installer, Defender, Prefetch ou logs do próprio Windows.

### 8. Worker pesado fora do processo HTTP

ASR não executa dentro do event loop/processo principal do FastAPI. O Agent supervisiona um processo filho por trabalho pesado ou um worker dedicado com protocolo local controlado.

Crash CUDA/modelo transforma o job em `interrupted`/falha recuperável e mantém Agent, Desktop e loopback API vivos.

Fila ociosa deixa de consultar SQLite a cada 100 ms como mecanismo principal; submissão/retry/resume sinalizam o worker por evento, com wake periódico apenas como safety net.

### 9. Ingest oficial de Craig ZIP

O job ASR aceita pacote ZIP de Craig contendo 1..N tracks de áudio e metadata disponível (`info.txt`, `raw.dat` quando presentes). O ingest:

- valida ZIP/path traversal/limites;
- extrai para staging isolado;
- identifica somente formatos suportados;
- lê participantes de metadata/nome das tracks quando possível;
- preserva a timeline absoluta comum;
- não usa diarização para descobrir speaker quando a track já representa um participante.

Silêncio pode ser evitado por VAD para economizar inferência, mas offsets absolutos nunca são removidos do resultado.

### 10. Quatro perfis ASR disponíveis

O TDA oferece quatro perfis, todos com idioma português explícito por padrão:

| Família | Perfil | Modelo |
| --- | --- | --- |
| Qwen3 | Rápido | `Qwen/Qwen3-ASR-0.6B` |
| Qwen3 | Máxima qualidade | `Qwen/Qwen3-ASR-1.7B` |
| Whisper | Turbo clássico | `large-v3-turbo` via faster-whisper |
| Whisper | Detalhado clássico | `large-v3` via faster-whisper |

Os perfis Whisper preservam inicialmente as decisões comprovadas do legado:

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
fallback int8_float16 em OOM compatível
CPU somente quando solicitado
```

Qwen3 recebe `language="Portuguese"` e contexto limitado de campanha. O contexto nunca autoriza completar fala ausente.

### 11. Forced alignment comum quando disponível

`Qwen/Qwen3-ForcedAligner-0.6B` é o alinhador preferencial para timestamps finais em português.

- Qwen3 pode produzir timestamps através dele diretamente;
- Whisper mantém seus word timestamps nativos como evidência/fallback e pode ter o texto refinado temporalmente pelo mesmo aligner;
- falha do aligner não apaga uma transcrição já concluída; o resultado marca a origem/qualidade do timestamp.

O scheduler respeita o limite temporal do aligner e trabalha em janelas menores, preservando offsets absolutos.

### 12. Reconstrução de diálogo multitrack

Após transcrição/alinhamento:

1. cada palavra/segmento recebe speaker = identidade da track;
2. todos os itens são projetados na timeline comum;
3. cross-track deduplication detecta bleed/crosstalk duplicado usando sobreposição temporal, similaridade textual, energia relativa e confiança;
4. fala simultânea semanticamente diferente permanece como overlap real;
5. palavras/segmentos são agrupados em turnos de diálogo sem apagar timestamps originais.

O output canônico do pipeline independe da engine escolhida.

### 13. Modelos são downloads gerenciados, não parte do MSI

O MSI contém Agent/Desktop/runtime mínimo. Pesos ASR e dependências pesadas ficam em `Models`/runtime isolado e são baixados sob ação/seleção explícita, com versão/revision/hash registrados.

O Companion nunca altera CUDA/Python/PATH global do usuário. Runtime GPU fica isolado do ComfyUI e de outras ferramentas.

A primeira baseline Qwen usa runtime CUDA/PyTorch validado em CI/máquina física; `mais novo` não é requisito por si só. A decisão de subir CUDA depende de compatibilidade medida e regressão zero.

### 14. Benchmark real decide o perfil padrão

Nenhuma família é declarada vencedora apenas por benchmark público. Antes de definir o default final, o TDA possui harness A/B com áudio real de sessões em português medindo:

- erro textual em amostra revisada;
- nomes de personagens/locais/termos de D&D;
- timestamps;
- fala simultânea/crosstalk;
- ruído/risada/microfone ruim;
- tempo total e RTF;
- VRAM máxima e utilização GPU;
- recoverability/checkpoints.

Qwen3 e Whisper permanecem opções mesmo após um default ser escolhido.

## Consequências

### Positivas

- processamento continua quando a janela fecha;
- falha do worker não derruba API/UI;
- desktop ganha identidade TDA sem reescrever o backend;
- instalação continua sem admin;
- modelos podem evoluir independentemente do MSI;
- legado Whisper comprovado é preservado;
- nova família Qwen entra sem quebrar output/protocolo;
- Craig multitrack elimina necessidade de diarização primária;
- uninstall/update tornam-se verificáveis por CI.

### Custos

- lifecycle ganha múltiplos processos;
- update exige helper e mais estados de falha;
- WebView2/pywebview adicionam dependência de runtime/empacotamento;
- ASR passa a manter duas famílias de engine;
- testes Windows ficam mais longos e precisam validar upgrade/purge;
- qualidade ASR real exige corpus de avaliação física, não apenas unit tests.

## Não decisões

Este ADR não ativa publicação cloud, não envia áudio para o servidor, não torna o Agent acessível na LAN e não autoriza descoberta automática de outros PCs.

Não há decisão de remover Whisper, adotar Parakeet como quinta engine, usar Windows Service administrativo ou tornar auto-update silencioso antes de assinatura de código.

## Referências de pesquisa

- Microsoft WebView2 distribution/evergreen runtime: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Microsoft `Run`/`RunOnce` per-user startup: https://learn.microsoft.com/windows/win32/setupapi/run-and-runonce-registry-keys
- Qwen3-ASR oficial: https://github.com/QwenLM/Qwen3-ASR
- faster-whisper oficial: https://github.com/SYSTRAN/faster-whisper
- Craig multitrack implementation: https://github.com/CraigChat/craig
