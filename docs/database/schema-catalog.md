# Catálogo do schema Supabase

> Status: implementado
> Owner: dados/Supabase
> Última revisão: 2026-09-20
> Fonte observada: `public` no projeto `dmrqnbdvbkfqzctcerbx`

Este catálogo descreve as **54 tabelas públicas observadas em 2026-09-20**. Contagens são uma fotografia da revisão e não um contrato. RLS estava habilitado em todas elas. O migration history remoto possuía 53 entradas; a evolução/identidade das migrations continua em [migrations.md](migrations.md).

Para regras conceituais, consultar [modelo de dados](../data-model.md). Para segurança, consultar [security.md](security.md).

## Resumo

| Tabela | Linhas observadas | Papel |
| --- | ---: | --- |
| `campaigns` | 1 | campanhas |
| `profiles` | 5 | pessoas/contas |
| `campaign_members` | 4 | membership legado simples |
| `sessions` | 11 | sessões da campanha |
| `participants` | 18 | participação por sessão |
| `recording_files` | 31 | arquivos/fontes registrados |
| `processing_jobs` | 146 | jobs de processamento |
| `audio_chunks` | 348 | chunks de áudio |
| `transcript_segments` | 30.857 | segmentos transcritos |
| `roll20_events` | 0 | eventos importados do Roll20 |
| `session_markers` | 0 | marcadores de sessão |
| `segment_classifications` | 2.488 | classificação derivada por IA |
| `entities` | 34 | registry narrativa canônica |
| `entity_mentions` | 0 | menções de entity em evidências |
| `canon_candidates` | 161 | candidatos de canon |
| `quote_candidates` | 68 | candidatos de falas |
| `outtake_candidates` | 75 | candidatos de bastidores |
| `review_decisions` | 2 | decisões de revisão |
| `publications` | 4 | materiais revisados/publicáveis |
| `audit_log` | 20 | trilha de mudanças relevantes |
| `historical_documents` | 0 | histórico textual importável |
| `canon_entries` | 0 | memória canônica consolidada |
| `transcription_cache` | 2.423 | cache de respostas de transcrição |
| `ai_usage_ledger` | 2.423 | uso/custo de IA |
| `audio_speech_slices` | 3.137 | fatias com fala detectada |
| `profile_characters` | 3 | vínculo profile ↔ PC |
| `profile_claims` | 0 | reivindicação/vínculo de perfil |
| `discord_interactions` | 5 | log estruturado de interactions |
| `table_notes` | 0 | notas de mesa para revisão |
| `permission_catalog` | 25 | catálogo de capabilities |
| `role_definitions` | 16 | roles extensíveis |
| `role_permissions` | 50 | role ↔ capability |
| `role_assignments` | 22 | role atribuída por scope |
| `dm_tenures` | 1 | mandatos/função de DM |
| `audio_artifacts` | 2.453 | lifecycle de artefatos de áudio |
| `audio_artifact_events` | 7.624 | eventos de lifecycle dos artefatos |
| `audio_retention_policies` | 13 | política por tipo de artefato |
| `processing_job_steps` | 23 | passos internos de jobs |
| `craig_manifests` | 3 | manifesto estruturado de Craig |
| `craig_track_extraction_steps` | 18 | extração de tracks Craig |
| `ordo_access_members` | 0 | acesso delegado específico do Ordo |
| `external_api_clients` | 1 | clientes de API externa |
| `external_api_keys` | 1 | chaves hashed/scoped de API |
| `world_layout_snapshots` | 1 | layout editorial publicado do World |
| `world_edit_leases` | 0 | lease exclusivo/efêmero de edição |
| `relation_types` | 14 | vocabulário de relações por campanha |
| `world_relation_styles` | 14 | estilo visual por tipo de relação |
| `entity_relations` | 103 | relações first-class entre entities |
| `entity_relation_sources` | 0 | provenance canônica de relações |
| `world_graph_heads` | 1 | revision factual corrente por campanha |
| `world_graph_revisions` | 9 | snapshots factuais publicados |
| `media_assets` | 0 | identidade/integridade de mídia de domínio |
| `entity_media_bindings` | 0 | vínculo entity → asset por role |
| `world_edit_drafts` | 5 | checkpoints duráveis de edição do World |

