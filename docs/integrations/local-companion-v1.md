# Companion — protocolo local v1

> Status: vigente
> Owner: local-companion/processing
> Última revisão: 2026-09-19
> Fonte de verdade: `local-companion/tda_companion/api.py`, `store.py`, `telemetry.py` e `windows_app.py`

O protocolo wire permanece `api_version="1"`. A versão de serviço deste corte é `0.3.14`. A evolução continua local-first: jobs ASR Craig, eventos, telemetria e sessões de navegador existem no loopback sem transformar autorização local em autorização cloud.

**Concluir ASR continua sem publicar conteúdo no cloud.**

## Transporte e sessão do navegador

Destino do produto:

```text
http://127.0.0.1:8765/api/v1
```

O processo escuta apenas IPv4 loopback, rejeita Host diferente de `127.0.0.1:<porta>` e não redireciona paths. `GET /health` é público e mínimo; ele não expõe device id, paths, telemetria ou jobs.

O Companion mantém um **token mestre** URL-safe protegido para o usuário do Windows. Esse segredo não faz parte da UX Web normal.

Para navegador, o fluxo é:

```text
GET /health
POST /session  Origin=https://dnd.faysk.dev
  -> {token temporário, expires_in_seconds}
GET/POST privados
  Authorization: Bearer <token temporário>
  Origin=https://dnd.faysk.dev
```

`POST /session` não exige o token mestre, mas exige Host loopback, Origin exata na allowlist, JSON e CORS/PNA válidos. O Agent gera uma credencial aleatória, guarda somente seu SHA-256 em memória e a vincula à Origin emissora. A sessão expira e é invalidada por restart do Agent.

O token temporário não vai para cookie, localStorage, sessionStorage, query string, logs ou cloud. Um bearer temporário apresentado sem a Origin correta é recusado. O token mestre continua aceito para clientes nativos/técnicos compatíveis.

POST exige Origin permitido e `Content-Type: application/json`. Corpo máximo: 4096 bytes. CORS reflete somente origem autorizada; cookies não são usados.

## Aplicativo Windows

O aplicativo atual é `TDACompanion.exe`, novo e independente de `DnDScribeCompanion.exe`.

Raízes padrão:

```text
%LOCALAPPDATA%\TDA\Companion
%LOCALAPPDATA%\TDA\Data
```

O instalador oficial candidato é:

```text
TDACompanion-x64.msi
```

Ele é instalado por usuário, sem Windows Service, e registra startup per-user do Agent. O MSI também registra `tda-companion://open` para que uma ação explícita no site possa abrir a UI Desktop. Releases em `main` usam tag `companion-v<versão>` e asset fixo `TDACompanion-x64.msi`.

Como o mesmo repositório também possui releases `prod-*`, o site resolve a versão mais recente pelo endpoint próprio `/api/downloads/companion/windows`, que filtra somente `companion-vX.Y.Z` e então redireciona ao asset oficial. O atalho genérico `/releases/latest` do repositório não é usado para decidir a versão do Companion.

O pipeline de build possui suporte fail-closed para assinar `TDACompanion.exe`, `TDACompanionMaintenance.exe` e o MSI **antes** de ZIP/hash/manifest/receipt, validando status, thumbprint e subject esperados. A identidade real de code-signing ainda depende do provisionamento externo de #395; enquanto ela não estiver configurada, os builds normais continuam sem Authenticode e não devem ser tratados como candidato final de Stable.

## Capabilities

A resposta é dinâmica e consumidores devem fazer feature detection. O conjunto base inclui:

```json
{
  "capabilities": [
    "synthetic.fixture",
    "job.events",
    "system.telemetry",
    "worker.subprocess",
    "transcription.prepare"
  ],
  "sync": false,
  "device": {
    "id": "<UUID persistido>",
    "label": "TDA local"
  },
  "transcription": {
    "profiles": [],
    "catalog": [],
    "qwen_physical_gate": {
      "qwen-fast": {},
      "qwen-quality": {}
    }
  }
}
```

