# Migrations e evolução do schema

> Status: vigente
> Owner: dados/Supabase
> Última revisão: 2026-09-09
> Fonte: migration history do Supabase `dmrqnbdvbkfqzctcerbx`

## Princípio

O Supabase existente é produção e possui história anterior ao reboot. O repositório TDA **não deve fingir que criou migrations históricas que nasceram no `dnd-scribe`**.

A estratégia é:

- história remota anterior permanece no Supabase e legado;
- novas mudanças do reboot entram em `Faysk/tda/supabase/migrations`;
- versão/nome remoto e arquivo local devem corresponder após aplicação;
- migration candidata pode existir no repo antes da aplicação, mas precisa estar explicitamente marcada como não aplicada;
- migrations de transição preservam consumidores legados enquanto necessários;
- o procedimento operacional obrigatório está em `docs/operations/database-runbook.md`.

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
- migration history remoto corresponde ao arquivo.

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
- versão/nome não corresponde;
- documentação descreve constraint/coluna inexistente.

Uma migration explicitamente marcada como **candidata/não aplicada** não é drift por si só. Ela vira drift se for tratada como aplicada sem aparecer no histórico remoto ou se produção receber a mudança sem o arquivo correspondente.

Antes de qualquer grande etapa de banco, verificar migration history + schema real. O `database-audit.md` serve como fotografia datada, não como substituto dessa verificação.

## Candidatos de importação de transcrição

- `20260907193704_transcript_import_capability`: define campaign.transcript.import (mixed), sem grants de roles/operadores.
- `20260907193705_transcript_import_atomic`: recibo durável e consumer transacional service-only; revisado pelo owner SQL e validado em PostgreSQL scratch com concorrência real, **não aplicado em produção**.

Contrato, testes sintéticos e rollback: [importação local](../integrations/transcript-import.md).

## Candidato de sessão exclusiva de edição do World Explorer

### `20260909173000_world_edit_lease`

**Estado:** migration candidata versionada nesta implementação; **não aplicada no Supabase canônico**.

Objetivo:

- permitir que o mesmo `/mundo` alterne entre exploração e edição editorial de layout sem criar um segundo editor concorrente;
- garantir no banco apenas uma sessão ativa de edição de layout por campanha;
- manter posições em rascunho server-side e invisíveis à projection pública até publicação explícita;
- renovar a sessão por lease com expiração, evitando lock permanente quando aba, navegador ou conexão desaparecem;
- publicar chamando o boundary já aplicado `save_world_layout_snapshot_atomic(...)`, preservando optimistic concurrency e `audit_log` existentes;
- permitir descarte do rascunho sem tocar no snapshot publicado.

Segurança e compatibilidade:

- reutiliza exclusivamente `campaign.world.layout.edit`; não amplia `campaign.content.edit` e não autoriza CRUD factual de entities/relations;
- tabela `world_edit_leases` fica com RLS habilitado, sem grants para `anon`/`authenticated`;
- RPCs são `SECURITY INVOKER` e executáveis por `service_role`, com revalidação interna de identidade, capability, assignment ativo e scope;
- token de lease identifica a sessão/aba editorial, não usuário nem segredo de autorização;
- draft contém somente coordenadas de nodes já autorizados pelo contrato do layout; canon, relations, visibility e conhecimento não entram no payload;
- nenhuma alteração de relations, entities, canon ou publication é feita por esta migration.

Concorrência e recuperação:

- lease ativo de outra sessão retorna `busy` em vez de roubar o lock;
- lease expirado pode ser recuperado pelo mesmo editor com o draft preservado;
- novo editor após expiração inicia do snapshot publicado vigente;
- conflito de `revision` preserva o draft e bloqueia publicação silenciosa sobre versão mais nova.

Validação ainda necessária antes de aplicação remota:

- `pnpm check`, build e Playwright do SHA final;
- ensaio PostgreSQL descartável dos cinco RPCs, incluindo duas sessões concorrentes, expiração/recovery, payload inválido, capability/scope e rollback de publish;
- revisão dos grants/RLS e comparação com o migration history somente depois de eventual aplicação deliberada.

Rollback lógico:

- antes da ativação do consumidor, remover os RPCs e `world_edit_leases` em migration corretiva é reversível;
- após ativação, primeiro desligar o toggle/boundary no app, deixar leases expirarem e então remover a infraestrutura em migration corretiva;
- nunca apagar `world_layout_snapshots` ou `audit_log` para desfazer esta feature.

## Candidato de estabilização de aliases narrativos

### `20260908231000_backfill_screacky_historical_alias`

**Estado:** migration candidata versionada; **não aplicada no Supabase canônico**.

Objetivo:

- preservar `Screacky` como `name`/slug vigente da entity PC existente;
- adicionar `Screaky` somente como alias histórico para resolução/busca;
- não alterar `entity_type`, visibility, canon, relações ou qualquer conteúdo narrativo.

Matching e segurança:

- restringe o alvo à campanha `yuhara-main`, `slug='screacky'` e `entity_type='pc'`;
- falha se o alvo não resolver para exatamente uma entity;
- só faz `array_append` quando o alias ainda não existe, tornando o backfill idempotente;
- não contém UUID de produção nem texto de transcrição.

Validação pré-aplicação:

- inspeção read-only confirmou exatamente um alvo, `name=Screacky`, `visibility=private_players` e aliases vazio;
- a expressão candidata projeta somente a adição de um alias, sem mudança de audience;
- nenhuma escrita foi executada no Supabase durante a estabilização #102.

Rollback lógico:

- antes de existir consumidor dependente do alias, uma migration corretiva pode remover apenas o valor `Screaky` do array dessa entity;
- não renomear `name`/slug nem apagar a entity para simular rollback.