---

# Campanha e identidade

## `campaigns`

**Propósito:** raiz de isolamento narrativo. Hoje contém a campanha principal `yuhara-main`.

Campos:

- `id uuid` PK;
- `name text`;
- `slug text unique` — identidade legível/canônica da campanha;
- `description text?`;
- `metadata jsonb` — extensão, não contrato central;
- timestamps.

É referenciada por sessions, memberships, entities, canon, RBAC relacionado, auditoria e integrações. Uma feature multi-campanha deve sempre respeitar `campaign_id`; não assumir eternamente que só existe uma campanha.

## `profiles`

**Propósito:** identidade humana/conta do TDA. Não representa personagem.

Campos relevantes:

- `id uuid` PK;
- `display_name`;
- identidades externas opcionais: `discord_id`, `discord_handle`, `roll20_name`;
- legado: `default_character_name`;
- provenance: `source_system`, `source_key`, `metadata`;
- Auth: `auth_user_id -> auth.users.id`, `email`, `avatar_url`, `last_sign_in_at`.

É alvo de FKs de membership, participants, speakers, aprovação, RBAC, DM tenure, uploads e auditoria.

**Invariante:** `profile` é pessoa. Um jogador com dois PCs continua sendo um profile com múltiplos vínculos narrativos.

## `campaign_members`

**Propósito:** membership simples histórico usado por RPCs/fluxos legados.

Campos:

- `campaign_id -> campaigns`;
- `profile_id -> profiles`;
- `role` em `owner | master | player | reviewer | viewer`.

**Direção:** continuar compatível, mas novas superfícies devem convergir para RBAC/capabilities.

## `profile_characters`

**Propósito:** associação de uma pessoa a um personagem jogável.

Campos:

- `campaign_id`;
- `profile_id`;
- `entity_id -> entities` — identidade narrativa canônica do PC;
- `character_name` — texto legado/apresentação;
- `aliases[]`;
- `status` em `active | inactive | npc | guest | archived`;
- aprovação: `approved_by`, `approved_at`;
- `player_note`, `metadata`.

**Estado atual:** 3/3 registros possuem `entity_id` após alinhamento do reboot.

**Regra:** NPC canônico não precisa desta tabela. O status legado `npc` não cria uma segunda identidade de NPC.

## `profile_claims`

**Propósito:** fluxo para usuário autenticado reivindicar/vincular um profile existente ou sugerir seus dados.

Campos incluem requester (`auth_user_id`, email/nome), target profile, nomes Discord/Roll20 solicitados, `requested_character_names[]`, nota do jogador, status `pending | approved | rejected | cancelled` e dados de revisão.

**Segurança:** é superfície sensível de identidade; writes/leitura devem permanecer autorizados e auditáveis.

---

# Sessões, participantes e fontes

## `sessions`

**Propósito:** unidade principal de uma sessão de jogo.

Campos:

- `campaign_id`;
- `title`, `slug`, `session_date`, `arc`;
- lifecycle `status`: `planned | recording | uploaded | processing | ready_for_review | reviewing | approved | published | archived | failed`;
- `summary_short`, `summary_full`;
- `consent_confirmed`;
- `created_by`;
- provenance: `source_system`, `source_session_id`;
- tempo: `started_at`, `ended_at`, `duration_ms`;
- `metadata`.

É o hub que conecta participants, arquivos, jobs, transcrição, candidatos, publicações e eventos.

## `participants`

**Propósito:** ocorrência operacional de alguém/personagem em **uma sessão**.

Campos:

- `session_id`;
- `profile_id?` — pessoa quando conhecida;
- `character_entity_id? -> entities` — personagem canônico representado;
- `player_name`, `character_name`;
- `role`;
- fonte Craig/Discord: `audio_track_label`, `source_track_key`, handles/IDs;
- `character_aliases[]`, `participant_status`, `needs_review`, `metadata`.

**Invariante:** participant não substitui profile nem entity. Histórico pode ter entity resolvida sem profile resolvido.

## `recording_files`

**Propósito:** catálogo de arquivos fonte/derivados associados à sessão.

Campos:

