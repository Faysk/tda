# Log de verificações do banco de produção

> Status: vigente / append-only por intenção
> Owner: dados/Supabase
> Projeto canônico: `dmrqnbdvbkfqzctcerbx`

Este documento registra verificações pontuais do estado real do Supabase. Ele complementa `database-audit.md`: a auditoria descreve uma fotografia mais ampla; este log registra revalidações operacionais menores e frequentes.

Entradas novas devem ser adicionadas no topo, preservando as anteriores.

---

## 2026-09-19 — publish autoritativo de relações do World (#401)

### Escopo

Verificação pós-release da correção que faz o draft protegido pelo lease exclusivo prevalecer quando uma edição explícita substitui uma relação semanticamente equivalente, sem hard delete da relação anterior.

### Aplicação

- PR: #401;
- merge em `main`: `b5a72440b08d666b8df915acdd86265699bb3d32`;
- release canônico observado: `prod-b5a72440b08d`;
- migration aplicada: `20260919162000 world_graph_authoritative_relation_reconcile`;
- projeto: `dmrqnbdvbkfqzctcerbx`.

### Invariantes verificadas

Read-back pós-migration confirmou:

- migration history contém `20260919162000 world_graph_authoritative_relation_reconcile`;
- `publish_world_edit_state_atomic(uuid,uuid,text,uuid)` contém o marker da reconciliação autoritativa;
- `anon` não possui `EXECUTE`;
- `authenticated` não possui `EXECUTE`;
- `service_role` mantém `EXECUTE`;
- assinatura e boundary server-only foram preservados;
- CI passou pelo contrato PostgreSQL sintético que força uma relação substituta ativa a aparecer antes da predecessora arquivada no JSON e exige exatamente uma relação ativa ao final;
- Production CD aplicou/verificou a migration, executou smoke no artefato staged, promoveu e verificou o domínio canônico;
- `/api/version` canônico respondeu o merge `b5a72440b08d666b8df915acdd86265699bb3d32`.

### Advisors

Advisors de segurança e performance foram executados após a aplicação.

Permanecem classes de findings já conhecidas — incluindo tabelas com RLS sem policy explícita no modelo deny-by-default, alguns `SECURITY DEFINER` autenticados legados e FKs/índices apontados pelo advisor de performance. Esta migration não criou tabela, FK, policy, índice ou nova função exposta; nenhum finding relacionado exigiu ação adicional neste recorte.

### Divergências e decisão

Nenhum drift foi observado para esta migration ou para o grant da RPC alterada. Os findings preexistentes dos advisors não foram modificados cosmeticamente, seguindo o runbook.

### Estado final

Correção aplicada e verificada em produção. O publisher agora usa lease exclusivo + graph revision como serialização e preserva relações substituídas como histórico não ativo, em vez de rejeitar uma edição válida por estado físico intermediário.

---

## 2026-09-15 — contrato canônico de review de transcrição (#73)

### Escopo

Aplicação controlada e read-back da migration que formaliza no schema físico a semântica já adotada pelo TDA: `review_status` é a fonte canônica do estado editorial para leitura e `needs_review` permanece somente como projeção de compatibilidade para novas escritas. Os dados históricos foram preservados deliberadamente.

### Aplicação

A PR #368 foi integrada na `main` pelo merge `ec70d65920ec3be61c8389b501e728420ee845d2` após `required-ci` verde no head exato `45f8c187cff11b7c0ab32ce85f83597cd537f94d`.

O SQL versionado como:

- `20260915211000_transcript_review_contract_comments.sql`

foi aplicado pelo mecanismo de migration do Supabase canônico. O migration history remoto registrou:

- `20260915211245 transcript_review_contract_comments`.

A divergência de timestamp é nominal. Não reexecutar o DDL nem editar `supabase_migrations.schema_migrations` apenas para alinhar o número; o arquivo local e o ID remoto ficam documentados como o mesmo changeset.

### Verificação pós-aplicação

Read-back físico confirmou:

- `review_status DEFAULT 'pending'::text`;
- `needs_review DEFAULT true`;
- comentário de `review_status`: `Canonical editorial review state and application source of truth. Historical needs_review values may not match it.`;
- comentário de `needs_review`: `Legacy compatibility projection for new writes: true for review_status pending/needs_review and false for approved/discarded. Historical rows are preserved and may differ; do not use as canonical read state.`.

A distribuição permaneceu exatamente:

- total: `30.857` segmentos;
- `pending/false`: `30.839`;
- `pending/true`: `17`;
- `needs_review/true`: `1`;
- `approved/false`: `0`;
- `discarded/false`: `0`.

Nenhum `UPDATE`, backfill, CHECK, trigger, grant, RLS, RPC, Auth ou mudança de conteúdo foi executado por esta migration.

