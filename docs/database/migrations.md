# Migrations e evolução do schema

> Status: vigente
> Owner: dados/Supabase
> Última revisão: 2026-09-07
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

### 2026-09-07 — concorrência otimista do Edit

- `20260907084234 add_transcript_segment_revision`

## Boundary do reboot aplicado

As quatro migrations abaixo são mudanças explicitamente assumidas, versionadas e já observadas no histórico remoto do novo repositório TDA.

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

## Migration candidata — ainda não aplicada

### `20260907115300_edit_transcript_segment_atomic`

**Estado:** arquivo versionado na branch da issue #32; **não observado/aplicado no Supabase de produção** nesta preparação.

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
- sem migration history remoto pós-aplicação;
- somente `READ COMMITTED`.

Ainda pendente antes de produção:

- reconciliar/confirmar o SHA exato que será aplicado contra a `main` vigente;
- aplicar pelo database runbook no projeto canônico;
- revalidar função, grants e migration history remotamente;
- executar advisors de segurança/performance;
- registrar a aplicação no `verification-log.md`;
- integrar Auth/Edit em recorte próprio.

Rollback lógico:

- se ainda sem consumidor, remover/revogar a função em migration corretiva é reversível;
- se já houver consumidor, primeiro desligar o adapter canônico e restaurar o caminho anterior;
- não remover `transcript_segments.revision` e não apagar eventos de audit para simular rollback de edição.

### `20260907193000_import_transcript_result_atomic`

**Estado:** migration candidata deste slice; **não aplicada ao Supabase de produção**.

Objetivo:

- definir a capability `campaign.transcript.import` (`plane=mixed`) e associá-la ao role `local_operator`;
- criar `transcript_import_receipts` como commit marker imutável por `(campaign_id, source_system, source_session_id)`;
- criar `public.import_transcript_result_atomic(...)` como boundary server-only `SECURITY INVOKER`;
- aceitar somente sessão física preexistente cuja identidade corresponda a `campaign_id + session_id + local_companion + source_session_id`;
- recalcular os SHA-256 dos artifacts canônicos sobre os bytes UTF-8 exatos antes de qualquer persistência;
- serializar concorrência por lock da linha de `sessions`;
- revalidar `campaign.transcript.import` dentro da RPC para assignment ativo em `campaign/{slug}` ou `project/tda`;
- inserir apenas os campos allowlisted do shape legado `{id,speaker,track,start,end,text,words}`, sempre `pending`, `needs_review=true`, `revision=0`, sem inventar identidade estruturada;
- persistir segmentos + receipt na mesma transação;
- retornar `imported`, `replay`, `hash_conflict`, `legacy_unreceipted` ou `not_found` sem executar replace/upsert de transcript existente.

Compatibilidade e segurança:

- não cria nem altera `sessions`; reaproveita o índice existente `(campaign_id, source_system, source_session_id)`;
- não atualiza/deleta `transcript_segments`; sessão com segmentos e sem receipt falha fechada como `legacy_unreceipted`;
- `project/dnd-scribe` não autoriza o importer novo;
- receipt usa RLS e grant pretendido somente `SELECT + INSERT` para `service_role`; `PUBLIC`, `anon` e `authenticated` ficam sem acesso direto;
- RPC mantém `EXECUTE` somente para `service_role` e ainda exige actor/capability/scope no corpo;
- usa `extensions.digest`, cuja disponibilidade e `USAGE` pelo `service_role` foram confirmados read-only no projeto canônico;
- não altera a candidata `20260907115300_edit_transcript_segment_atomic` nem suas grants.

Validação preparada, ainda não executada por este registro:

- schema mínimo isolado: `supabase/tests/fixtures/transcript_import_atomic_minimal_schema.sql`;
- teste SQL transacional: `supabase/tests/import_transcript_result_atomic.sql`;
- runner real de duas conexões: `supabase/tests/import_transcript_result_atomic_concurrency.sh`;
- casos obrigatórios: permission matrix, mapping allowlisted, replay, hash conflict, legacy fail-closed, project/tda, legacy scope denied, cross-campaign, hash exato, rollback em falha do receipt, bloqueio real e cardinalidade final.

Coordenação antes de produção:

- validar a migration em PostgreSQL isolado e registrar SHA/versões/comandos/resultados;
- reconciliar com a `main` vigente e com a definição final de `campaign.transcript.import` do owner de Auth/capabilities;
- como `20260907115300_edit_transcript_segment_atomic` também permanece não aplicada no histórico remoto, não executar `db push`/lote sem serialização explícita das migrations pendentes;
- só depois seguir runbook, migration history, grants/RPC, advisors e `verification-log.md`.

Rollback lógico:

- antes de existir consumer/aplicação produtiva, remover a RPC/receipt/capability em migration corretiva é reversível;
- depois de receipts reais existirem, não apagar receipts/segmentos para simular rollback: desligar primeiro o consumer e restaurar compatibilidade;
- nunca converter `legacy_unreceipted` em adoção automática sem migration/contrato próprio.

Contrato detalhado: [`../features/transcript-import-sync.md`](../features/transcript-import-sync.md).

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