- `session_id`, `participant_id?`;
- `file_type`: `craig_track | craig_info | obs_backup | roll20_chat | discord_log | manual_notes | transcript_raw | processed_json | publication | other`;
- storage: bucket/path, filename, MIME, size/duration;
- `uploaded_by`;
- provenance: `source_system`, `source_file_role`;
- integridade/análise: `sha256`, RMS, peak, dBFS, `probably_silent`, threshold;
- `metadata`.

Não implica retenção permanente do objeto; lifecycle detalhado de áudio evoluiu para `audio_artifacts`.

## `roll20_events`

**Propósito:** eventos/marcadores estruturados importados do Roll20.

Campos: session, `event_type`, autor/personagem textual, `approx_start_ms`, texto, payload/raw line, IDs/timestamps de origem.

**Autoridade:** evento é evidência. Não vira canon sem revisão.

## `session_markers`

**Propósito:** marcadores leves durante/depois da sessão.

`source` aceita `craig | discord | roll20 | site | manual | audio_detected`; possui tipo, texto, timestamp aproximado, autor e payload.

Serve para orientar revisão/timeline; não é memória canônica automaticamente.

## `discord_interactions`

**Propósito:** registro estruturado das interactions/comandos recebidos via Discord.

Guarda IDs Discord, usuário/canal/guild, tipo/comando, campaign/session opcionais, payload e response.

**Regra:** não usar payload bruto como autorização; identidade externa deve ser resolvida por regras próprias.

## `table_notes`

**Propósito:** notas capturadas pela mesa para posterior revisão.

Tipos: `note | canon | npc | location | item | backstage | quote | question`.

Visibilidade operacional: `dm_review | table_private | player_visible | public_candidate`.

Review: `pending | approved | rejected | private | converted`.

**Invariante:** `note_type=canon` significa intenção/candidato de mesa, não bypass do gate canônico.

## `historical_documents`

**Propósito:** importar documentos históricos sem contaminar diretamente o canon.

Campos: campaign, `source_path`, title/content/hash, status `historical_import | needs_review | reviewed | archived`, metadata.

**Invariante:** histórico pesquisável continua sendo fonte; não é aprovação retroativa.

---

# Transcrição e classificação

## `audio_chunks`

**Propósito:** unidade técnica de divisão de áudio para processamento.

Campos: session/source file, índice, `start_ms/end_ms`, storage local/remoto, transcription status, track/source names, duração/tamanho, hash e análise de silêncio.

## `audio_speech_slices`

**Propósito:** fatias detectadas como fala, reduzindo processamento de silêncio.

Campos: session/source file/chunk, track, índice, offsets/duração, storage, hash/níveis de áudio, método/parâmetros de detecção e transcription status.

Default de storage observado: `local`.

## `transcription_cache`

**Propósito:** cache deduplicável de resultado de transcrição por hash/model/configuração.

Campos: hash/duração, provider/model/prompt/language, status, texto/segments/raw response, request ID, tokens/minutos/custos, metadata.

Status: `succeeded | failed | skipped_silence | needs_review`.

**Regra:** cache é otimização e provenance; não é fonte canônica final.

## `transcript_segments`

**Propósito:** timeline textual derivada da sessão.

Campos centrais:

- session/speaker profile/participant;
- `character_name` textual;
- source file/chunk;
- `start_ms`, `end_ms`, `text`, confidence, language;
- IDs/sequência/track/speaker role;
- paths de origem/response;
- métricas de texto;
- `needs_review`, `review_status`, `tags[]`, metadata;
- `revision bigint not null default 0` para optimistic concurrency de edição.

Com 30.857 linhas, é a maior superfície narrativa textual observada.

**Regra:** transcrição pode conter erro, OOC, piada, hipótese ou informação sensível. Nunca tratá-la como canon bruto.

## `segment_classifications`

**Propósito:** classificação derivada de segmentos.

Campos: segment, `segment_type`, `canon_relevance` (`none | low | medium | high`), confidence, needs_review, reason, model, prompt_version, source_run_id, raw_output, metadata.

**Regra:** classificação é derivação reproduzível/auditável; preservar modelo/prompt/run quando possível.

---

# Candidatos, revisão e publicação

## `canon_candidates`

**Propósito:** afirmações propostas para canon.

Campos:

- session;
- title/claim/type;
- status: `candidate | approved_canon | rejected | interpretation | possible_hook | retcon_pending | private | published`;
- confidence;
- `related_entity_ids[]`;
- `source_segment_ids[]`, `source_roll20_event_ids[]`;
- reviewer notes/approval;
- provenance `source_system`, `source_run_id`, `source_candidate_id`;
- metadata.

**Regra:** somente `approved_canon` é elegível para consolidação canônica.

## `quote_candidates`

**Propósito:** falas marcantes candidatas.

Guarda texto, personagem, speaker profile, contexto, status, aprovação pública e fontes de segmento/provenance.

Aprovação para público é distinta de ser interessante narrativamente.

## `outtake_candidates`

**Propósito:** bastidores/cortes com controle explícito de sensibilidade.

`severity/sensitivity_level`: `normal | needs_speaker_approval | private | sensitive`.

Status: `candidate | approved_by_speaker | approved_by_all | rejected | private | published`.

**Regra:** bastidor nunca é canon apenas por ser aprovado para publicação.

## `review_decisions`

**Propósito:** registrar decisão humana sobre um target revisável.

Campos: session, `target_table`, `target_id`, decision, notes, actor, provenance IDs e metadata.

**Dívida:** target polimórfico é textual; novos domínios devem avaliar consistência/auditoria antes de ampliar esse padrão.

## `publications`

**Propósito:** material editorial revisado.

Tipos: `recap_short | recap_full | canon_changes | timeline | quotes | outtakes_public | master_notes | player_version | other`.

Visibility: `private_master | private_players | review_only | public_campaign | public_web`.

Status: `draft | approved | published | archived`.

**Regra:** publicação e canon são conceitos relacionados, mas diferentes. Um recap pode resumir canon sem ser a registry canônica de fatos.

---

# Entidades e memória

## `entities`

**Propósito:** registry canônica do mundo narrativo.

Tipos: `pc | npc | location | item | organization | faction | arc | concept | song | quest | other`.

Campos: campaign, name, slug, type, status, visibility, summary, aliases, timestamps.

Visibility: `private_master | private_players | review_only | public_campaign | public_web`.

**Estado observado em 2026-09-20:** 34 entities. O snapshot de contagem não define canon nem audience; consumers continuam filtrando por status/visibility/autorização.

**Compatibilidade conhecida:** legado ainda depende de unicidade `(campaign_id, name)`. Direção futura é identidade por UUID/slug; liberar homônimos exige primeiro migrar o consolidator legado.

## `entity_mentions`

**Propósito:** ligar entity a evidência de menção.

Pode referenciar session, transcript segment e/ou Roll20 event, com mention text/confidence.

**Regra:** menção não prova relação nem fato canônico.

## `canon_entries`

**Propósito:** memória canônica consolidada.

Campos: campaign, entity opcional, `source_candidate_id`, title/content/type, visibility, status, source_run_id, metadata.

Status: `active | superseded | retcon_pending | archived`.

**Regra:** entrada nasce de candidato aprovado e preserva source candidate. Retcon deve manter histórico.

## `audit_log`

**Propósito:** trilha genérica de ações/mudanças relevantes.

Campos: campaign/session/actor, action, table/record, old/new JSON, timestamp.

Na fotografia de 2026-09-20 há 20 eventos. A existência de linhas não prova cobertura completa de todos os writes; cada mutation que depende de audit precisa testar sua própria atomicidade/cobertura.

---

# Jobs, IA e custos

## `processing_jobs`

**Propósito:** lifecycle de tarefas assíncronas/locais.

Status: `queued | running | succeeded | failed | retrying | cancelled`.

Campos: session opcional, job_type, attempts, input/output/error, timestamps.

**Regra:** jobs devem ser idempotentes/retry-safe onde houver efeito persistente.

## `processing_job_steps`

**Propósito:** decompor jobs em etapas observáveis/reexecutáveis.

Status: `pending | running | succeeded | failed | retrying | skipped | blocked`.

Inclui attempts, retryable, order, progress JSON, error e timestamps.

## `ai_usage_ledger`

**Propósito:** contabilizar operações de IA e custo estimado/real.

Operation: `transcription | classification | summarization | embedding | rerank | other`.