### Advisors

Os advisors foram reexecutados após a aplicação:

- security: `48` ocorrências `rls_enabled_no_policy` (INFO), `8` funções `SECURITY DEFINER` executáveis por `authenticated` (WARN) e Leaked Password Protection desabilitada (WARN);
- performance: `61` FKs sem covering index (INFO) e `30` índices sem uso registrado (INFO).

Nenhuma classe de alerta é atribuível à migration COMMENT-only e nenhuma remediação automática foi executada para silenciar avisos gerais existentes.

### Estado final

Os critérios da #73 ficam satisfeitos sem reinterpretar o legado:

- `review_status` está documentado no app e no schema como fonte canônica do workflow editorial;
- writers novos mantêm a projeção `pending/needs_review => true` e `approved/discarded => false`;
- o default físico impede novos `pending/false` por omissão;
- os `30.839 pending/false` históricos permanecem preservados porque a auditoria mostrou semântica legada distinta;
- o Edit não depende mais de `needs_review` para leitura e Statistics não o consome;
- PostgreSQL sintético e read-back do Supabase real cobrem o contrato escolhido.

---

## 2026-09-10 — aplicação da autoria canônica do World Explorer (#119)

### Escopo

Aplicação controlada da infraestrutura de autoria factual do World Explorer após autorização explícita de release, CI terminal do SHA candidato e preflight read-only do projeto canônico. A mudança instala schema/RPCs de autoria e **não ativa** por si só a projection canônica pública nem cria fatos narrativos.

### Preflight imediatamente anterior

Project ref confirmado: `dmrqnbdvbkfqzctcerbx`.

Antes do DDL:

- as seis tabelas novas (`relation_types`, `world_relation_styles`, `entity_relations`, `entity_relation_sources`, `world_graph_heads`, `world_graph_revisions`) não existiam;
- `world_edit_leases`: `0` leases ativos;
- `world_layout_snapshots`: `0` rows;
- `entities`: `3` rows;
- `canon_entries`: `0` rows;
- somente `1` entity estava `active/public_web`;
- migration history terminava em `20260909205836 world_edit_lease`;
- os RPCs existentes de layout/lease permaneciam `SECURITY INVOKER`, sem `EXECUTE` de `anon/authenticated` e com `service_role` autorizado;
- não havia evento `world_*` no `audit_log`.

O security advisor antes da aplicação mantinha a baseline conhecida: `40` ocorrências informativas de `rls_enabled_no_policy`, `8` warnings das funções `SECURITY DEFINER` legadas executáveis por `authenticated` e Leaked Password Protection desabilitada. O performance advisor reportava `49` FKs sem covering index e `27` índices sem uso registrado.

### Aplicação

O SQL versionado localmente como:

- `20260909215000_world_graph_authoring.sql`

foi aplicado pelo mecanismo de migration do Supabase. O migration history remoto registrou:

- `20260910002529 world_graph_authoring`.

A divergência numérica local/remota é nominal. Não reexecutar DDL nem editar migration history para alinhar o número; a reconciliação documental preserva ambos os identificadores até decisão específica de versionamento.

### Objetos e segurança pós-migration

Confirmados fisicamente:

- seis tabelas novas presentes;
- `world_edit_leases` com `base_graph_revision bigint not null default 0`, `draft_graph jsonb not null default '{}'` e `graph_draft_initialized boolean not null default false`;
- trigger `world_edit_lease_graph_handoff` ativo;
- RLS habilitado nas seis tabelas novas;
- `0` policies de browser nessas tabelas, mantendo deny-by-default;
- `anon` e `authenticated` sem acesso direto às novas tabelas;
- `service_role` com os grants mínimos versionados, incluindo ausência de `DELETE`, somente `SELECT` em `entity_relation_sources` e ausência de `UPDATE` em `world_graph_revisions`.

As funções `world_graph_snapshot_json`, `acquire_world_graph_draft_atomic`, `save_world_graph_draft_atomic`, `publish_world_edit_state_atomic` e o helper do trigger foram revalidadas como:

- `SECURITY INVOKER`;
- `search_path = pg_catalog, public`;
- sem `EXECUTE` para `anon`/`authenticated`;
- com `EXECUTE` para `service_role`.

### Invariantes de dados

A aplicação de schema preservou o estado narrativo existente:

- `entities=3`;
- `canon_entries=0`;
- `world_layout_snapshots=0`;
- `world_edit_leases=0`;
- `relation_types=0`;
- `world_relation_styles=0`;
- `entity_relations=0`;
- `entity_relation_sources=0`;
- `world_graph_heads=0`;
- `world_graph_revisions=0`;
- relations públicas criadas pela mudança: `0`;
- eventos `world_*` no audit após a validação: `0`.

