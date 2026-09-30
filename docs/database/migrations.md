# Migrations e evolução do schema

> Status: vigente
> Owner: dados/Supabase
> Última revisão: 2026-09-30
> Fonte: migration history do Supabase `dmrqnbdvbkfqzctcerbx`

## Princípio

O Supabase existente é produção e possui história anterior ao reboot. O repositório TDA **não deve fingir que criou migrations históricas que nasceram no `dnd-scribe`**.

A estratégia é:

- história remota anterior permanece no Supabase e legado;
- novas mudanças do reboot entram em `Faysk/tda/supabase/migrations`;
- versão/nome remoto e arquivo local devem corresponder após aplicação ou a divergência precisa ficar explicitamente documentada;
- migration candidata pode existir no repo antes da aplicação, mas precisa estar explicitamente marcada como não aplicada;
- migrations de transição preservam consumidores legados enquanto necessários;
- o procedimento operacional obrigatório está em `docs/operations/database-runbook.md`.

## Candidato — registry multi-campanha (#1123)

### `20260930113000_campaign_registry`

**Estado:** candidate SQL em `supabase/candidates`; **não autorizado nem aplicado no Supabase canônico**.

Objetivo:

- tornar explícito o registry operacional de N campanhas sem substituir `campaigns.id` como identidade relacional;
- preservar `yuhara-main` como slug técnico/compatibilidade da campanha histórica;
- introduzir `public_slug` como identidade pública evolutiva independente do slug técnico;
- introduzir lifecycle explícito `active | archived`;
- atualizar somente a apresentação da campanha histórica para `Crônicas da Mesa`;
- registrar `Antes que seja tarde` como segunda identidade de campanha sem criar sessões, entities, memberships, publicações ou canon narrativo.

Compatibilidade e isolamento:

- FKs existentes continuam apontando para o mesmo UUID de `yuhara-main`;
- o candidate é replay-safe para ensaio descartável;
- `source_session_id` deve poder se repetir em campanhas diferentes e permanecer qualificado por `campaign_id`;
- entity slugs continuam qualificados por campanha pelo contrato existente `(campaign_id, slug)`;
- nenhuma aplicação remota é autorizada pela existência deste candidate.

Validação planejada antes de promoção:

- PostgreSQL descartável com duas campanhas reais do registry e probes sintéticos;
- `supabase/tests/campaign_registry.sql` valida identidade, lifecycle, alias público, isolamento e repetição de `source_session_id` entre campanhas;
- replay do candidate deve manter os mesmos dois registros aprovados sem duplicação;
- executar guardrails do repositório, incluindo `pnpm db:docs:check`;
- somente depois do ensaio/revisão decidir se o candidate será promovido para `supabase/migrations` com timestamp/nome finais.

Rollback lógico:

- antes de qualquer consumidor novo, `public_slug`/`lifecycle_status` podem ser removidos por migration corretiva se a proposta for rejeitada;
- não renomear/apagar `yuhara-main` para simular rollback;
- não apagar dados narrativos existentes nem a segunda campanha após ela receber conteúdo real.

## Histórico remoto observado

### 2026-06-26 — canon, IA e áudio

- `20260626211159 canon_entries`
- `20260626211239 ai_cost_cache`
- `20260626214638 audio_speech_slices`
- `20260626215040 audio_work_units_absolute_times`
- `20260626215758 audio_chunks_updated_at`

### 2026-06-27 — processamento e acesso

- `20260627002400 exclude_silent_audio_work_units`
- `20260627125614 access_claims_model`
- `20260627131222 access_role_slug_rpc`
- `20260627133027 discord_notes_interactions`
- `20260627134245 table_notes_review_rpc`
- `20260627140124 harden_access_and_discord_rpc_grants`
- `20260627140209 revoke_direct_access_tables_for_rpc_only`
- `20260627140631 fix_table_notes_directory_source_session_parameter`
- `20260627143105 tighten_access_directory_visibility`

### 2026-06-28 — artifacts, jobs e Craig

