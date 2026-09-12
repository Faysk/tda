# Companion — operação, instalação e rollback

> Status: implementação candidata v0.3 em validação
> Owner: local-companion/processing
> Última revisão: 2026-09-11

Referências: [contrato API](../integrations/local-companion-v1.md), [especificação v0.3](../features/companion-desktop-asr-v0.3.md), [política de dependências](companion-dependency-policy.md) e [processamento no Edit](../features/local-processing.md).

## Modelo de processo Windows

O TDA Companion é independente do antigo `DnDScribeCompanion.exe`. O produto não consulta, inicia, encerra, modifica ou depende da instalação antiga.

O processo é per-user, sem Windows Service administrativo:

```text
login do Windows
  -> TDACompanion.exe --agent --startup
       -> 127.0.0.1:8765/api/v1
       -> SQLite / fila / eventos / telemetria
       -> worker ASR separado

atalho/Menu Iniciar
  -> TDACompanion.exe --ui
       -> Desktop WebView2
       -> Agent já existente
```

Fechar ou ocultar a UI não encerra o Agent. Encerrar o Agent é uma ação diferente e trabalho ativo não deve ser morto silenciosamente.

Raízes locais v0.3:

```text
%LOCALAPPDATA%\TDA\
├── Companion\
├── State\
├── Data\
├── Logs\
├── Cache\
├── Models\
└── Runtime\
```

A migração 0.2→0.3 é limitada ao namespace TDA e não usa o DnDScribe como fallback.

## Instalador Windows

O pacote principal continua sendo `TDACompanion-x64.msi`, per-user e sem elevação administrativa.

O MSI candidato v0.3:

- instala versões sob `%LOCALAPPDATA%\TDA\Companion\versions\<versão>`;
- mantém `current-version.txt` e metadata de instalação;
- cria o atalho `TDA Companion` no Menu Iniciar;
- registra o Agent em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
- instala o helper de manutenção junto do aplicativo;
- usa `MajorUpgrade` com UpgradeCode estável;
- não cria Windows Service;
- não instala CUDA/Python globalmente;
- não toca no DnDScribe.

O ZIP portátil pode existir como artefato técnico, mas o MSI é o caminho de produto.

### Gates do MSI

O workflow `Companion` precisa comprovar em Windows:

1. bundle PyInstaller;
2. MSI WiX;
3. smoke do bundle;
4. instalação silenciosa;
5. execução real do Agent instalado;
6. health/version e job de smoke via loopback autenticado;
7. encerramento controlado;
8. desinstalação;
9. ausência dos binários instalados esperados.

Antes do RC v0.3 ainda deve existir a matriz definitiva de fresh install, upgrade N-1→N, uninstall preservando dados e purge completo com verificação de processo, porta, startup, atalhos, registry e roots TDA-owned.

## Distribuição e updates

O Companion e o runtime Whisper possuem canais de release separados.

Companion:

```text
companion-v<versão>
TDACompanion-x64.msi
TDACompanion-x64.msi.sha256
TDACompanion-<versão>-windows-x64.zip
```

Runtime Whisper:

```text
companion-whisper-runtime-v<versão>
TDAWhisperRuntime-<versão>-windows-x64.zip
TDAWhisperRuntime-<versão>-windows-x64.zip.sha256
```

Os endpoints do TDA selecionam somente a família correta de tags/assets, e os downloads são verificados por tamanho e SHA-256 antes da instalação. O runtime ASR fica fora do MSI para não transformar o instalador principal em um pacote de vários gigabytes.

Update não pode interromper job ativo. Enquanto não houver assinatura Authenticode confiável, instalação de update continua exigindo confirmação explícita.

## Pareamento e segurança

O token de pareamento é local, fica em `State`, com proteção do usuário do Windows, e não é cookie, query string, storage persistente do browser, log ou dado cloud.

A API continua somente em IPv4 loopback, com Host exato, Origin permitido e Bearer nos endpoints privados. A Web não envia path arbitrário do filesystem e não existe descoberta LAN/proxy cloud.

## Processamento real candidato

A branch v0.3 já possui a fronteira de worker em subprocesso e o job candidato `transcription.craig`. Craig é materializado por `source_id` opaco; o worker recebe roots controlados pelo Agent.

O ingest preserva 1..N tracks e a timeline comum. Speaker vem da track Craig, portanto diarização não é usada como substituto para informação que o pacote já fornece.

O output de engines diferentes converge para `tda_transcript_v1`. O texto integral permanece no artefato local; mensagens do worker e logs técnicos carregam apenas estado, métricas, hashes e códigos estáveis.

Perfis planejados/registrados:

```text
whisper-turbo
whisper-detailed
qwen-fast
qwen-quality
```

Neste ponto, o adapter Whisper e o runtime isolado existem; Qwen ainda não deve ser anunciado como engine executável até o runtime/adapter/alinhador estarem implementados e validados.

## Runtime Whisper isolado

O runtime Windows é versionado sob `Runtime\whisper` e contém Faster-Whisper/CTranslate2 e as DLLs CUDA necessárias à própria engine. Ele não modifica o Toolkit CUDA, Python ou PATH global do usuário.