`world_graph_snapshot_json` para a campanha principal projetou `3` nodes, `0` edges e `0` relation types. Chamadas negativas de acquire/publish com identity/profile inexistentes retornaram `forbidden` e não criaram lease, revision, relation ou audit.

### Advisors pós-aplicação

Security advisor em 2026-09-10:

- `46` ocorrências informativas de `rls_enabled_no_policy`; as seis novas tabelas explicam o aumento e estão deliberadamente sem policy de browser;
- as mesmas `8` funções `SECURITY DEFINER` legadas executáveis por `authenticated` já inventariadas;
- Leaked Password Protection continua desabilitada.

Performance advisor:

- `59` FKs sem covering index;
- `30` índices sem uso registrado.

Os novos INFO incluem FKs de actor/audit e `entity_relation_sources(canon_entry_id)`. Os índices de traversal por campaign/source e campaign/target foram mantidos mesmo ainda sem uso porque correspondem aos query paths planejados. O índice de provenance por `canon_entry_id` fica candidato para a fatia em que esse lookup se tornar caminho real; nenhum índice/policy foi criado automaticamente apenas para silenciar advisor.

### Gate de produto preservado

A infrastructure aplicada **não** habilitou `TDA_WORLD_CANONICAL_ENABLED=true`. O World público continua demonstrativo por padrão. Com somente 1 entity `public_web` e 0 `canon_entries`, ativar o dataset real agora seria prematuro.

A #119 também não cria mutation para anexar `canon_entry` em `entity_relation_sources`; relações novas precisam permanecer privadas/review até existir fluxo de provenance/review autorizado e auditável.

### Estado ao fechar esta verificação

- migration aplicada e fisicamente verificada;
- nenhuma alteração factual/canônica publicada;
- nenhuma policy pública adicionada;
- nenhum grant legado alterado;
- nenhum merge/deploy de aplicação fazia parte desta etapa do banco;
- próximo gate: documentação/CI do SHA final da PR, integração deliberada do consumidor e release separada mantendo a projection pública canônica desativada.

Rollback lógico, se necessário: primeiro desligar o consumidor; preservar `world_graph_revisions`/audit e conteúdo factual existente; usar migration corretiva compatível em vez de apagar dados ou reexecutar o candidato original.

---

## 2026-09-08 — reconciliação do migration history do World Explorer

### Escopo

Reconciliação read-only do estado já aplicado de persistência editorial do World Explorer com os arquivos versionados do TDA. Nenhum DDL/DML foi reexecutado e nenhuma linha de migration history foi editada.

### Migration history remoto confirmado

O projeto canônico registra, com os statements executados preservados em `supabase_migrations.schema_migrations`:

- `20260908203249 world_layout_capability`;
- `20260908203331 world_layout_snapshot_atomic`;
- `20260908203441 world_layout_service_role_privileges`;
- `20260908203642 world_layout_site_editor_grant`.

Os statements das duas primeiras entradas são equivalentes aos candidatos originalmente versionados como `20260908192500_world_layout_capability.sql` e `20260908192600_world_layout_snapshot_atomic.sql`. A reconciliação local apenas alinha os filenames aos IDs remotos.

As duas entradas adicionais registram explicitamente mudanças já existentes no remoto:

- `world_layout_service_role_privileges`: revoga os privilégios herdados/default de `service_role` na tabela e concede somente `SELECT`, `INSERT`, `UPDATE`;
- `world_layout_site_editor_grant`: concede `campaign.world.layout.edit` ao role narrativo existente `site_editor`, sem criar profile/user assignment.

### Estado físico observado

- `public.world_layout_snapshots` existe e permanecia vazia (`0` snapshots) na inspeção que abriu #95;
- RLS está habilitado sem policy de browser;
- `save_world_layout_snapshot_atomic(...)` é `SECURITY INVOKER` e o boundary permanece server-only;
- `service_role` possui `SELECT/INSERT/UPDATE` na tabela, sem `DELETE`;
- `campaign.world.layout.edit` existe e está ligada ao role `site_editor`;
- nenhum conteúdo editorial foi alterado durante a reconciliação.

### Repositório

A PR #98 reconcilia o repo sem reaplicar schema:

- `20260908203249_world_layout_capability.sql`;
- `20260908203331_world_layout_snapshot_atomic.sql`;
- `20260908203441_world_layout_service_role_privileges.sql`;
- `20260908203642_world_layout_site_editor_grant.sql`.

O PostgreSQL sintético foi atualizado para representar o estado aplicado: a capability já pertence a `site_editor`, porém nenhum assignment é criado pela migration. O primeiro write continua proibido até existir assignment ativo no scope da campanha; depois o teste cobre payload, save, no-op, stale conflict, revision/audit e rollback em falha do audit.

