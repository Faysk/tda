# Companion — protocolo local v1

> Status: implementado em branch/PR; fixture sintética
> Owner: local-companion/processing
> Última revisão: 2026-09-07
> Fonte de verdade: `local-companion/tda_companion/api.py` e `store.py`

Contrato alinhado com a frente Painelzinho. Ver [integração](local-companion.md) e [operação/migração](../operations/local-companion.md). Nenhuma implementação deste corte publica conteúdo, transcreve áudio ou instala serviço no PC.

## Transporte e pareamento manual

Produção local: `http://127.0.0.1:8765/api/v1`. Ensaios usam porta explícita diferente (18765). O processo só escuta IPv4 loopback, ignora proxy headers, rejeita Host diferente de `127.0.0.1:<porta>` e não redireciona paths. Apenas health é público e não contém identidade do dispositivo, caminhos ou jobs.

Operador provisiona um token aleatório URL-safe de 32 bytes (43 caracteres) em arquivo protegido para seu usuário, fora do código e da pasta de resultados; seleciona origens exatas no lançamento. Copia o token ao Painelzinho, que o mantém apenas em memória. Não há cookie, leitura automática de secrets pelo navegador, endpoint público de pairing, refresh token ou credencial administrativa cloud. Para revogar, parar **esta instância**, substituir token e reiniciar; token antigo não funciona após restart. Arquivo secreto/ACL é responsabilidade explícita de provisionamento; este PR oferece plano, não instalador que configure ACL.

Todos os GET privados exigem `Authorization: Bearer <token>`. POST exige também `Origin` permitido e `Content-Type: application/json`; cabeçalhos não são substituídos por query parameters. Corpo máximo de 4096 bytes, inclusive chunked. CORS reflete exclusivamente origem autorizada, nunca curinga e nunca cookies. Preflight autoriza GET/POST e Authorization/Content-Type/Idempotency-Key; PNA apenas para origem aprovada. Origens HTTP só são aceitas para localhost/127.0.0.1; outras exigem HTTPS.

Autorização local é limitada a essa fila/dispositivo; não representa autorização de campanha cloud. Um programa executado como o próprio usuário já tem acesso a esses arquivos e não é isolado pelo bearer. Browser Local Network Access/permissão, mixed content e políticas corporativas precisam de ensaio real; falha de fetch não prova que processo está desligado. UI deve distinguir incompatibilidade de protocolo, não enviar bearer antes de conferir `api_version`, e oferecer diagnóstico local.

## Endpoints

| Método/path após `/api/v1` | Resposta / comportamento |
| --- | --- |
| GET `/health` | `{api_version:"1",service_version:"0.1.0",lifecycle:"preparing"\|"ready"\|"paused"}` |
| GET `/version` | `{api_version:"1",service_version:"0.1.0"}` |
| GET `/capabilities` | `{capabilities:["synthetic.fixture"],sync:false,device:{id:<UUID persistido>,label:"TDA local"}}` |
| GET `/lifecycle` | Mesmo DTO health |
| POST `/lifecycle` | `{action:"pause"\|"resume"}`; mesmo DTO health; pausa novos claims, não suspende job ativo |
| GET `/jobs` | `{jobs:[Job]}` últimos 100, ordem updated desc |
| POST `/jobs` | Body abaixo + `Idempotency-Key`; retorna Job (200 inclusive replay) |
| GET `/jobs/{id}` | Job |
| POST `/jobs/{id}/cancel` | Body `{}`; cancelamento terminal persistido, fence impede commit posterior |
| POST `/jobs/{id}/retry` | Body `{}`; só failed/interrupted, mantém id/key/checkpoints; nova geração |
| GET `/jobs/{id}/events` | `{events:[{seq,code,at}]}` últimos 100, seq desc; somente códigos, sem conteúdo privado |
| GET `/jobs/{id}/result` | Envelope abaixo; 409 se não concluído |

Body sintético copiável:

```json
{"kind":"synthetic.fixture","campaign_id":"synthetic-campaign","session_id":"synthetic-session","source_id":"synthetic-source","units":3}
```

Identity e Idempotency-Key: `[A-Za-z0-9_-]{1,128}`. Units: inteiro 1..100 (boolean rejeitado). Campos desconhecidos rejeitados. Mesma chave e body retorna mesmo job; body diferente retorna 409 `IDEMPOTENCY_CONFLICT`. Não derive nova chave automaticamente para retry. Nova chave é execução deliberadamente nova. Esta fila local não cria registros cloud.

Job:

```json
{"id":"UUID","kind":"synthetic.fixture","status":"queued","stage":"queued","progress":{"completed":0,"total":3,"unit":"items"},"error":null,"result_available":false,"updated_at":"2026-09-07T00:00:00Z"}
```

