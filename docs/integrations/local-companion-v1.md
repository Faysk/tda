# Companion — protocolo local v1

> Status: implementado em branch/PR; fixture sintética
> Owner: local-companion/processing
> Última revisão: 2026-09-10
> Fonte de verdade: `local-companion/tda_companion/api.py`, `store.py` e `telemetry.py`

Contrato alinhado com a frente de Processamento. Ver [integração](local-companion.md), [processamento local](../features/local-processing.md) e [operação/migração](../operations/local-companion.md). O protocolo wire continua `api_version="1"`; esta evolução é aditiva. **Nenhuma implementação deste corte publica conteúdo ou conecta o ASR preservado ao supervisor HTTP.**

## Transporte e pareamento manual

Produção local: `http://127.0.0.1:8765/api/v1`. Ensaios usam porta explícita diferente. O processo só escuta IPv4 loopback, rejeita Host diferente de `127.0.0.1:<porta>` e não redireciona paths. Apenas `/health` é público e não contém identidade do dispositivo, caminhos, telemetria ou jobs.

Operador provisiona um token aleatório URL-safe de 32 bytes (43 caracteres) em arquivo protegido para seu usuário, fora do código e da pasta de resultados; seleciona origens exatas no lançamento. O browser mantém esse token somente em memória. Não há cookie, endpoint público de pairing, refresh token ou credencial administrativa cloud.

Todos os GET privados exigem `Authorization: Bearer <token>`. POST exige também `Origin` permitido e `Content-Type: application/json`; cabeçalhos não são substituídos por query parameters. Corpo máximo de 4096 bytes, inclusive chunked. CORS reflete exclusivamente origem autorizada, nunca curinga e nunca cookies. Preflight autoriza GET/POST e Authorization/Content-Type/Idempotency-Key; PNA só para origem aprovada.

Autorização local é limitada à fila/dispositivo. Não representa autorização de campanha cloud. Browser Local Network Access, mixed content e políticas corporativas continuam sendo fronteiras independentes.

## Capabilities

`GET /capabilities` anuncia capacidade, não permissão cloud. Na branch candidata atual:

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

Consumidores devem fazer feature detection. Uma instalação antiga que anuncie apenas `synthetic.fixture` continua válida; a UI simplesmente não solicita telemetria/eventos enriquecidos.

## Endpoints

| Método/path após `/api/v1` | Resposta / comportamento |
| --- | --- |
| GET `/health` | `{api_version:"1",service_version:"0.1.0",lifecycle:"preparing"\|"ready"\|"paused"}` |
| GET `/version` | `{api_version:"1",service_version:"0.1.0"}` |
| GET `/capabilities` | capabilities locais, `sync:false` e identidade do device |
| GET `/system` | snapshot best-effort de SO/CPU/RAM/GPU; privado; ausência de sensor não é erro de fila |
| GET `/lifecycle` | Mesmo DTO health |
| POST `/lifecycle` | `{action:"pause"\|"resume"}`; pausa novos claims, não suspende job ativo |
| GET `/jobs` | `{jobs:[Job]}` últimos 100, ordem updated desc |
| POST `/jobs` | Body abaixo + `Idempotency-Key`; retorna Job (200 inclusive replay) |
| GET `/jobs/{id}` | Job |
| POST `/jobs/{id}/cancel` | Body `{}`; cancelamento terminal persistido, fence impede commit posterior |
| POST `/jobs/{id}/retry` | Body `{}`; somente failed/interrupted; nova attempt no próximo claim |
| GET `/jobs/{id}/events` | `{events:[Event]}` últimos 100, seq desc |
| GET `/jobs/{id}/result` | Envelope de resultado; 409 se não concluído |

Body sintético copiável:

```json
{"kind":"synthetic.fixture","campaign_id":"synthetic-campaign","session_id":"synthetic-session","source_id":"synthetic-source","units":3}
```

Identity e Idempotency-Key: `[A-Za-z0-9_-]{1,128}`. Units: inteiro 1..100 (boolean rejeitado). Campos desconhecidos rejeitados. Mesma chave e body retorna mesmo job; body diferente retorna 409 `IDEMPOTENCY_CONFLICT`. Esta fila local não cria registros cloud.

## Job

A projeção atual é:

```json
{
  "id": "UUID",
  "kind": "synthetic.fixture",
  "status": "running",
  "stage": "fixture",
  "progress": {"completed": 1, "total": 3, "unit": "items"},
  "error": null,
  "result_available": false,
  "updated_at": "2026-09-10T20:00:00Z",
  "attempt": 1,
  "context": {
    "campaign_id": "synthetic-campaign",
    "session_id": "synthetic-session",
    "source_id": "synthetic-source"
  }
}
```

`attempt` e `context` são campos aditivos da projeção do job. Clientes v1 do reboot que não os recebem usam `attempt=0` e `context=null` na apresentação; eles não são usados para autorizar operações cloud.

Status: queued/running/succeeded/failed/cancelled/interrupted. Stage da fixture: queued/fixture/complete/cancelled/interrupted. Error: null ou `{code,recoverable:true}`. Progresso da fixture conta unidades efetivamente calculadas e commitadas; **não é progresso ASR**.

O ASR preservado possui callbacks por track/segmento, mas ainda não está conectado ao supervisor. UI deve rotular retry como **Repetir trabalho**, sem prometer retomada no ponto exato.