### Limites

A reconciliação do World não resolve o drift separado de `edit_transcript_segment_atomic` (`20260907115300` local vs `20260908064257` remoto), nem a massa histórica `pending/false` da #73. Esses recortes permanecem independentes.

---

## 2026-09-08 — preflight read-only da persistência editorial do World Explorer

### Escopo

Preflight do próximo recorte de `/edit/mundo`: escolher e validar em branch a forma física candidata para persistência de layout, sem executar DDL/DML de ativação no Supabase canônico.

### Estado remoto observado

Project ref confirmado: `dmrqnbdvbkfqzctcerbx`.

O migration history remoto mais recente observado contém:

- `20260908144711 transcript_review_default`;
- `20260908064257 edit_transcript_segment_atomic`;
- `20260907084234 add_transcript_segment_revision`;
- `20260906211040 relax_reboot_entity_name_lookup`;
- `20260906210427 backfill_narrative_entity_links`;
- `20260906210333 align_tda_domain_identity`.

A capability `campaign.world.layout.edit` não foi encontrada no catálogo observado e `public.save_world_layout_snapshot_atomic(...)` não existe no schema remoto desta verificação. Nenhum objeto de persistência do World layout foi criado por este preflight.

### Drift identificado

O migration history remoto usava IDs diferentes dos arquivos locais então presentes para dois changesets:

- remoto `20260908064257 edit_transcript_segment_atomic` vs local `20260907115300_edit_transcript_segment_atomic.sql`;
- remoto `20260908144711 transcript_review_default` vs local `20260908134500_transcript_review_default.sql`.

Foi feita inspeção read-only adicional do estado físico:

- `edit_transcript_segment_atomic(...)` existe como `SECURITY INVOKER`;
- assinatura/corpo observados correspondem ao contrato do arquivo local;
- comentário esperado está presente;
- `anon` e `authenticated` não possuem `EXECUTE`;
- `service_role` possui `EXECUTE`;
- `search_path` observado é `pg_catalog, public`;
- `transcript_segments.needs_review` possui default físico `true`.

A reconciliação posterior de `transcript_review_default` alinhou o arquivo local ao ID remoto `20260908144711` sem reexecutar DDL. Permanece aberto somente o drift de versionamento de `edit_transcript_segment_atomic`; equivalência funcional observada não autoriza reescrever migration history.

### Advisors

Security advisor reexecutado em 2026-09-08:

- 38 ocorrências informativas de `rls_enabled_no_policy`;
- 8 warnings de `SECURITY DEFINER` executáveis por `authenticated`, correspondentes às RPCs legadas já inventariadas;
- Leaked Password Protection continua desabilitada.

Performance advisor reexecutado:

- 49 FKs sem covering index;
- 26 índices sem uso registrado.

Nenhum warning foi convertido automaticamente em DDL. O estado foi usado somente como baseline de comparação para futura aplicação deliberada.

### Candidato preparado no repositório

A branch `feat/world-layout-persistence-candidate` preparou, sem aplicação remota:

- `20260908192500_world_layout_capability.sql` — define `campaign.world.layout.edit` (`narrative`) sem conceder role/assignment;
- `20260908192600_world_layout_snapshot_atomic.sql` — storage dedicado `world_layout_snapshots` + RPC `save_world_layout_snapshot_atomic(...)` server-only, optimistic concurrency e audit atômico;
- PostgreSQL 16 sintético/descartável via `tools/world-layout-db.py`;
- testes de RLS/grants, autorização/scope, payload, revision/conflict/no-op e rollback em falha do audit;
- ADR-0011 registrando a forma física candidata e o gate de ativação.

O job PostgreSQL do PR candidato passou integralmente, incluindo `python tools/world-layout-db.py`. Nenhuma conexão ao Supabase de produção é usada pelo teste sintético.

### Ações tomadas

- somente SQL read-only no Supabase canônico;
- advisors read-only executados;
- nenhuma migration aplicada;
- nenhuma tabela/função/capability criada no Supabase;
- nenhum role permission/assignment alterado;
- nenhum dado narrativo, Auth, grant, RLS, DNS ou deploy alterado;
- drift registrado em `migrations.md` e neste log.

### Gate seguinte

Antes de qualquer aplicação física do World layout:

1. reconciliar formalmente o ID remoto/local ainda divergente de `edit_transcript_segment_atomic` sem reescrever história;
2. confirmar o SHA exato da `main` candidata;
3. executar uma rodada separada/autorizada do database runbook;
4. revalidar objetos/grants/history e advisors após aplicação;
5. só então conectar `/edit/mundo` à leitura/escrita real e conceder a capability necessária.

---