O manifest de build fixa Python, Faster-Whisper, CTranslate2, CUDA Runtime/cuBLAS/cuDNN, NVML e PyInstaller. A política de dependências exige a versão estável mais recente e compatível e um gate diário verifica drift de dependências e revisions de modelos.

`TDAWhisperWorker.exe --probe` comprova importação do stack empacotado e informa presença de CUDA/compute types. Runner comum do GitHub sem GPU pode validar empacotamento, mas **não substitui a prova física na RTX 4070 8 GB**.

## Gate físico — RTX 4070

Antes de declarar `transcription.whisper` suportado no v0.3, executar os dois perfis Whisper sobre áudio local autorizado, em uma máquina com RTX 4070 8 GB.

O worker isolado possui um modo de aceitação que não envia áudio para cloud e não imprime a transcrição no stdout:

```powershell
$worker = "$env:LOCALAPPDATA\TDA\Runtime\whisper\<versao>\TDAWhisperWorker.exe"
$models = "$env:LOCALAPPDATA\TDA\Models"

& $worker --acceptance `
  --audio "C:\caminho\amostra.flac" `
  --models-root $models `
  --profile whisper-turbo `
  --require-gpu-name "RTX 4070"

& $worker --acceptance `
  --audio "C:\caminho\amostra.flac" `
  --models-root $models `
  --profile whisper-detailed `
  --require-gpu-name "RTX 4070"
```

Para inspeção humana da qualidade, a transcrição só é gravada quando solicitado explicitamente:

```powershell
--transcript-out "C:\caminho\whisper-turbo-transcript.json"
```

Contexto/glossário podem ser fornecidos por arquivos locais (`--context-file` e `--glossary-file`) para não colocar conteúdo de campanha na linha de comando.

O recibo `tda_whisper_gpu_acceptance_v1` contém:

- profile/model/revision exatos;
- SHA-256 do áudio, nunca o path;
- versões Faster-Whisper/CTranslate2/PyAV;
- CUDA device count e compute types;
- nome da GPU/driver via NVML;
- VRAM baseline/pico e pico de uso GPU;
- compute type efetivo e se houve fallback de memória;
- duração do áudio;
- tempo de prepare/load/transcrição/total;
- RTF;
- quantidade de segmentos/palavras;
- SHA-256 do texto reconhecido;
- indicação de que arquivo de transcrição foi escrito, sem incluir o texto no recibo.

Critério mínimo do gate físico: `pass=true`, CUDA real, GPU esperada, fala reconhecida e recibo completo. A avaliação de qualidade em português é um gate separado: comparar o JSON de transcrição com o áudio/referência e registrar nomes próprios, termos de D&D, omissões, alucinações e timestamps.

Não versionar áudio privado nem transcrição integral como evidência do CI. Um recibo sanitizado pode ser arquivado posteriormente.

## ASR Whisper — receita preservada

Os dois perfis Whisper preservam inicialmente a receita comprovada pelo legado:

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
initial_prompt com contexto limitado da campanha
GPU float16
fallback int8_float16 apenas em falha real de memória e quando suportado
CPU int8 apenas quando solicitado
```

Modelos são baixados separadamente em `Models` usando revision imutável e marker local com hash do conteúdo.

## Diagnóstico

O Desktop executa checks locais não destrutivos de Agent, State/Data, SQLite, disco, WebView2 e NVIDIA. Quando o runtime Whisper está instalado, também verifica integridade e `--probe` do worker.

Export de diagnóstico é sanitizado e não inclui token de pareamento, áudio ou texto integral de transcrição.

## Atualização, repair e desinstalação

O helper de manutenção roda fora do processo principal para permitir MSI upgrade/uninstall sem o executável tentar substituir a si mesmo.

Dois conceitos permanecem distintos:

- **desinstalar preservando dados**: remove aplicativo/integrações, mantendo conteúdo local destinado a reinstalação;
- **remover completamente**: remove também State/Data/Logs/Cache/Models/Runtime pertencentes ao TDA, com confirmação explícita.

"Remover completamente" significa conteúdo de propriedade do TDA. Não há promessa de apagar cache do Windows Installer, Prefetch, Defender ou outros artefatos administrados pelo Windows.

## Rollback

Rollback do aplicativo significa instalar uma versão compatível e preservar dados. Schema local não é rebaixado in-place. Mudanças de schema futuras exigem snapshot/migração versionada.

O antigo `DnDScribeCompanion.exe` não participa do rollback.

## Gates antes de promoção

Antes de promover uma versão do Companion:

```text
python -m pytest local-companion/tests -q
pnpm check
pnpm build
pnpm test:processing
```

Além disso:

- `Companion` verde em Windows/Linux;
- MSI verde;
- `Whisper Runtime` verde;
- `Companion Dependency Freshness` verde;
- revisions ASR atuais e pinadas;
- gate físico RTX quando runtime/ASR muda;
- benchmark PT-BR antes de escolher default definitivo;
- documentação descrevendo somente capabilities realmente ativas.

CI sem GPU prova empacotamento e contratos, não prova qualidade, throughput, VRAM ou compatibilidade física da RTX.