Status: queued/running/succeeded/failed/cancelled/interrupted. Stage: queued/fixture/complete/cancelled/interrupted. Error: null ou `{code,recoverable:true}`. Progresso conta unidades de fixture efetivamente calculadas e commitadas; **não é progresso ASR**. ASR preservado tem callbacks por faixa/segmento, mas ainda não está conectado ao supervisor. UI deve rotular retry como Repetir, sem prometer retomada genérica do motor.

Erro HTTP: `{error:{code,recoverable:boolean}}`; 401 UNAUTHORIZED, 403 HOST_REJECTED/ORIGIN_REJECTED/ORIGIN_REQUIRED/PREFLIGHT_REJECTED, 404 JOB_NOT_FOUND, 409 IDEMPOTENCY_CONFLICT/JOB_TERMINAL/JOB_NOT_RETRYABLE/RESULT_NOT_READY, 413 BODY_TOO_LARGE, 415 JSON_REQUIRED, 422 INVALID_REQUEST, 503 LOCAL_STORAGE_OR_RUNTIME_ERROR. Exceções/inputs/paths não são serializados. Rotas inexistentes usam 404 padrão sem dados. Access log desativado. Falha de storage no worker degrada lifecycle para preparing e tenta recovery; falha de execução vira failed/FIXTURE_EXECUTION_FAILED.

## Durabilidade e concorrência

SQLite schema 1, transações `BEGIN IMMEDIATE`, synchronous FULL, chave única e claims atômicos. Lock de arquivo do SO mantém um supervisor por raiz durante toda a execução e é liberado pelo SO em crash; nenhum PID é usado para matar processos. A CLI é a entrada suportada, não `uvicorn --workers` nem múltiplas factories na mesma raiz.

Running encontrado em restart vira interrupted e exige retry explícito. Attempt/generation impede worker antigo de gravar após cancel/retry; progresso e resultado são commitados na mesma transação. Resultado sucedido é imutável e replay devolve mesmo objeto. Pause persiste em restart. Não há auto-retry infinito de jobs nem limpeza de fontes. Limites de paginação/extratos são 100; retenção administrativa da fila será entrega posterior.

## Resultado e sync

```json
{"schema_version":"tda_local_result_v1","campaign_id":"synthetic-campaign","session_id":"synthetic-session","source_id":"synthetic-source","job_id":"UUID","publication_bundle":{"schema_version":"publication_bundle_v1","publication_id":"SHA256","session":{"source_id":"synthetic-source"}},"sync":{"status":"not_configured"}}
```

Exemplo reduzido do bundle: campos completos são produzidos pela função legada preservada `legacy/publication.py`. `session.source_id` permanece recording_id; publication_id é SHA256 da serialização canônica do payload sem generated_at/publication_id. Envelope acrescenta campaign/session/job sem alterar hash legado. Não adicionar campos ao bundle sem versionar/recalcular a identidade. O payload preserva recap, approved_entries, open_threads e source_manifest, sem transcript/raw. Manifest mantém hashes de origem quando disponíveis; fixture não inventa hash de áudio.

Fixture marca `source_manifest.recording_format="synthetic.fixture"`; consumidor real deve rejeitá-la para publicação. Export é GET autenticado, mantido local até ação explícita de consumer autorizado. `sync:false` e `not_configured` são verdadeiros mesmo com rede disponível. Sync remoto autenticado, acceptance receipt e idempotência server-side são responsabilidade da frente de consumer; não se anuncia sucesso remoto neste corte. Site cloud permanece independente do processo local.

O envelope também fornece `import_artifacts:{publication_payload_json,transcript_json}`. São strings JSON UTF-8 canônicas produzidas em Python (`ensure_ascii=False,sort_keys=True,separators=(',',':')`). Consumer deve calcular SHA256 dos bytes dessas strings e só então fazer parse/validar; não reserializar em JavaScript (1.0 e 1 podem divergir). Publication payload exclui publication_id/generated_at; hash corresponde publication_id. Transcript hash corresponde source_manifest.transcript_sha256. Fixture exporta transcript_json `[]`, nunca conteúdo real. Esse campo é transporte local explícito, não upload automático.

Consumer real exige campaign_id e session_id UUIDs físicos preexistentes e autorizados; source_id é recording_id legado, igual session.source_id do bundle. Identidades opacas synthetic-campaign/synthetic-session da fixture não representam registros cloud e devem ser recusadas. Consumer não cria/binda sessão silenciosamente. Fonte técnica local_companion pertence ao envelope/consumer, não é acrescentada ao bundle alterando hash.