- `20260628023337 audio_artifacts_retention`
- `20260628023549 audio_artifact_reclassify`
- `20260628110227 processing_job_steps`
- `20260628110807 craig_manifest_contract`
- `20260628111006 craig_manifest_temporal_quality`
- `20260628112021 craig_track_extraction_steps`
- `20260628112729 audio_cleanup_readiness`
- `20260628113102 audio_cleanup_success_policy`

### 2026-07-26 — API pública e permissões de site

- `20260726211900 secure_public_data_api`
- `20260726222922 site_feature_permissions`
- `20260726224036 seed_site_feature_access`

### 2026-08-01 — companion

- `20260801143158 companion_distribution_permissions`
- `20260801150510 remove_local_publisher_permission`

### 2026-08-13 — Ordo

- `20260813160644 ordo_access_control`
- `20260813160736 optimize_ordo_access_rls`

### 2026-08-16 — summary API

- `20260816200927 summary_api_v1`

### 2026-09-06 — transcript permission e início das migrations do reboot

- `20260906000203 transcript_view_permission`
- `20260906210333 align_tda_domain_identity`
- `20260906210427 backfill_narrative_entity_links`
- `20260906211040 relax_reboot_entity_name_lookup`

### 2026-09-07/08 — concorrência otimista do Edit e review de transcrição

- `20260907084234 add_transcript_segment_revision`
- `20260908064257 edit_transcript_segment_atomic`
- `20260908144711 transcript_review_default`

### 2026-09-08 — persistência editorial do World Explorer

- `20260908203249 world_layout_capability`
- `20260908203331 world_layout_snapshot_atomic`
- `20260908203441 world_layout_service_role_privileges`
- `20260908203642 world_layout_site_editor_grant`

### 2026-09-09 — lease exclusivo do World Explorer

- `20260909205836 world_edit_lease` — migration aplicada remotamente; arquivo local equivalente preservado como `20260909173000_world_edit_lease.sql` até reconciliação nominal deliberada.

### 2026-09-10 — autoria factual do World Explorer

- `20260910002529 world_graph_authoring` — migration aplicada remotamente; arquivo local equivalente permanece `20260909215000_world_graph_authoring.sql`. Não reexecutar DDL para alinhar somente o número.
- `20260910012546 world_graph_provenance_guard` — hardening aplicado remotamente; arquivo local equivalente `20260910005000_world_graph_provenance_guard.sql`. Não reexecutar DDL apenas para alinhar o timestamp.

### 2026-09-15 — contrato editorial da transcrição

- `20260915211245 transcript_review_contract_comments` — migration COMMENT-only aplicada remotamente; arquivo local equivalente `20260915211000_transcript_review_contract_comments.sql`. Não reexecutar DDL nem editar migration history apenas para alinhar o timestamp.

## Boundary do reboot aplicado

As migrations abaixo são mudanças explicitamente assumidas, versionadas e observadas no histórico remoto do novo repositório TDA.

### `20260906210333_align_tda_domain_identity`

Objetivos:

- introduzir `project/tda` como scope técnico canônico;
- preservar `project/dnd-scribe` como compatibilidade;
- ligar `profile_characters` a `entities`;
- criar entities PC a partir dos três PCs conhecidos sem inventar canon.

### `20260906210427_backfill_narrative_entity_links`

Objetivos:

- ligar participações históricas de Astel, Dandelion e Screacky às entities canônicas;
- preservar `profile_id` nulo quando o dado humano histórico não existe;
- adicionar índices para os caminhos narrativos novos.

Resultado validado: 12/12 participações desses PCs ligadas à entity correta.

### `20260906211040_relax_reboot_entity_name_lookup`

Objetivo:

- remover uma restrição adicional case-insensitive introduzida no reboot;
- preservar a constraint histórica `(campaign_id, name)` porque o consolidator legado usa `ON CONFLICT (campaign_id, name)`;
- manter índice de busca por lower(name) sem tornar a situação mais restritiva.

### `20260907084234_add_transcript_segment_revision`

Objetivo:

- adicionar `transcript_segments.revision bigint not null default 0`;
- criar o contador monotônico necessário para optimistic concurrency do Edit sem alterar o comportamento dos consumidores atuais;
- preparar, sem ainda introduzir RPC/grants, o boundary transacional de update + audit da issue #32.

Validação pós-migration registrada: 30.857 segmentos preservados, zero `revision` nula e intervalo inicial `0..0`.

## Migration history reconciliado em 2026-09-08

A reconciliação de `transcript_review_default` alinhou o arquivo local ao ID remoto `20260908144711`. A persistência do World Explorer foi reconciliada com os quatro IDs efetivamente registrados no remoto. Nesta rodada, `edit_transcript_segment_atomic` também foi alinhada ao ID remoto `20260908064257` após comparação read-only do `statements` preservado em `supabase_migrations.schema_migrations` com o SQL local. Nenhum DDL foi reexecutado e nenhuma linha do migration history foi editada.

## Mutation atômica do Edit aplicada e reconciliada

### `20260908064257_edit_transcript_segment_atomic`

**Estado:** aplicada no Supabase canônico e reconciliada com o migration history remoto. O SQL versionado permanece equivalente ao changeset originalmente mantido localmente como `20260907115300_edit_transcript_segment_atomic.sql`; a mudança deste recorte alinha somente o filename/ID local, sem reexecutar DDL.

Objetivo:

- criar `public.edit_transcript_segment_atomic(...)` como boundary server-only `SECURITY INVOKER`;
- revalidar `segment -> session -> campaign` pelo slug antes de qualquer write;
- fazer optimistic concurrency por `expectedRevision` com lock da linha e incremento exato `+1`;
- persistir estado editorial e um único evento `audit_log` na mesma transação;
- preservar `character_name` quando o speaker não muda e invalidá-lo apenas quando o speaker muda;
- retornar `updated`, `conflict` ou `not_found` sem revelar recurso cross-campaign;
- manter `EXECUTE` somente para `service_role`, sem abrir `anon`/`authenticated`.

Compatibilidade:

- nenhuma coluna existente é removida/renomeada;
- nenhuma das 8 funções `SECURITY DEFINER` existentes é alterada neste slice;
- o adapter temporário do Edit permanece independente até o binding canônico;
- a função nova não substitui Auth/RBAC: actor/capability continuam resolvidos no boundary autorizado da aplicação.

Validação isolada concluída em 2026-09-07:

- SHA validado: `f44a74c653d416a614bb3468ffc112d741bc4893`;
- PostgreSQL 16.14 real em cluster descartável novo, sem TCP nem conexão remota;
- migration de `revision` + migration candidata originais aplicadas sobre schema mínimo sintético;
- `supabase/tests/edit_transcript_segment_atomic.sql` integral passou e terminou em `ROLLBACK`;
- concorrência real com duas conexões `service_role` passou 3/3 sob `READ COMMITTED`: uma conexão ficou bloqueada no lock da outra, depois houve exatamente `updated/1` + `conflict/NULL`, revision final `1` e um único audit `0 -> 1`;
- `anon`, `authenticated` e role sem acesso tiveram chamada direta negada;
- cross-campaign retornou `not_found` sem audit;
- identidade foi preservada quando speaker não mudou e `character_name` foi limpo quando mudou;
- falha de audit por trigger e por FK de ator inválido reverteu a linha inteira;
- nenhum bug SQL foi reproduzido; a branch/migration não foi alterada durante o ensaio.

Limites da validação isolada:

- schema de teste mínimo, não dump completo do Supabase;
- sem Auth/PostgREST real;
- sem advisors do projeto canônico;
- somente `READ COMMITTED`.

Ainda pendente:

- registrar smoke real do caminho canônico do Edit em release deliberada;
- remover `unsafe-mutation.ts` e `TDA_EDIT_UNSAFE` somente após esse smoke, em recorte separado.

Rollback lógico:

- se ainda sem consumidor, remover/revogar a função em migration corretiva é reversível;
- se já houver consumidor, primeiro desligar o adapter canônico e restaurar o caminho anterior;
- não remover `transcript_segments.revision` e não apagar eventos de audit para simular rollback de edição.