`transcription.craig` é anunciado somente quando existe ao menos um perfil pronto. Uma instância Desktop pode acrescentar `agent.desktop` e `agent.logs`; `agent.control` só aparece quando o processo foi criado com callback de shutdown. Os arrays/objetos de `transcription` carregam o estado real dos perfis e gates, portanto o exemplo acima não deve ser tratado como snapshot fixo de uma máquina preparada.

## Endpoints

| Método/path após `/api/v1` | Resposta / comportamento |
| --- | --- |
| GET `/health` | health público mínimo, com `api_version:"1"`, service version e lifecycle |
| POST `/session` | bootstrap Web origin-bound; retorna bearer temporário em memória |
| GET `/version` | identidade/versionamento do serviço local |
| GET `/capabilities` | capabilities locais, `sync:false` e identidade do device |
| GET `/system` | snapshot best-effort de SO/CPU/RAM/GPU; privado |
| GET `/lifecycle` | mesmo DTO health |
| POST `/lifecycle` | `{action:"pause"\|"resume"}` |
| GET `/jobs` | `{jobs:[Job]}` últimos 100 |
| POST `/jobs` | body abaixo + `Idempotency-Key`; retorna Job |
| GET `/jobs/{id}` | Job |
| POST `/jobs/{id}/cancel` | cancelamento terminal persistido |
| POST `/jobs/{id}/retry` | somente failed/interrupted |
| GET `/jobs/{id}/events` | `{events:[Event]}` últimos 100 |
| GET `/jobs/{id}/result` | envelope de resultado; 409 se não concluído |

Body sintético atual:

```json
{
  "kind": "synthetic.fixture",
  "campaign_id": "synthetic-campaign",
  "session_id": "synthetic-session",
  "source_id": "synthetic-source",
  "units": 3
}
```

Identity e `Idempotency-Key`: `[A-Za-z0-9_-]{1,128}`. Units: inteiro 1..100. Campos desconhecidos são rejeitados. Mesma chave + mesmo body retorna o mesmo job; body diferente retorna `IDEMPOTENCY_CONFLICT`.

## Job

```json
{
  "id": "UUID",
  "kind": "synthetic.fixture",
  "status": "running",
  "stage": "fixture",
  "progress": {"completed": 1, "total": 3, "unit": "items"},
  "error": null,
  "result_available": false,
  "updated_at": "2026-09-11T02:00:00Z",
  "attempt": 1,
  "context": {
    "campaign_id": "synthetic-campaign",
    "session_id": "synthetic-session",
    "source_id": "synthetic-source"
  }
}
```

