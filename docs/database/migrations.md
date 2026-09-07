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
- versão/nome remoto e arquivo local devem corresponder;
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

## Boundary do reboot

As três migrations abaixo são as primeiras mudanças explicitamente assumidas e versionadas pelo novo repositório TDA:

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

Antes de qualquer grande etapa de banco, verificar migration history + schema real. O `database-audit.md` serve como fotografia datada, não como substituto dessa verificação.
