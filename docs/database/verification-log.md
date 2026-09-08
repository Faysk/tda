# Log de verificações do banco de produção

> Status: vigente / append-only por intenção
> Owner: dados/Supabase
> Projeto canônico: `dmrqnbdvbkfqzctcerbx`

Este documento registra verificações pontuais do estado real do Supabase. Ele complementa `database-audit.md`: a auditoria descreve uma fotografia mais ampla; este log registra revalidações operacionais menores e frequentes.

Entradas novas devem ser adicionadas no topo, preservando as anteriores.

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