## 2026-09-08 — default de review de transcrição e reconciliação de migration ID

### Escopo

Aplicação e verificação da mudança forward-only que alinha o default físico de `public.transcript_segments.needs_review` ao invariante atual `review_status='pending' => needs_review=true`, seguida de reconciliação documental do ID de migration registrado pelo Supabase.

### Estado observado antes da mudança

- `needs_review DEFAULT false`;
- distribuição: `pending/false=30.839`, `pending/true=17`, `needs_review/true=1`;
- nenhuma CHECK constraint foi adicionada entre `review_status` e `needs_review`.

### Aplicação

O SQL aplicado alterou somente o default de `needs_review` para `true`. Não houve backfill, alteração de linhas históricas, grant, RLS, RPC, Auth ou deploy de aplicação.

O migration history remoto registrou a mudança como:

- `20260908144711 transcript_review_default`.

A candidata originalmente integrada no repositório possuía o mesmo SQL sob `20260908134500_transcript_review_default.sql`. A reconciliação posterior apenas renomeia o arquivo local e atualiza os consumidores sintéticos/documentação para corresponder ao ID remoto; o DDL não é reexecutado.

### Verificação pós-aplicação

- `information_schema.columns.column_default` para `public.transcript_segments.needs_review` passou a `true`;
- as contagens históricas permaneceram exatamente `pending/false=30.839`, `pending/true=17`, `needs_review/true=1`;
- advisors de segurança/performance foram reexecutados sem nova classe de alerta relacionada à mudança;
- permaneceram as dívidas já conhecidas de RLS sem policy em várias tabelas, funções `SECURITY DEFINER` executáveis por `authenticated`, leaked-password protection desabilitada, FKs sem índice e índices ainda sem uso.

### Estado final

A geração de novos `pending/false` por omissão de `needs_review` foi interrompida pelo default. As 30.839 linhas históricas continuam intocadas e precisam ser classificadas antes de qualquer backfill ou CHECK constraint.

---

## 2026-09-07 — auditoria das RPCs `SECURITY DEFINER`

### Escopo

Inspeção read-only das funções privilegiadas em `public`, grants efetivos e principais consumidores versionados do TDA/legado.

### Estado observado

Foram confirmadas 8 funções `SECURITY DEFINER`:

- `access_directory(campaign_slug text)`;
- `current_profile_id()`;
- `has_campaign_role(target_campaign_id uuid, allowed_roles text[])`;
- `has_campaign_role_slug(campaign_slug text, allowed_roles text[])`;
- `review_profile_claim(...)`;
- `review_table_note(...)`;
- `submit_profile_claim(...)`;
- `table_notes_directory(...)`.

Para as oito:

- owner `postgres`;
- `anon` sem `EXECUTE`;
- `authenticated` com `EXECUTE`;
- `service_role` com `EXECUTE`;
- `search_path` fixado em `pg_catalog, public` nas definições observadas.

### Classificação

Helpers internos/candidatos a hardening:

- `current_profile_id()`;
- `has_campaign_role(...)`;
- `has_campaign_role_slug(...)`.

Endpoints autenticados/administrativos intencionais durante a transição:

- `access_directory(...)`;
- `submit_profile_claim(...)`;
- `review_profile_claim(...)`;
- `table_notes_directory(...)`;
- `review_table_note(...)`.

### Consumidores

O código atual do reboot não apresentou caller direto conhecido para os três helpers.

No `Faysk/dnd-scribe`, o backend principal inspecionado resolve profile, membership, RBAC e permissions com SQL server-side, e o web app atual consulta a API legada `/api/auth/me`. Não foram observadas chamadas diretas aos três helpers no backend principal analisado.

A ausência em código versionado não foi tratada como prova absoluta de ausência de consumidor externo/antigo. Por isso nenhum grant foi revogado nesta verificação.

### Ponto de atenção

`access_directory` exige Auth e mascara campos para não-admin, mas o caminho não-admin não exige explicitamente membership prévia na campanha solicitada.

Com a campanha única conhecida, nenhum vazamento cross-campaign foi observado. A semântica precisa ser definida e testada antes de multi-campaign/Edit público.

### Ações tomadas

- nenhum SQL de escrita executado;
- nenhum grant/policy/function alterado;
- criado `docs/database/rpc-inventory.md`;
- atualizado `docs/database/security.md`;
- atualizado o índice de documentação do banco.

### Próxima condição para mudança de grant

Só versionar `REVOKE EXECUTE` dos helpers depois de:

1. provar ausência de consumidores externos necessários;
2. criar teste positivo dos endpoints que usam os helpers internamente;
3. criar teste negativo de execução direta quando a revogação for desejada;
4. aplicar a mudança por migration;
5. rodar advisors e revalidar produção.

---