### `20260908144711_transcript_review_default`

**Estado:** aplicada no Supabase canônico em 2026-09-08. O SQL é idêntico ao da candidata originalmente versionada como `20260908134500_transcript_review_default.sql`; esta reconciliação alinha somente o ID local ao migration history remoto, sem reexecutar DDL.

Objetivo:

- alinhar o default físico de `public.transcript_segments.needs_review` para `true`;
- manter coerência com o default existente `review_status = 'pending'` e com o invariante atual do Edit/import;
- impedir que novos writers que omitam `needs_review` fabriquem novos registros `pending/false`.

Compatibilidade e limites:

- não altera linhas históricas;
- não executa backfill;
- não adiciona CHECK constraint enquanto a massa histórica inconsistente não for reconciliada;
- writers que persistem `needs_review` explicitamente continuam com o mesmo comportamento.

Validação:

- o PostgreSQL sintético do job `transcript-import-postgres` aplica a migration e executa `supabase/tests/transcript_review_default.sql`;
- o assert falha se `information_schema.columns.column_default` para `needs_review` não for `true`;
- no Supabase canônico, o default foi confirmado como `true` e as contagens históricas permaneceram `pending/false=30.839`, `pending/true=17`, `needs_review/true=1` após a aplicação.

Rollback lógico:

- antes de qualquer dependência nova do default, uma migration corretiva pode restaurar o default anterior;
- não apagar nem reclassificar linhas históricas como forma de rollback.

### `20260915211000_transcript_review_contract_comments`

**Estado:** aplicada no Supabase canônico em 2026-09-15 sob o migration history remoto `20260915211245 transcript_review_contract_comments`. O arquivo local preserva o ID versionado pela PR #368; a divergência de timestamp é nominal e não autoriza reexecutar DDL nem editar migration history.

Objetivo:

- documentar no próprio schema físico que `review_status` é a fonte canônica do estado editorial para leitura;
- documentar `needs_review` como projeção de compatibilidade para novas escritas (`pending`/`needs_review` => `true`; `approved`/`discarded` => `false`);
- tornar explícito que linhas históricas podem divergir dessa projeção e não devem ser reinterpretadas a partir da flag legada.

Compatibilidade e limites:

- executa somente `COMMENT ON COLUMN`;
- não altera defaults, dados, grants, RLS, funções, constraints ou triggers;
- não executa backfill e preserva deliberadamente os 30.839 registros históricos `pending/false` observados antes da aplicação;
- não ativa o transcript-sync de produção nem muda os writers existentes.

Validação:

- read-back confirmou `review_status DEFAULT 'pending'::text` e `needs_review DEFAULT true`;
- os comentários físicos de `review_status` e `needs_review` correspondem exatamente ao SQL versionado;
- a distribuição permaneceu `30.857` segmentos no total, com `pending/false=30.839`, `pending/true=17`, `needs_review/true=1`, `approved/false=0` e `discarded/false=0`;
- o PostgreSQL sintético aplica a migration e `supabase/tests/transcript_review_default.sql` valida default e comentários;
- `src/features/transcript-sync/database.test.ts` continua provando novos imports como `review_status='pending'` + `needs_review=true`;
- advisors de segurança/performance foram reexecutados após a aplicação sem classe nova atribuível à migration COMMENT-only.

Rollback lógico:

- comentário incorreto pode ser substituído por migration corretiva posterior sem mutação de dados;
- não remover/reclassificar registros históricos para simular rollback documental.

## Persistência editorial aplicada do World Explorer

A aplicação remota ocorreu em quatro recortes e foi reconciliada com os arquivos locais sem reexecutar DDL. O migration history remoto preserva o SQL integral de cada entrada, o que permitiu comparar os statements efetivamente executados com os candidatos versionados.

### `20260908203249_world_layout_capability`

**Estado:** aplicada no Supabase canônico. O statement remoto é equivalente ao candidato originalmente versionado como `20260908192500_world_layout_capability.sql`.

Objetivo:

- definir `campaign.world.layout.edit` no `permission_catalog` com plane `narrative`;
- não criar assignment de usuário/perfil;
- preparar uma autorização separada de `campaign.content.edit` para a mutation física de layout.

