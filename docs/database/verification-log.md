# Log de verificações do banco de produção

> Status: vigente / append-only por intenção
> Owner: dados/Supabase
> Projeto canônico: `dmrqnbdvbkfqzctcerbx`

Este documento registra verificações pontuais do estado real do Supabase. Ele complementa `database-audit.md`: a auditoria descreve uma fotografia mais ampla; este log registra revalidações operacionais menores e frequentes.

Entradas novas devem ser adicionadas no topo, preservando as anteriores.

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

O migration history remoto usa IDs diferentes dos arquivos locais atualmente presentes para dois changesets:

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

Essa equivalência funcional observada **não corrige o drift de versionamento** e não autoriza reescrever migration history. A aplicação de novas migrations no projeto canônico permanece bloqueada até reconciliação operacional explícita pelo runbook.

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

A branch `feat/world-layout-persistence-candidate` prepara, sem aplicação remota:

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

1. integrar e validar em CI terminal a migration candidata;
2. reconciliar formalmente os IDs remotos/locais divergentes sem reescrever história;
3. confirmar o SHA exato da `main` candidata;
4. executar uma rodada separada/autorizada do database runbook;
5. revalidar objetos/grants/history e advisors após aplicação;
6. só então conectar `/edit/mundo` à leitura/escrita real e conceder a capability necessária.

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
