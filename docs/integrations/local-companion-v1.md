# Companion — protocolo local v1

> Status: implementação candidata
> Owner: local-companion/processing
> Última revisão: 2026-09-11
> Fonte de verdade: `local-companion/tda_companion/api.py`, `store.py`, `telemetry.py` e `windows_app.py`

O protocolo wire permanece `api_version="1"`. A versão de serviço candidata é `0.2.0`. A evolução é aditiva: eventos e telemetria foram acrescentados sem transformar autorização local em autorização cloud.

**Este corte não publica conteúdo e ainda não conecta o ASR preservado ao supervisor HTTP.**

## Transporte e pareamento

Destino do produto:

```text
http://127.0.0.1:8765/api/v1
```

O processo escuta apenas IPv4 loopback, rejeita Host diferente de `127.0.0.1:<porta>` e não redireciona paths. Apenas `GET /health` é público e não expõe identidade do dispositivo, paths, telemetria ou jobs.

O TDA Companion gera um token URL-safe local de 32 bytes e o protege para o usuário do Windows. O browser mantém esse token somente em memória. Não há cookie, query parameter, refresh token, storage do browser ou credencial administrativa cloud.

Todos os GET privados exigem `Authorization: Bearer <token>`. POST exige também Origin permitido e `Content-Type: application/json`. Corpo máximo: 4096 bytes. CORS reflete somente origem autorizada; cookies não são usados.

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

Ele é instalado por usuário, sem Windows Service e sem Startup automático. Releases em `main` usam tag `companion-v<versão>` e asset fixo `TDACompanion-x64.msi`; o site pode usar `/releases/latest/download/TDACompanion-x64.msi` sem conhecer a versão corrente.

O MSI atual não possui assinatura Authenticode configurada.

## Capabilities

```json
{
  "capabilities": [
    "synthetic.fixture",
    "job.events",
    "system.telemetry"
  ],
  "sync": false,
  "device": {
    "id": "<UUID persistido>",
    "label": "TDA local"
  }
}
```

Consumidores devem fazer feature detection.

## Endpoints

| Método/path após `/api/v1` | Resposta / comportamento |
| --- | --- |
| GET `/health` | `{api_version:"1",service_version:"0.2.0",lifecycle:"preparing"\|"ready"\|"paused"}` |
| GET `/version` | `{api_version:"1",service_version:"0.2.0"}` |
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

## ASR preservado

O código preservado em `tda_companion/legacy/transcriber.py` possui callbacks úteis para modelo/device, retomada, track, total de tracks, speaker e porcentagem. Ele ainda não está conectado ao `JobRequest`/worker HTTP e não deve ser apresentado como funcionalidade ativa.

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
