# Catálogo do schema Supabase

> Status: implementado
> Owner: dados/Supabase
> Última revisão: 2026-09-06
> Fonte observada: `public` no projeto `dmrqnbdvbkfqzctcerbx`

Este catálogo descreve as **43 tabelas públicas observadas**. Contagens são uma fotografia da revisão e não um contrato. RLS estava habilitado em todas elas.

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
| `entities` | 3 | registry narrativa canônica |
| `entity_mentions` | 0 | menções de entity em evidências |
| `canon_candidates` | 159 | candidatos de canon |
| `quote_candidates` | 68 | candidatos de falas |
| `outtake_candidates` | 75 | candidatos de bastidores |
| `review_decisions` | 2 | decisões de revisão |
| `publications` | 4 | materiais revisados/publicáveis |
| `audit_log` | 0 | trilha de mudanças relevantes |
| `historical_documents` | 0 | histórico textual importável |
| `canon_entries` | 0 | memória canônica consolidada |
| `transcription_cache` | 2.423 | cache de respostas de transcrição |
| `ai_usage_ledger` | 2.423 | uso/custo de IA |
| `audio_speech_slices` | 3.137 | fatias com fala detectada |
| `profile_characters` | 3 | vínculo profile ↔ PC |
| `profile_claims` | 0 | reivindicação/vínculo de perfil |
| `discord_interactions` | 5 | log estruturado de interactions |
| `table_notes` | 0 | notas de mesa para revisão |
| `permission_catalog` | 24 | catálogo de capabilities |
| `role_definitions` | 16 | roles extensíveis |
| `role_permissions` | 49 | role ↔ capability |
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
- `needs_review`, `review_status`, `tags[]`, metadata.

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

**Estado atual:** Astel, Dandelion e Screacky existem como PCs.

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

Ainda vazio na fotografia atual; antes de depender dele como requisito regulatório/forense, garantir cobertura real de writes.

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