Status: `estimated | submitted | succeeded | failed | cached | skipped`.

Guarda provider/model, hashes/request IDs, tokens/minutos, custo/currency e metadata.

**Regra:** custo deve ser atribuível a operação/job/session quando possível.

---

# Craig e lifecycle de áudio

## `craig_manifests`

**Propósito:** contrato estruturado de um pacote/gravação Craig.

Guarda session, recording file fonte, job criador, schema version, validation status, recording/guild/channel/requester, timestamps lógicos, timezone, duração, métricas do ZIP/tracks/participants, manifesto e validation errors.

Status: `parsed | valid | warning | invalid | superseded`.

## `craig_track_extraction_steps`

**Propósito:** rastrear extração individual de tracks do pacote Craig.

Guarda origem/destino, track key, arquivo fonte/recording file resultante, status/attempts, tamanhos, duração, compression/crc, erro e timestamps.

Status: `pending | running | succeeded | failed | skipped`.

## `audio_artifacts`

**Propósito:** registry de artefatos de áudio e derivados com lifecycle/retention explícitos.

Tipos incluem Craig ZIP/info, raw tracks, chunks, speech slices, compact tracks/session, transcript source, manifest, exports e other.

Retention classes: `permanent | permanent_compact | review_hold | work_temp | delete_after_success | delete_candidate | legal_hold`.

Lifecycle: `planned | active | superseded | delete_ready | delete_queued | deleted | missing | failed`.

Também registra parentesco, job criador, storage, codec, sample rate, channels, hash, offsets, expiration e motivo de deleção.

**Regra do reboot:** esta estrutura histórica não significa que áudio bruto deve voltar a ser retido na cloud.

## `audio_artifact_events`

**Propósito:** event log do lifecycle de artefatos.

Eventos: `created | classified | compacted | superseded | marked_delete_ready | delete_queued | deleted | missing_detected | restore_requested | note`.

Pode apontar para actor profile e processing job.

## `audio_retention_policies`

**Propósito:** política declarativa padrão por `artifact_type`.

Define classe de retenção, manter original, codec/bitrate preferidos, expiração, deleção quando superseded e notas.

**Regra:** política precisa ser interpretada pela operação; existência da linha não prova que cleanup está sendo executado.

---

# RBAC e governança

## `permission_catalog`

**Propósito:** catálogo de capabilities/ações.

PK: `action`. Cada capability possui `plane` (`technical | narrative | mixed`) e descrição.

## `role_definitions`

**Propósito:** roles nomeadas como agrupadores de capabilities.

Campos: slug único, name, plane, description, `is_system`, timestamps.

**Regra:** UI nova depende de capability, não da label/slug da role.

## `role_permissions`

**Propósito:** N:N role ↔ capability.

PK composta (`role_id`, `permission_action`).

## `role_assignments`

**Propósito:** atribuir role a profile em um scope.

Scope: `project | campaign | session | resource | integration`.

Status: `active | eligible | ended | revoked`; inclui janela temporal, assigned/revoked by, reason e metadata.

Scopes técnicos atuais incluem `tda` e o alias legado `dnd-scribe` durante a transição.

## `dm_tenures`

**Propósito:** representar mandato/período de DM separado da simples membership.

Tipos: `primary | co_dm | session`.

Status: `active | ended | revoked`.

Vincula campaign/profile e opcionalmente role assignment.

## `ordo_access_members`

**Propósito:** acesso delegado específico da superfície Ordo, controlado pela identidade mestre.

Campos: email normalizado único, role `admin | viewer`, status `active | suspended`, creators/updaters e timestamps.

**Nota:** é um modelo específico coexistente; não assumir que substitui RBAC geral.

---

# API externa

## `external_api_clients`

**Propósito:** representar consumidores externos autorizados de API.

Campos: campaign, name/description, creator, revoke timestamp e metadata.

## `external_api_keys`

**Propósito:** credenciais de cliente armazenadas por hash/prefix, nunca secret em claro.

Campos: client, prefix/hash, scopes (default observado `summaries:read`), expiração/revogação, last used, counters/rate window e metadata.

**Segurança:** documentação nunca deve registrar valor real da chave. Rotação/revogação pertencem a runbook de segurança.

---