### `20260908203331_world_layout_snapshot_atomic`

**Estado:** aplicada no Supabase canônico. O statement remoto é equivalente ao candidato originalmente versionado como `20260908192600_world_layout_snapshot_atomic.sql`.

Objetivo:

- criar `world_layout_snapshots`, separado de entities/relations/canon;
- manter um snapshot `overview` por campaign com `schema_version`, `revision`, `positions`, actor e timestamps;
- habilitar RLS sem policy de browser;
- criar `save_world_layout_snapshot_atomic(...)` como `SECURITY INVOKER` server-only;
- revalidar identidade, capability, assignment ativo e scope;
- validar payload/limites defensivos;
- aplicar optimistic concurrency por `expected_revision`;
- registrar `world_layout.update` no `audit_log` na mesma transação;
- retornar `unchanged` sem bump de revision/audit quando o snapshot não muda.

### `20260908203441_world_layout_service_role_privileges`

**Estado:** aplicada no Supabase canônico e agora versionada no repo.

Objetivo:

- neutralizar default privileges mais amplos observados no ambiente Supabase;
- revogar todos os privilégios de tabela de `service_role` e reabrir somente `SELECT`, `INSERT` e `UPDATE`;
- manter `DELETE` indisponível para o boundary de snapshot.

### `20260908203642_world_layout_site_editor_grant`

**Estado:** aplicada no Supabase canônico e agora versionada no repo.

Objetivo:

- conceder `campaign.world.layout.edit` ao role narrativo existente `site_editor`;
- preservar assignments existentes;
- não criar grant direto para usuário/profile e não ampliar `campaign.content.edit`.

Validação reconciliada:

- `world_layout_snapshots` existe e permaneceu com `0` snapshots durante a auditoria;
- RLS está habilitado e não há policy de browser;
- `service_role` possui `SELECT/INSERT/UPDATE`, sem `DELETE`;
- `save_world_layout_snapshot_atomic(...)` permanece `SECURITY INVOKER`, com `EXECUTE` apenas para `postgres` e `service_role` entre os roles relevantes;
- a capability existe em `permission_catalog` e está ligada ao `site_editor`;
- `tools/world-layout-db.py` aplica os quatro arquivos reconciliados em PostgreSQL 16 sintético e testa grant, ausência de assignment automático, autorização/scope, payload, revision/conflict/no-op e rollback em falha do audit.

Contrato arquitetural: [ADR-0011](../adr/0011-world-explorer-layout-physical-persistence.md).

## Rollout preparado — publicação versionada de transcrições

### `20260922133000_transcript_publication_revisions`

**Estado:** migration versionada e validada em PostgreSQL 16 sintético; **ainda não aplicada no Supabase canônico** neste changeset.

Objetivo:

- persistir revisões completas e imutáveis de transcrição por sessão;
- manter um ponteiro `sessions.current_transcript_revision_id` para a revisão editorial atualmente publicada;
- registrar receipts idempotentes de publicação e eventos leves de publish/replace/restore/unpublish;
- expor as mutations somente por RPCs `SECURITY INVOKER` com `EXECUTE` de browser revogado;
- definir `campaign.transcript.publish` e concedê-la somente ao role narrativo existente `site_editor`, sem criar ou ampliar assignment de usuário/perfil.

Segurança e escopo:

- `transcript_revisions`, `transcript_publication_receipts` e `transcript_publication_events` têm RLS habilitado;
- `anon` e `authenticated` não recebem acesso direto nem EXECUTE nas RPCs;
- autorização é resolvida por profile + assignment ativo + capability + scope da campaign antes de revelar existência do alvo;
- o grant novo reutiliza o role `site_editor` já existente e preserva seus scopes/assignments atuais;
- publicação não altera o transcript operacional bruto; cria uma revisão editorial imutável e move somente o ponteiro corrente.

Validação antes do rollout remoto:

