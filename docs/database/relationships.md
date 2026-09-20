# Relacionamentos e ownership de dados

> Status: vigente
> Owner: dados + domínios
> Última revisão: 2026-09-20

Este documento explica **o significado das relações**, não apenas FKs. O catálogo físico está em [schema-catalog.md](schema-catalog.md).

## Raízes de identidade

### Campaign

`campaigns.id` é o boundary principal dos dados narrativos. `yuhara-main` é a campanha vigente, mas queries novas devem continuar explicitando o campaign boundary quando pertinente.

### Profile

`profiles.id` identifica pessoa/conta. Pode apontar para `auth.users`. É usado como ator, speaker humano, membro, aprovador e receptor de role.

### Entity

`entities.id` identifica objeto narrativo persistente. É independente de login, speaker ou ocorrência em sessão.

### Session

`sessions.id` identifica uma sessão de jogo/processamento/publicação. É o principal agregador de evidências temporais.

## Pessoa ↔ personagem

```text
profiles
   │ 1:N
   ▼
profile_characters
   │ N:1
   ▼
entities(type=pc)
```

`profile_characters` significa controle/representação de um PC pela pessoa naquela campanha. Não significa que todo entity precisa de profile.

NPC:

```text
entities(type=npc)
```

sem `profile_characters` obrigatório.

## Personagem ↔ sessão

```text
entities(pc)
     ▲
     │ character_entity_id?
participants
     │
     ▼
sessions
```

Um participant registra a ocorrência numa sessão. O vínculo humano `profile_id` e o narrativo `character_entity_id` podem ser resolvidos independentemente.

Isso é importante para histórico: identificar "Dandelion" não autoriza inventar qual conta humana estava ligada ao registro antigo.

## Evidência temporal

```text
sessions
 ├─ recording_files
 │   └─ audio_chunks
 │       └─ audio_speech_slices
 ├─ transcript_segments
 ├─ roll20_events
 ├─ session_markers
 ├─ table_notes
 └─ discord_interactions
```

Cada fonte possui provenance própria. Não fundir eventos externos e transcript em um único blob sem preservar a origem.

## Derivação de IA

```text
transcript_segments
       │
       ▼
segment_classifications
       │
       ├─> canon_candidates
       ├─> quote_candidates
       └─> outtake_candidates
```

Nem todas as relações acima são FKs diretas completas; candidatos mantêm arrays de source IDs/provenance. Ao evoluir esse domínio, preferir integridade referencial quando ela não inviabilizar ingestão/reprocessamento.

## Canon

```text
canon_candidates(approved_canon)
          │
          ▼
canon_entries ─────> entities?
```

`canon_entries.source_candidate_id` preserva a decisão de origem. `entity_id` organiza memória por entity, mas uma entrada de canon pode ser de campanha/evento sem entity única.

## Menções

```text
                  ┌─ session
entity_mentions ──┼─ transcript_segment
                  └─ roll20_event
        │
        ▼
      entity
```

Menção é índice/evidência. Não confundir com relation edge nem canon.

## Publicação

`publications` pertence a session e possui type, visibility e status próprios. Publicação é representação editorial. O texto publicado não substitui `canon_entries` como memória estruturada.

## Review

`review_decisions` aponta para targets de forma polimórfica (`target_table`, `target_id`). Esse padrão é legado funcional e exige validação cuidadosa: não há FK única capaz de garantir todos os targets.

Antes de ampliar o uso, decidir se novos fluxos continuam com target polimórfico ou ganham tabelas/constraints específicas.

## RBAC

```text
permission_catalog
        ▲
        │
role_permissions
        │
        ▼
role_definitions
        ▲
        │
role_assignments ──> profiles
        │
        └─ scope_type + scope_id
```

O assignment responde **quem tem qual role em qual scope**. A role resolve capabilities. O consumidor deve perguntar pela capability, evitando acoplamento a nomes de role.

`campaign_members` continua paralelo por compatibilidade. Ele não deve ganhar novas responsabilidades quando RBAC já modela a necessidade.

## DM tenure

`dm_tenures` torna explícito quem exerce função de DM e por quanto tempo, podendo referenciar um role assignment. Isso permite distinguir função narrativa de role técnica.

## Áudio e lineage

```text
recording_files
   ├─ audio_chunks
   │   ├─ speech_slices
   │   └─ transcript_segments
   └─ audio_artifacts
          ▲   │
          │   └─ parent_artifact_id (self relation)
          └─ audio_artifact_events
```

`audio_artifacts` é registry de lifecycle; `recording_files` é catálogo histórico/operacional de fonte. Durante modernização, evitar duplicar uma terceira identidade de arquivo.

## Jobs

```text
processing_jobs
 ├─ processing_job_steps
 ├─ ai_usage_ledger
 ├─ craig_manifests
 ├─ craig_track_extraction_steps
 ├─ audio_artifacts(created_by_job)
 └─ audio_artifact_events(job)
```

Lineage de job deve permitir explicar **qual execução produziu qual artefato/resultado**.

## API externa

```text
external_api_clients
        │ 1:N
        ▼
external_api_keys
```

Chave é credencial revogável/rotacionável do client, não identidade de usuário.

## Relações first-class entre entities

O grafo factual já possui schema próprio e permanece separado de `entity_mentions`.

```text
relation_types ───────────────┐
       │                      │
       ▼                      ▼
entity_relations ───> entities(source/target)
       │
       └── entity_relation_sources ───> canon_entries

world_relation_styles ───> relation_types
```

- `relation_types`: vocabulário por campanha, direção/simetria e família semântica;
- `entity_relations`: source/target, tipo, status, visibility, revision e overrides editoriais controlados;
- `entity_relation_sources`: provenance canônica explícita; ausência de source não deve ser inventada;
- `world_relation_styles`: apresentação visual separada do fato.

Menção/coocorrência continua não sendo relation. Conhecimento, rumor, mentira e segredo continuam conceitos diferentes e podem exigir boundary próprio.

## Publicação e edição do World

```text
world_graph_heads ── 1:N ──> world_graph_revisions
        │
        ├── revision factual atual
        │
world_edit_leases ── sessão exclusiva/efêmera
        │
world_edit_drafts ── checkpoint durável por editor/token

world_layout_snapshots ── composição visual/versionada
```

`world_edit_leases` impede writers concorrentes; não substitui persistência. `world_edit_drafts` preserva trabalho recuperável quando a lease expira ou a sessão é interrompida. `world_graph_revisions` é histórico de publicação factual; `world_layout_snapshots` é composição e não altera fatos narrativos.

## Mídia de entities

```text
entities ──> entity_media_bindings ──> media_assets ──> Media Storage bytes
```

O vínculo canônico usa asset UUID/role/focal point. PostgreSQL guarda identidade, integridade e estado de publicação; o object storage guarda bytes. URL/provider não é FK lógica permanente.

## Anti-patterns

- usar nome textual como FK lógica permanente;
- ligar NPC a profile artificial para reutilizar UI;
- criar entity para cada menção sem resolução/revisão;
- transformar `metadata` num grafo oculto;
- inferir relation pela coocorrência de duas entities;
- copiar `campaign_members.role` para novas regras em vez de capability;
- apagar provenance depois de consolidar resultado.
