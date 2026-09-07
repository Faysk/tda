# Sync server-side de transcrição local

> Status: contrato SQL candidato; não aplicado em produção
> Owner: consumer server-side sync + dados/Supabase
> Última revisão: 2026-09-07

## Objetivo

Persistir o resultado `tda_local_result_v1` produzido pelo companion local de forma atômica, idempotente e auditável por receipt, sem criar sessão, sem substituir edição humana e sem permitir que o browser escolha actor/capability.

Este slice recebe apenas sessões físicas já existentes no Supabase.

## Identidade física

O envelope resolve antes da persistence:

```text
campaign_id       UUID físico existente
session_id        UUID físico existente
source_system     local_companion (fixo)
source_session_id envelope.source_id
```

A RPC exige que a linha de `sessions` corresponda exatamente aos quatro valores. O índice existente `(campaign_id, source_system, source_session_id)` continua sendo a identidade externa da sessão; a migration não cria uma identidade paralela.

## Artifacts e hashes

O consumer fornece as strings JSON canônicas produzidas por Python:

- `publication_payload_json`;
- `transcript_json`.

E os SHA-256 hexadecimais minúsculos calculados sobre os bytes UTF-8 **exatos** dessas strings.

A RPC recalcula ambos com `pgcrypto` antes de qualquer persistência. Parsear para `jsonb` serve para validação/mapeamento, mas não redefine o hash: whitespace, escaping e ordenação fazem parte do artifact recebido.

`publication_payload_json` precisa ser um objeto JSON. `transcript_json` pode ser o array legado diretamente ou um objeto contendo `segments[]`; ambos preservam a mesma allowlist de destino.

## Capability e actor

Capability candidata:

```text
campaign.transcript.import
plane = mixed
```

A migration candidata a associa somente ao role `local_operator`.

A RPC é server-only `SECURITY INVOKER` e recebe `actor_profile_id` já resolvido pelo boundary autenticado do consumer. Além dessa resolução no servidor, a própria RPC exige assignment ativo e temporalmente válido que contenha a action exata e cubra a campaign por uma destas formas:

```text
scope_type=campaign + scope_id={campaign.slug}
```

ou

```text
scope_type=project + scope_id=tda
```

`project/dnd-scribe` não autoriza o novo importer.

A sessão é então revalidada por `session_id + campaign_id + local_companion + source_session_id` e bloqueada com `FOR UPDATE`, serializando imports concorrentes da mesma sessão.

## Receipt

Tabela candidata:

```text
transcript_import_receipts
```

Campos:

- `id`;
- `campaign_id`;
- `session_id`;
- `actor_profile_id`;
- `source_system = local_companion`;
- `source_session_id`;
- `envelope_schema = tda_local_result_v1`;
- `publication_payload_sha256`;
- `transcript_sha256`;
- `segment_count`;
- `created_at`.

A identidade única é:

```text
(campaign_id, source_system, source_session_id)
```

O receipt é imutável pelo grant pretendido: `service_role` recebe somente `SELECT + INSERT`; `PUBLIC`, `anon` e `authenticated` não recebem acesso direto.

## Estados da RPC

`public.import_transcript_result_atomic(...)` retorna:

| Status | Semântica |
| --- | --- |
| `imported` | primeiro import aceito; segmentos + receipt persistidos na mesma transação |
| `replay` | receipt já existe e os dois hashes são exatamente iguais; zero writes |
| `hash_conflict` | mesma identidade externa com um dos hashes diferente; zero writes |
| `legacy_unreceipted` | a sessão já possui segmentos mas não possui receipt; fail-closed, sem adoção/replace |
| `not_found` | campaign/session/source ownership não corresponde |

Actor sem `campaign.transcript.import` recebe `insufficient_privilege`; hash/shape inválidos recebem `invalid_parameter_value`.

## Mapping allowlisted de segmentos

Shape legado recebido:

```text
{id, speaker, track, start, end, text, words}
```

Destino:

| Origem | `transcript_segments` |
| --- | --- |
| `id` | `source_segment_id` |
| ordem no array | `source_sequence` zero-based |
| `speaker` | `speaker_name`, vazio vira null |
| `track` | `track_key`, vazio vira null |
| `start` | `start_ms` |
| `end` | `end_ms` |
| `text` | `text` |
| comprimento calculado | `text_chars` |
| `words` | `text_words` |
| texto vazio | `is_empty` |
| fixo | `needs_review=true` |
| fixo | `review_status='pending'` |
| fixo | `revision=0` |

O importer não inventa `speaker_profile_id`, `participant_id` nem `character_name`; também não liga source file/chunk que não veio no envelope.

IDs de segmento duplicados, offsets inválidos, bounds incompatíveis ou tipos fora do shape abortam a transação.

## Regra de não sobrescrita

O importer nunca executa update/delete de `transcript_segments`.

Se já houver receipt, só existe replay ou hash conflict. Se a sessão possuir segmentos sem receipt, retorna `legacy_unreceipted`. Isso preserva transcrição histórica e futuras edições humanas (`revision > 0`) sem tentar reconciliá-las implicitamente.

Adoção de sessões históricas sem receipt, supersession ou reimport versionado exigem contrato próprio.

## Atomicidade e concorrência

O receipt é o commit marker e é inserido depois dos segmentos, dentro da mesma chamada/transação. Falha de insert/constraint/trigger do receipt precisa reverter todos os segmentos inseridos pela chamada.

O lock da linha de `sessions` serializa duas conexões para a mesma sessão. Critérios do ensaio real:

1. mesmo source identity + mesmos hashes: uma conexão `imported`, outra bloqueia e depois retorna `replay`; exatamente um receipt/conjunto de segmentos;
2. mesmo source identity + hashes diferentes: uma `imported`, outra `hash_conflict`; exatamente um receipt/conjunto vencedor;
3. observar `pg_blocking_pids()`/`Lock/transactionid` durante a corrida;
4. executar chamadas efetivamente como `service_role`;
5. repetir rollback forçado do receipt.

Artefatos preparados:

- `supabase/tests/fixtures/transcript_import_atomic_minimal_schema.sql`;
- `supabase/tests/import_transcript_result_atomic.sql`;
- `supabase/tests/import_transcript_result_atomic_concurrency.sh`.

## Produção

A migration `20260907193000_import_transcript_result_atomic` é candidata de PR. Não foi aplicada no projeto `dmrqnbdvbkfqzctcerbx`.

Como `20260907115300_edit_transcript_segment_atomic` também permanece candidata/não aplicada no histórico remoto, não executar `db push` ou aplicação em lote sem serialização deliberada pelo dono de banco. Antes de produção: reconciliar `main`, validar em banco isolado, revisar rollback/consumidores, aplicar pelo runbook, conferir migration history/grants/RPC, rodar advisors e registrar `verification-log.md`.