- `tools/transcript-sync-db.py` aplica a migration versionada no scratch PostgreSQL, em vez de testar somente o candidate histórico;
- `supabase/tests/transcript_publication_revisions.sql` cobre deny-by-default, ausência de oracle cross-campaign, publish inicial, retry/read-back idempotente, conflito por operation id divergente, replace preservando histórico, rollback transacional, restore e unpublish;
- o fixture RBAC prova que `site_editor` recebe `campaign.transcript.publish` e que a migration não cria qualquer `role_assignment`;
- o candidate histórico `supabase/candidates/20260921021000_transcript_publication_revisions.sql` permanece preservado como evidência de revisão e não é renomeado para simular migration nova.

Rollout:

- aplicar somente pelo gate normal de Production, com migration history/read-back e advisors após aplicação;
- manter `TDA_TRANSCRIPT_PUBLICATION_ENABLED=false` até schema, grants e RPCs remotos estarem confirmados;
- ativar runtime somente depois do smoke controlado de publicação/retry/restore em sessão autorizada;
- rollback lógico após ativação começa desligando a flag; não apagar revisões/receipts para simular rollback.

## Hardening pós-rollout — publicação de transcrições

### `20260922151000_transcript_publication_hardening`

**Estado:** migration de hardening preparada após a verificação remota da primeira aplicação.

Motivação observada em Production após `20260922133000_transcript_publication_revisions`:

- browser roles permaneceram sem acesso e as RPCs ficaram `SECURITY INVOKER`, como previsto;
- o role `service_role`, porém, herdou privilégios `UPDATE/DELETE` nas três tabelas de evidência imutável apesar do contrato da migration conceder apenas `SELECT/INSERT`;
- o advisor de performance passou de 58 para 67 FKs sem índice, com exatamente nove novos findings pertencentes ao schema de publicação.

Esta migration:

- revoga todos os privilégios diretos do `service_role` em `transcript_revisions`, `transcript_publication_receipts` e `transcript_publication_events`;
- reabre somente `SELECT, INSERT` nesses três objetos;
- adiciona os nove índices de cobertura apontados pelo advisor, incluindo o ponteiro corrente em `sessions`;
- não altera capability, assignment, conteúdo publicado, current pointer nem feature flag.

O scratch PostgreSQL aplica esta migration antes do contrato de publicação e falha se `service_role` recuperar `UPDATE/DELETE` ou se qualquer índice esperado desaparecer.

## Candidato — biblioteca compartilhada Lembra

### `20260921190000_lembra_shared_library`

**Estado:** migration versionada no repositório; **ainda não aplicada no Supabase canônico**.

Objetivo:

- persistir a biblioteca global `/lembra` compartilhada entre todos os usuários autenticados;
- criar `lembra_references` para metadata verificada de mídia, autoria e soft-retire;
- criar `lembra_favorites` como preferência pessoal por usuário;
- manter bytes fora do PostgreSQL, em Media Storage privado;
- não introduzir `campaign_id`, role nova ou capability específica.

Segurança:

- RLS habilitado nas duas tabelas;
- `anon` e `authenticated` não recebem acesso direto;
- o browser opera somente pelo boundary server-side após sessão Supabase Auth verificada;
- `service_role` recebe CRUD apenas porque o boundary da aplicação precisa materializar/listar/editar/retirar referências e favoritos;
- autoria usa o `auth user id` verificado e um snapshot de nome resolvido pelo servidor; o browser não envia autor.

Integridade:

- objeto canônico deve corresponder exatamente a `lembra/{reference-id}/{sha256}.{ext}`;
- somente JPEG/PNG/WebP;
- tamanho físico entre 24 bytes e 12 MiB;
- dimensões entre 1 e 20.000 px;
- item ativo exige `read_back_verified=true`;
- soft-retire exige `retired_at` e item ativo exige `retired_at is null`.

Validação sintética:

- `tools/lembra-db.py` sobe PostgreSQL 16 descartável sem TCP;
- aplica somente a migration do Lembra sobre roles sintéticos mínimos;
- `supabase/tests/lembra_shared_library.sql` verifica grants deny-by-default, insert válido, favorito, object key inválido e soft-retire;
- recibo esperado: `LEMBRA_SHARED_DATABASE_OK synthetic=true migration=true remote_mutation=false`.