Status: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`.

Stage da fixture: `queued`, `fixture`, `complete`, `cancelled`, `interrupted`.

O progresso da fixture representa unidades realmente commitadas e **não é progresso ASR**. Retry na UI é **Repetir trabalho** e não promete retomada exata.

## Eventos estruturados

```json
{
  "seq": 32,
  "code": "UNIT_COMMITTED",
  "at": "2026-09-11T02:14:18Z",
  "level": "info",
  "data": {
    "completed": 2,
    "total": 3
  }
}
```

`level` aceita `info`, `warning` ou `error`. `data` contém contexto operacional pequeno. A fixture emite fatos como `QUEUED`, `RUNNING`, `UNIT_COMMITTED`, `SUCCEEDED`, `CANCELLED`, `PROCESS_INTERRUPTED` e `FIXTURE_EXECUTION_FAILED`.

Quando o ASR for conectado, eventos como `TRACK_STARTED`, `TRACK_PROGRESS`, redução de ruído ou detecção de fala de fundo só podem existir se a etapa correspondente realmente ocorrer. O companion persiste fatos; zueiras pertencem à camada de apresentação da UI.

## Telemetria

`GET /system` é privado e best-effort:

```json
{
  "sampled_at": "2026-09-11T02:00:00Z",
  "host": {
    "os": "Windows 11",
    "cpu": "Intel Core i7-14700HX"
  },
  "cpu": {"utilization_percent": 32.0},
  "memory": {
    "used_bytes": 19327352832,
    "total_bytes": 68719476736,
    "percent": 28.1
  },
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
      "utilization_percent": 78,
      "memory_used_bytes": 6871947673,
      "memory_total_bytes": 8589934592
    }
  ]
}
```

CPU/RAM usam `psutil`; GPU/VRAM NVIDIA usam NVML por `nvidia-ml-py`. A resposta não inclui hostname, usuário, paths, processos, comandos, tokens ou nomes de arquivos.

Falha de sensor resulta em dados parciais e nunca altera a saúde da fila.

## Durabilidade

SQLite usa transações `BEGIN IMMEDIATE` e `synchronous=FULL`. O schema local atual usa `PRAGMA user_version=2`; a migração v1→v2 acrescenta `level` e `data` a eventos sem apagar jobs/settings/eventos.

Running encontrado após restart vira `interrupted` e exige retry explícito. Resultado sucedido é imutável. Pause persiste. Não existe auto-retry infinito.

## Resultado e sync

A fixture retorna envelope `tda_local_result_v1`, publication bundle e `sync.status="not_configured"`. `sync:false` continua verdadeiro mesmo com rede disponível.

A fixture não pode ser tratada como publicação real. Sync remoto autenticado, receipt server-side e publicação permanecem fora desta entrega.

## ASR Craig vigente

`transcription.craig` é job oficial do Agent e executa em processo worker isolado. O ingest Craig estabelece hashes completos das faixas e staging seguro. No dispatch normal, o worker chama o loader com `verify_tracks=false`: manifesto, paths e tamanhos continuam sendo validados, mas centenas de MB não são relidos antes de cada inferência.

O worker emite `source_validation` imediatamente e heartbeat periódico. O Agent usa o heartbeat para atualizar `Job.updated_at` sem criar um evento persistido a cada poucos segundos. Assim a interface consegue distinguir **worker vivo/preparando** de congelamento real.

Perfis Qwen exigem runtime/modelo/gate físico compatíveis antes do job. Whisper e Qwen produzem o mesmo contrato de transcript/run local.

### Compatibilidade GPU do Qwen

A linha de runtime Qwen `1.0.8` trata Compute Capability como capability, não como nome de placa:

- `SM >= 7.5`: caminho elegível, ainda sujeito a probe CUDA real, carga integral do modelo, ASR, Forced Aligner e gate físico;
- `SM < 7.5`: rejeitado fail-closed;
- dtype: `bfloat16` somente quando o runtime reporta suporte; caso contrário `float16`;
- RTX 4070 8 GB continua a baseline de release validada;
- RTX 2080 SUPER / SM 7.5 possui evidência física de ASR + Forced Aligner concluídos e entra inicialmente como **suporte experimental**, não como equivalência automática a toda GPU Turing.

O runtime/gate registra compute capability e compute type. A promoção de suporte experimental para oficial exige preservar evidência física de VRAM/pico, desempenho e estabilidade no hardware SM 7.5, sem reduzir os critérios de acceptance.

Cancelamento é cooperativo primeiro. Se código nativo/CUDA não responder dentro do grace period, o subprocesso isolado é encerrado e o job permanece `cancelled`; o log técnico registra `WORKER_CANCEL_FORCED` em vez de converter a ação do usuário em falha `WORKER_CANCEL_TIMEOUT`.

## Validação

O workflow `Companion` executa testes em Windows e Linux. O pacote Windows também passa por:

- build PyInstaller;
- build WiX MSI;
- smoke do `.exe` empacotado;
- instalação real do MSI;
- inicialização do binário instalado;
- health check;
- desinstalação real.

Esses gates validam protocolo/empacotamento sintéticos, não qualidade de transcrição física ou CUDA em GPU real.