## 2026-09-07 — revalidação pós-reboot

### Escopo

Revalidação read-only do Supabase de produção contra as migrations e documentação atualmente presentes em `Faysk/tda`.

### Projeto

- project ref: `dmrqnbdvbkfqzctcerbx`;
- nome no Supabase: `DND Scribe`;
- estado observado: `ACTIVE_HEALTHY`;
- PostgreSQL: 17.

O nome legado do projeto no fornecedor não altera o scope canônico do reboot (`project/tda`). Renomear o projeto no fornecedor não é requisito funcional desta etapa.

### Migration history do reboot

Confirmadas no banco remoto:

- `20260906210333 align_tda_domain_identity`;
- `20260906210427 backfill_narrative_entity_links`;
- `20260906211040 relax_reboot_entity_name_lookup`.

Os IDs/nomes correspondem aos arquivos em `supabase/migrations`.

### Objetos estruturais verificados

Confirmados no schema real:

- `entities.aliases`;
- unique index de `(campaign_id, slug)` quando `slug` não é nulo;
- índice de lookup `(campaign_id, lower(name))` não único;
- constraint legada exata `(campaign_id, name)` preservada;
- `profile_characters.entity_id` + FK;
- índice de `profile_characters.entity_id`;
- `participants.character_entity_id` + FK;
- índice de `participants.character_entity_id`;
- índice de `entity_mentions.entity_id`;
- GIN de `entities.aliases`.

### Invariantes de dados

Estado observado:

- `entities`: 3;
- entities `pc`: 3;
- `profile_characters` não-NPC: 3;
- `profile_characters` não-NPC sem `entity_id`: 0;
- `participants`: 18;
- participants com nome: 18;
- participants nomeados sem `character_entity_id`: 6;
- assignments ativos `project/tda`: 2;
- assignments ativos `project/dnd-scribe`: 2.

Os 6 participants sem entity são registros de `DM` e `Convidado / indefinido`, não PCs conhecidos que falharam no backfill. Portanto não foi feito novo backfill.

### Advisors de segurança

O advisor foi executado novamente.

Principais classes observadas:

- diversas tabelas públicas com RLS habilitado e sem policy explícita (`rls_enabled_no_policy`);
- RPCs `SECURITY DEFINER` executáveis por `authenticated`;
- Leaked Password Protection desabilitada no Auth.

Decisão:

- **não** criar policies abertas para silenciar o primeiro aviso: o estado atual é deny-by-default e a superfície pública vigente usa boundary server-side;
- **não** revogar RPCs em massa: consumidores legados precisam ser inventariados função a função antes do Edit público;
- proteção de senha vazada permanece item de hardening caso login por senha seja habilitado; o fluxo atual é orientado a OAuth.

Ver `docs/database/security.md` para o contrato e checklist de segurança.

### Advisors de performance

O advisor foi executado novamente.

Foram observadas várias FKs sem índice cobrindo a coluna e vários índices ainda sem uso registrado, incluindo índices novos do domínio narrativo.

Decisão:

- não criar/remover índices em massa com base apenas no advisor;
- preservar índices das features que ainda estão entrando em uso;
- priorizar otimização baseada em tráfego/query paths reais do TDA.

### Drift

Nenhum drift conhecido foi encontrado entre as três migrations do reboot registradas no Supabase e os arquivos atuais do repositório.

### Ações tomadas

- nenhuma DDL aplicada;
- nenhum dado alterado;
- nenhum grant/policy/RPC alterado;
- criado `docs/operations/database-runbook.md` para padronizar operação, mudança, drift, rollback e incidentes;
- esta verificação foi registrada para manter histórico operacional.

### Estado final da verificação

**Apto para continuidade do desenvolvimento do reboot.**

Pendências conhecidas continuam sendo trabalho planejado, não blockers do estado atual:

1. inventário/hardening das RPCs `SECURITY DEFINER` antes do Edit público;
2. convergência completa do legado para UUID/slug antes de remover a constraint histórica de nome;
3. otimização de índices guiada por uso real;
4. decisão canônica `Screacky` vs `Screaky` e alias correspondente quando aprovada.

## 2026-09-07 — reparo de 12 referências públicas de imagem (#25)

Projeto `dmrqnbdvbkfqzctcerbx`, campanha `yuhara-main`. DML operacional autorizada, sem DDL/migration de schema, grants, RLS ou RPC. A inspeção prévia confirmou as 11 sessões publicadas e ausência de triggers customizados em `sessions`.

