# Processamento, jobs e áudio

> Status: legado funcional + modernização planejada
> Owner: processing/local-companion
> Última revisão: 2026-09-06

## Objetivo

Executar ingestão/transcrição/classificação e tarefas pesadas de forma rastreável, retomável e econômica sem tornar o site dependente do PC local ligado.

## Decisão arquitetural

**Site/Edit em cloud; processamento pesado local.**

A cloud guarda conteúdo sincronizado/metadados necessários ao produto. O companion local executa trabalho pesado e sincroniza resultados autorizados.

Motivações:

- custo previsível;
- aproveitar hardware local;
- evitar retenção cloud desnecessária de áudio bruto;
- manter o produto web disponível independentemente do worker local.

## Processing job

`processing_jobs` é lifecycle de uma unidade de trabalho.

Estados:

```text
queued -> running -> succeeded
             ├──> failed -> retrying -> running
             └──> cancelled
```

O contrato final de transições pode ser refinado, mas retries devem ser seguros.

## Job steps

`processing_job_steps` quebra job em etapas observáveis.

Benefícios:

- progresso granular;
- retry de subetapa;
- diagnóstico;
- UI de monitoramento;
- evitar request web bloqueado por minutos.

## Idempotência

Cada job persistente deve definir chave de idempotência/source identity quando possível.

Exemplos:

- ZIP Craig por recording/source hash;
- transcrição por audio hash + model + prompt/config;
- classificação por segment/content hash + model/prompt version;
- publicação por source run/candidate identity.

Retry não deve criar segunda sessão, segundo participant ou duplicar candidate sem intenção.

## Craig ingest

Pipeline histórico preparado:

```text
Craig ZIP/info
 -> craig_manifest
 -> validation
 -> track extraction steps
 -> recording_files/participants
 -> audio work units
```

`craig_manifests` preserva recording metadata, timezone, temporal quality e validation errors.

`craig_track_extraction_steps` registra cada track e seu resultado.

## Áudio

Existem três conceitos históricos que precisam permanecer distinguíveis:

### Recording file

Arquivo fonte cadastrado para session/participant.

### Chunk / speech slice

Unidade técnica temporária/derivada para processamento.

### Audio artifact

Registry mais geral de lifecycle/retention/lineage.

Modernização deve convergir responsabilidades sem quebrar dados existentes; não criar uma quarta identidade de arquivo.

## Silêncio

Schema guarda RMS/peak/dBFS/flags de silêncio e `audio_speech_slices`. Objetivo é evitar transcrever silêncio e reduzir custo/tempo.

Thresholds são parâmetros técnicos e precisam ser medidos com dados reais; não tratá-los como regra narrativa.

## Retenção

`audio_retention_policies` e `audio_artifacts.retention_class` modelam lifecycle histórico.

Classes incluem:

- permanent;
- permanent_compact;
- review_hold;
- work_temp;
- delete_after_success;
- delete_candidate;
- legal_hold.

**Decisão do reboot:** áudio bruto não integra retenção cloud obrigatória. O fato de o schema suportar `permanent` não significa que raw Craig deva ser enviado/mantido no R2 novo.

## Cleanup

Deleção segura precisa validar:

- artifact realmente superseded/temporário;
- output necessário foi produzido;
- lineage/hashes permanecem suficientes;
- nenhuma review depende daquele áudio;
- policy/hold permite delete;
- evento de lifecycle é registrado.

Nunca limpar raw/source apenas porque um job possui status genérico `succeeded` sem verificar qual etapa/output teve sucesso.

## Transcription cache

Cache é chave para custo/tempo. Deve ser reaproveitado apenas quando source + configuração realmente equivalem.

Mudança de modelo/prompt/language pode invalidar reuse sem apagar a resposta histórica.

## AI usage ledger

Toda operação cara deve idealmente registrar:

- provider/model;
- operation type;
- session/job;
- input metrics;
- tokens/minutos;
- estimated/actual cost;
- cache/skip/failure;
- run/provider IDs.

Isso permite comparar local vs cloud e detectar custo inesperado.

## Sincronização cloud

Companion deve enviar dados derivados autorizados de maneira autenticada e retomável.

Requisitos futuros:

- protocolo/versionamento;
- idempotency key;
- auth com capability mínima;
- batch/resume;
- checksum;
- confirmação server-side;
- sem depender de service key irrestrita em UI local distribuída.

## Falhas

### ZIP inválido

Manifest fica invalid/warning; não criar session data como se ingest tivesse sido confiável.

### Track faltando

Registrar step failed/missing; não remapear silenciosamente para outro participant.

### Transcrição falha

Preservar chunk/source e permitir retry/cache alternativo.

### Classificação falha

Transcript continua válido como evidência; candidate não é requisito para guardar transcript.

### Sync falha

Fila local deve poder retomar sem duplicar conteúdo remoto.

## Observabilidade

Usar:

- job/step status;
- timestamps/duração;
- error explícito;
- manifest validation errors;
- artifact lifecycle events;
- AI usage/cost;
- hashes/IDs de fonte.

## Futuro executável

- modernizar companion existente em vez de reescrever sem baseline;
- benchmark qualidade/tempo/memória;
- UI de jobs/retry no Edit;
- sincronização autenticada;
- cleanup comprovadamente seguro;
- documentação de distribuição/update do companion.
