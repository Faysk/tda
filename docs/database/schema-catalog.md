# Catálogo do schema Supabase

> Status: implementado + candidates documentados separadamente
> Owner: dados/Supabase
> Última revisão da fotografia remota: 2026-09-06
> Última revisão de candidates: 2026-09-30
> Fonte observada: `public` no projeto `dmrqnbdvbkfqzctcerbx`

Este catálogo descreve as **43 tabelas públicas observadas**. Contagens são uma fotografia da revisão e não um contrato. RLS estava habilitado em todas elas.

**Importante:** valores marcados como observados/Production abaixo não são reescritos para refletir migrations candidatas ainda não aplicadas. Candidates são documentados separadamente para que o catálogo não confunda intenção validada localmente com estado remoto comprovado.

Para regras conceituais, consultar [modelo de dados](../data-model.md). Para segurança, consultar [security.md](security.md).

## Resumo observado em Production (2026-09-06)

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

## `campaigns` — estado observado

**Propósito:** raiz de isolamento narrativo. Na fotografia remota de 2026-09-06 continha uma campanha, `yuhara-main`.

Campos observados:

- `id uuid` PK;
- `name text`;
- `slug text unique` — identidade técnica/canônica existente;
- `description text?`;
- `metadata jsonb` — extensão, não contrato central;
- timestamps.

É referenciada por sessions, memberships, entities, canon, RBAC relacionado, auditoria e integrações. Uma feature multi-campanha deve sempre respeitar `campaign_id`; não assumir eternamente que só existe uma campanha.

### Candidate #1123 — campaign registry (não aplicado remotamente)

O candidate `supabase/candidates/20260930113000_campaign_registry.sql` foi validado em PostgreSQL 16 descartável, inclusive replay/idempotência, sem mutação remota. Enquanto não houver promoção/aplicação deliberada e read-back do Supabase, esta seção descreve **contrato candidate**, não schema observado em Production.

Mudanças propostas em `campaigns`:

- `lifecycle_status text not null default 'active'` com domínio `active | archived`;
- `public_slug text` como identidade pública/rota separada do slug técnico;
- unicidade de `public_slug` quando preenchido;
- preservação de `slug` e `id` da campanha histórica `yuhara-main`;
- registro idempotente da segunda campanha `antes-que-seja-tarde` sem criar sessões, entities, memberships ou canon;
- backfill determinístico de `public_slug` para campanhas existentes e invariantes que impedem ambiguidade entre identidade técnica e pública.

Contrato de identidade do candidate:

- `id` = autoridade relacional/FKs;
- `slug` = identidade técnica/compatibilidade;
- `public_slug` = identidade pública/rota, nunca scope de autorização;
- `name` = apresentação editorial;
- `lifecycle_status` = lifecycle operacional do registro.

Após eventual aplicação remota, esta seção só deve ser promovida a estado observado depois de read-back verificável e atualização da fotografia/verification log; não inferir sucesso apenas porque o SQL candidate passou localmente.

## `profiles`