Uma transação com row locks, UUID/sourceSessionId/campanha/status e compare-and-swap de ambos os campos substituiu somente 12 URLs quebradas em 6 sessões por URLs GitHub no commit imutável validado. As outras 10 referências permaneceram iguais. Hashes das demais colunas e demais chaves de metadata permaneceram iguais nas 11 sessões; textos, transcrições, usuários e outros conteúdos não foram alterados. O rollback foi preparado com CAS e não executado. Advisors de schema/auth não foram repetidos para esse reparo estreito de valores; nenhum estado de segurança novo é afirmado.

[Recibo, snapshots, SQL de aplicação/rollback e verificação pública 22/22](../integrations/media-public-delivery-2026-09-07.md). A promoção posterior das 22 referências para R2 foi apenas preparada; exige release compatível, novos GETs e nova comparação com o snapshot pós-reparo. Nenhuma referência R2 foi gravada no banco nesta entrega.
## 2026-10-03 — tools recovery preflight (#1325 / #1326)

Project `dmrqnbdvbkfqzctcerbx`, app main `c87fb8e27e4e3823d6dd0b3721c5971497142ef1`. Read-only inspection confirms two campaigns (active/public historical identity; active/private second identity), deployed registry columns except `updated_at`, and existing cover binding table. The missing revision column makes the management query fail and consequently hides authorized tools in the launcher. Remote migration versions/statements were checked for the three reconciliation mappings; no history was modified.

Scratch PostgreSQL 16: registry and authorization suites pass, including replay, cross-campaign rejection, private/archived discovery boundaries and the new revision/backfill/stale-update contract. Campaign/access unit tests: 48 passed. This entry records candidate validation only, not remote application or public deployment.

## 2026-10-03 — recuperação publicada e configuração do master

PR #1336 / commit `2dcfde2f5b228cec091e14c24b3eb4e5c0ae48f2`, Production CD https://github.com/Faysk/tda/actions/runs/37086054702 concluída. Migration `20261003011729_restore_campaign_registry_revision` confirmada no histórico remoto. `/api/version` confirmou o mesmo SHA. Gestão autenticada voltou a listar as duas campanhas; os nomes aprovados **Destino Sem Fim** e **Passos Retomados** foram salvos pelo formulário e relidos. UUIDs, technical/public slugs, visibilidade e ownership de mídias/sessões foram preservados.

Após autorização explícita do proprietário, o perfil vinculado à sessão Chrome foi comparado com o platform owner ativo antes da operação. Cinco grants de roles existentes em project/tda foram adicionados somente à conta confirmada, com audit atômico. Read-back: um perfil alterado, cinco eventos, zero capabilities atuais ausentes. A configuração não altera permissões de outras contas. Operação `a80495ef-c69b-4bda-92c5-f3fe48b6aa2d`; recovery permite revogar somente os assignments registrados por essa operação, preservando histórico e grants anteriores. Ver contrato de [permissões](../features/edit-permissions.md).

O formulário aberto durante a promoção rejeitou um Server Action antigo antes de qualquer write; reload permitiu salvar normalmente. Renomear também revelou menu com metadata antiga durante a navegação cliente; a correção invalida o root layout após mutations de campanha, sem alterar composição visual.


## 2026-10-04 — campaign move v2 publicado e commit v1 retirado

### Escopo

Fechamento operacional de #1454 e das issues #1455–#1462, seguido do hardening #1475 identificado durante o próprio read-back pós-rollout.

Projeto canônico: `dmrqnbdvbkfqzctcerbx`.

Nenhum conteúdo narrativo privado de transcript/canon/mídia foi lido nesta verificação. A sessão real usada para confirmar o plano foi consultada apenas por identidade estrutural, contagens e flags de relacionamento. Nenhum campaign move foi executado nessa sessão durante a validação.

### Release v2

PR #1464 foi integrada em:

- source SHA: `981095a742280163e451a0fb15d001a54ad0a88e`;
- CI: https://github.com/Faysk/tda/actions/runs/37223854033 — success;
- Campaign Isolation Gate: https://github.com/Faysk/tda/actions/runs/37223853673 — success;
- CodeQL: https://github.com/Faysk/tda/actions/runs/37223853659 — success;
- Production CD: https://github.com/Faysk/tda/actions/runs/37224181889 — success;
- release: `prod-981095a74228`.

O Production CD partiu do baseline `4ac3aab53c721f8d7d91bc0b15c7ca81319709a7`, aplicou `20261004180000_session_campaign_move_v2.sql`, confirmou `PRODUCTION_MIGRATIONS_OK` e depois `CANONICAL_PRODUCTION_OK` para o mesmo SHA. O smoke semântico staged + canonical passou.

Read-back após a migration:

- `session_campaign_move_contract().version = 2`;
- features: dependency registry, private lineage, publication transfer, media prepare/commit, decisões explícitas de participant/grants e durable replay;
- `session_campaign_move_registry_drift() = []`;
- tabelas de policy e media-preparation receipt presentes;
- `service_role` com EXECUTE no contract, preflight e commit v2;
- `anon`/`authenticated` sem EXECUTE nas mutations do campaign move;
- helper interno de drift sem EXECUTE do `service_role`.