## Eventos estruturados

O evento v1 aceita agora um envelope aditivo:

```json
{
  "seq": 32,
  "code": "UNIT_COMMITTED",
  "at": "2026-09-10T20:14:18Z",
  "level": "info",
  "data": {
    "completed": 2,
    "total": 3
  }
}
```

Campos:

- `seq`: inteiro não negativo e crescente na base local;
- `code`: código factual, sem mensagem privada ou stack trace;
- `at`: timestamp UTC;
- `level`: `info`, `warning` ou `error`;
- `data`: objeto pequeno de valores escalares destinado a contexto operacional.

A fixture emite `QUEUED`, `RUNNING`, `UNIT_COMMITTED`, `SUCCEEDED`, `CANCELLED`, `PROCESS_INTERRUPTED` e `FIXTURE_EXECUTION_FAILED` conforme o estado real. Não há conteúdo de transcrição nos eventos desta entrega.

Quando o ASR for conectado, códigos como `TRACK_STARTED`, `TRACK_PROGRESS`, `TRACK_COMPLETED`, redução de ruído ou detecção de fala de fundo somente poderão ser emitidos quando a etapa correspondente realmente existir. A camada de UI pode transformar códigos em copy amigável, mas o companion persiste fatos, não piadas.

## Telemetria de sistema

`GET /system` é privado e best-effort:

```json
{
  "sampled_at": "2026-09-10T20:00:00Z",
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

CPU/RAM são amostrados por `psutil`. NVIDIA GPU/VRAM são amostrados pela NVML usando `nvidia-ml-py`. A resposta não inclui hostname, usuário, paths, processos, comandos, tokens ou nomes de arquivos.

NVML é opcional em runtime: hardware não NVIDIA, driver incompatível, ausência de sensor ou reset do driver resulta em `gpus:[]`. Erro de telemetria nunca degrada `lifecycle`, interrompe worker, altera job ou faz a fila parecer desconectada.

## Durabilidade e migração local

SQLite usa transações `BEGIN IMMEDIATE` e `synchronous=FULL`; claims permanecem atômicos. O schema local passa para `PRAGMA user_version=2` apenas para enriquecer `events` com:

```text
level TEXT NOT NULL DEFAULT 'info'
data  TEXT NULL
```

Bases v1 são migradas aditivamente na abertura. Jobs, settings e eventos existentes são preservados. Versões desconhecidas continuam sendo recusadas sem reset automático.

Running encontrado em restart vira interrupted e exige retry explícito. Attempt/generation impede worker antigo de gravar após cancel/retry; progresso e resultado continuam commitados na mesma transação. Resultado sucedido é imutável e replay devolve o mesmo objeto. Pause persiste em restart. Não há auto-retry infinito nem limpeza automática de fontes neste recorte.

## Erros

Erro HTTP: `{error:{code,recoverable:boolean}}`; principais códigos: 401 UNAUTHORIZED, 403 HOST_REJECTED/ORIGIN_REJECTED/ORIGIN_REQUIRED/PREFLIGHT_REJECTED, 404 JOB_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT/JOB_TERMINAL/JOB_NOT_RETRYABLE/RESULT_NOT_READY, 413 BODY_TOO_LARGE, 415 JSON_REQUIRED, 422 INVALID_REQUEST e 503 LOCAL_STORAGE_OR_RUNTIME_ERROR.

Exceções, inputs, paths e tokens não são serializados. Rotas inexistentes usam 404 padrão. Falha de storage no worker degrada lifecycle para preparing e tenta recovery; falha da fixture vira failed/FIXTURE_EXECUTION_FAILED. Falha do sampler `/system` é isolada da saúde do worker.

## Resultado e sync

```json
{"schema_version":"tda_local_result_v1","campaign_id":"synthetic-campaign","session_id":"synthetic-session","source_id":"synthetic-source","job_id":"UUID","publication_bundle":{"schema_version":"publication_bundle_v1","publication_id":"SHA256","session":{"source_id":"synthetic-source"}},"sync":{"status":"not_configured"}}
```

`publication_bundle_v1` continua sem transcript/raw. `publication_id` é SHA256 da serialização canônica do payload sem generated_at/publication_id. Fixture marca `source_manifest.recording_format="synthetic.fixture"`; consumidor real deve recusá-la para publicação.

O envelope fornece `import_artifacts:{publication_payload_json,transcript_json}` em strings JSON UTF-8 canônicas. Consumer deve calcular hashes dos bytes recebidos antes de parse/validação; não reserializar em JavaScript para reproduzir identidade. Fixture exporta `transcript_json="[]"`.

`sync:false` e `sync.status="not_configured"` continuam verdadeiros mesmo com rede disponível. Sync remoto autenticado, acceptance receipt e idempotência server-side permanecem fora desta entrega. Site cloud continua independente do processo local.

## Validação

O workflow do companion roda pytest em Windows e Linux e constrói wheel após os testes. A branch `codex/processing-workbench-v2` adiciona cobertura para:

- autenticação de `/system`;
- shape best-effort da telemetria sem depender de GPU física;
- capabilities `system.telemetry` e `job.events`;
- migração SQLite v1 → v2;
- payload factual de eventos e contexto de job.

**Estado desta revisão:** implementação candidata. CI/PR deve passar antes de este estado ser promovido para validado, integrado ou publicado.