# Relações críticas resumidas

```text
campaigns
 ├─ profiles via membership/RBAC
 ├─ sessions
 │   ├─ participants ──> profiles
 │   │                 └─> entities (character)
 │   ├─ recording_files
 │   │   └─> audio_chunks -> speech_slices
 │   ├─ transcript_segments -> segment_classifications
 │   ├─ candidates -> review_decisions
 │   └─ publications
 └─ entities
     ├─ entity_mentions -> sessions/segments/roll20
     └─ canon_entries -> approved canon_candidates

profiles
 └─ profile_characters -> entities(type=pc)

roles -> role_permissions -> permission_catalog
profiles -> role_assignments(scope)
```

## Lacunas intencionais/futuras

Ainda não existe contrato aprovado para:

- `entity_relations`/grafo;
- knowledge claims / "quem sabe o quê";
- geografia/map pins estruturados;
- embeddings/search index canônico;
- intents/intenção como conceito de domínio.

Esses itens devem ser desenhados e documentados antes de nova DDL.


---

# World Explorer, relações e autoria

## `world_layout_snapshots`

**Propósito:** persistir composição editorial do canvas separada dos fatos narrativos.

Campos centrais: `id`, campaign, `view_name`, `schema_version`, `revision`, `positions jsonb`, `updated_by` e timestamps. Há unicidade por campanha/view e optimistic concurrency por revision.

**Regra:** mover node altera apresentação, não entity/relation/canon.

## `world_edit_leases`

**Propósito:** serializar a sessão ativa de edição por campanha.

PK por `campaign_id`; guarda holder profile, token, revisions-base de layout/grafo, draft efêmero, timestamps/heartbeat e expiração.

**Regra:** lease é exclusividade temporária, não armazenamento durável.

## `world_edit_drafts`

**Propósito:** checkpoint durável e recuperável do trabalho editorial do World.

Campos incluem campaign, owner profile, lease token, base revisions, `draft_positions`, `draft_graph`, status, última tentativa/erro de publicação e revisions efetivamente publicadas.

**Regra:** expiração/release da lease não deve apagar horas de trabalho recuperável.

## `relation_types`

**Propósito:** catálogo de semântica de relações por campanha.

PK composta campaign + slug. Guarda label, directionality, family, description, flags system/active, actors e timestamps.

## `world_relation_styles`

**Propósito:** defaults de apresentação por relation type, sem redefinir a semântica factual.

PK composta campaign + relation type; guarda color, line style/width e actor de atualização.

## `entity_relations`

**Propósito:** relações first-class entre duas entities.

Campos centrais: source/target entity, relation type, label override, status, visibility, style overrides, `revision`, actor, metadata e timestamps.

**Regras:** source/target e tipo pertencem à campanha; duplicata/semântica são validadas pelo boundary de autoria; archived/superseded preservam história em vez de hard delete editorial.

## `entity_relation_sources`

**Propósito:** ligar relation a `canon_entries` como provenance explícita.

PK composta relation + canon entry. Linha ausente não autoriza fabricar fonte.

## `world_graph_heads`

**Propósito:** ponteiro de revision factual corrente por campanha.

PK campaign; guarda revision, updated_by e timestamps.

## `world_graph_revisions`

**Propósito:** snapshots append-only de publicações factuais explícitas.

PK campaign + revision; guarda actor, snapshot JSON e timestamp. O head corrente e o histórico são conceitos distintos.

---

# Mídia de entities

## `media_assets`

**Propósito:** identidade/integridade de mídia pertencente ao domínio sem armazenar os bytes no PostgreSQL.

Campos centrais: campaign, kind/role, status, bucket/key de staging, SHA-256, MIME, bytes, dimensões, read-back, bucket/key público, verificação de entrega pública, actor e timestamps.

**Regra:** object storage guarda bytes; provider/URL não é identidade canônica. Asset staged não é automaticamente público.

## `entity_media_bindings`

**Propósito:** vínculo first-class de entity a asset por role.

PK composta campaign + entity + role; hoje o role físico suportado é `portrait`. Guarda `asset_id`, focal point e actor/timestamps.

**Regra:** binding exige entity/asset da mesma campanha. Focal point é apresentação do uso, não mutação do master.