### Sessão estruturalmente revalidada

A sessão `20260917-sessao-PF` permaneceu em **Destino Sem Fim** durante toda a verificação e continuou com zero receipts de campaign move.

Estado estrutural observado:

- 1 transcript revision;
- 9 editorial drafts;
- 1 session publication;
- 1 publication operation;
- current transcript/draft/publication presentes;
- 0 participant→entity links;
- 0 session-scoped grants;
- 0 entity mentions;
- 0 canon/entity links;
- 0 legacy public publications.

O plano v2 para **Passos Retomados** retornou `blockers=[]`. Classificação:

- `audit_log`: histórico preservado;
- 9 drafts + publication/operation + transcript revision/receipts/events: transferência automática de ownership;
- 2 cover assets: `external_prepare`, exigindo cópia/read-back governados no namespace R2 de destino antes do commit.

Nenhuma das duas capas foi copiada por esta verificação porque o usuário não solicitou executar o move da sessão; o read-back apenas prova que o boundary está pronto para preparar e efetivar a operação quando houver intenção explícita.

### Hardening de skew — #1475

O read-back revelou um risco de compatibilidade entre app antigo e schema v2: `preflight_session_campaign_move(...)` passou a aprovar sessões populadas, mas o commit legado `move_session_campaign_atomic(...)` ainda podia ser executado por `service_role` e atualizava somente `sessions.campaign_id`.

No momento da detecção havia **zero receipts de move v1/v2**, portanto não foi encontrado move parcial já cometido.

A correção foi entregue por PR #1477:

- source SHA: `5f6a446e74ef35c89397c8675ed2e661c83e7a86`;
- CI: https://github.com/Faysk/tda/actions/runs/37224832321 — success;
- Campaign Isolation Gate: https://github.com/Faysk/tda/actions/runs/37224832107 — success;
- CodeQL: https://github.com/Faysk/tda/actions/runs/37224832078 — success;
- Production CD: https://github.com/Faysk/tda/actions/runs/37224929719 — success;
- release: `prod-5f6a446e74ef`.

O rollout partiu do baseline `981095a742280163e451a0fb15d001a54ad0a88e`, aplicou `20261004182700_retire_session_campaign_move_v1_commit.sql`, confirmou migration history exato e publicou o mesmo SHA canônico.

Read-back final:

- contract continua v2;
- registry drift continua vazio;
- `service_role`, `anon` e `authenticated`: **sem EXECUTE** no commit v1;
- `service_role`: EXECUTE preservado no preflight e no commit v2;
- browser roles continuam sem autoridade para efetivar o move.

Assim, Server Actions/abas stale falham antes do write em vez de poder executar o caminho parcial v1.

### Advisors pós-rollout

Security advisor:

- `rls_enabled_no_policy` continua INFO/deny-by-default; inclui as tabelas server-only de receipts/policies do move e não representa abertura para browser;
- warnings de `SECURITY DEFINER` executável e leaked-password protection observados são classes preexistentes e não apontam para os RPCs de campaign move v2.

Performance advisor:

- há INFOs de FKs sem covering index nas tabelas de move/receipt;
- nenhuma criação de índice foi feita apenas para silenciar advisor;
- o fluxo de move é administrativo/raro e os caminhos quentes principais usam operation/session identity; indexação adicional fica condicionada a evidência de query/performance real.

Remediação de referência:
- RLS sem policy: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- FKs sem índice: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

### Estado final

- v2 aplicado e publicado;
- commit v1 de aplicação retirado;
- migration history remoto alinhado ao repositório;
- gates exatos e smoke de Production verdes;
- sessão real preservada sem mutation;
- operação real pode agora seguir o fluxo `preflight → media prepare/read-back → commit v2 → cache/read-back` quando houver ordem explícita para mover.

## 2026-10-07 — #1578 bounded private handoff candidate

Production timeout was traced to full Assembly segment validation (SQLSTATE 57014); inherited authenticator statement/lock budgets were eight seconds and actual Assembly revision count remained zero. A read-only synthetic 8,019-row Production validation EXPLAIN completed in 1.238s; isolated real-shape whole RPC completed in approximately 0.515s. The explored query rewrite showed no material local gain and was excluded. Candidate migration sets only the dedicated entry-point statement budget to a finite 30s. Full scratch chain passed with synthetic 8,019-row v3 positive, two-part receipt, idempotent replay, malformed last absolute timestamp rejection and exact invoker/ACL/config checks. This is candidate evidence; migration publication and actual private Library acceptance remain pending.