Rollout:

- manter `TDA_LEMBRA_ENABLED=false` até migration e R2 private estarem prontos;
- aplicar pelo runbook no projeto canônico;
- depois confirmar schema/grants/read-only, habilitar runtime e executar smoke autenticado;
- nenhuma aplicação remota é autorizada apenas pela existência deste arquivo.

Rollback lógico:

- antes da ativação, uma migration corretiva pode remover as tabelas sem consumidor;
- depois da ativação, desligar primeiro `TDA_LEMBRA_ENABLED`, preservar metadata/objetos e só então preparar correção;
- não apagar objetos ou rows compartilhados para simular rollback.

## Regras para migration nova

### Deve

- possuir objetivo único ou coeso;
- existir como arquivo versionado antes da aplicação deliberada em produção;
- ser idempotente quando razoável, especialmente backfills/índices condicionais;
- preservar produção;
- ter nome descritivo em snake_case;
- evitar dependência de UUID gerado em outro ambiente;
- explicar compatibilidade e rollback lógico;
- ser adicionada a este documento quando passa a fazer parte do reboot;
- atualizar documentação de contrato quando altera schema, autorização ou comportamento.

### Não deve

- resetar produção;
- apagar dados narrativos para "limpar" ambiente;
- promover candidato para canon sem revisão;
- renomear provenance só por branding;
- derrubar scope/grant/tabela legado sem consumidor mapeado;
- embutir secret;
- fazer grande refactor de schema + grande backfill + mudança de auth numa migration opaca.

## Processo recomendado

```text
1. documentar contrato/feature e invariantes
2. inspecionar schema real + consumidores
3. criar migration pequena e versionada
4. revisar impacto de RLS/grants/indexes e recuperação
5. validar o repositório/CI
6. aplicar de forma controlada no projeto correto
7. validar invariantes com SQL read-only
8. confirmar migration history remoto
9. rodar advisors quando aplicável
10. atualizar catálogo/auditoria/docs
11. registrar a verificação em verification-log.md
```

## Guardrail automático

`pnpm check` executa `pnpm db:docs:check`, implementado em `tools/check-database-governance.mjs`.

O check garante pelo menos que:

- os documentos obrigatórios de governança do banco existem;
- o índice do banco aponta para runbook, inventário de RPCs e log de verificações;
- os documentos centrais identificam o project ref canônico;
- `AGENTS.md` exige consulta ao runbook antes de mudanças de banco;
- **todo arquivo `.sql` em `supabase/migrations` aparece neste documento**.

Assim, uma migration nova do reboot sem registro documental quebra o CI em vez de virar dívida silenciosa.

O check é guardrail de documentação; ele **não substitui** inspeção do migration history remoto, advisors ou validação do schema real.

## Validação pós-migration

Dependendo da mudança:

- contagem antes/depois;
- valores nulos inesperados;
- FK/constraint/index existentes;
- duplicatas;
- RLS/policies/grants;
- advisors de segurança/performance;
- consumidores legados ainda funcionam;
- nenhum dado canônico foi criado sem aprovação;
- migration history remoto corresponde ao arquivo ou a divergência nominal está documentada sem reexecutar DDL.

## Rollback

Preferir migrations reversíveis conceitualmente, mas produção com dados reais nem sempre pode simplesmente executar `DOWN`.

Classificar rollback:

- **DDL reversível**: remover índice/coluna nova ainda não usada;
- **compatibilidade**: manter coluna/alias antigo enquanto novo caminho estabiliza;
- **data backfill**: registrar como identificar linhas alteradas antes de desfazer;
- **irreversível por perda de dado**: evitar; exige estratégia real de backup/restore e aceite explícito antes da aplicação.

## Drift

Há drift quando:

- Supabase possui DDL que o repo não conhece;
- repo possui migration que produção não aplicou;
- nomes/versões divergem;
- schema foi alterado manualmente.

Drift deve ser investigado, não mascarado por `migration repair` ou reset de Production.
