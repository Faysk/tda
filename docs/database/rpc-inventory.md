# Inventário de RPCs privilegiadas do Supabase

> Status: vigente / revisão de hardening em andamento
> Owner: segurança/dados
> Última verificação: 2026-09-08
> Projeto: `dmrqnbdvbkfqzctcerbx`

Este documento classifica funções privilegiadas/expostas relevantes do schema `public`. `SECURITY DEFINER` merece atenção especial porque executa com privilégios do owner; funções `SECURITY INVOKER` server-only também são registradas quando representam um boundary de write sensível.

## Estado verificado

Na inspeção de produção revalidada em 2026-09-08 foram encontradas **8 funções `SECURITY DEFINER` em `public`**.

Para as oito:

- owner: `postgres`;
- `anon`: **sem EXECUTE**;
- `authenticated`: **com EXECUTE**;
- `service_role`: com EXECUTE;
- nenhuma das oito está aberta a chamadas anônimas pela grant atual.

Todas as definições observadas usam `SET search_path TO pg_catalog, public`, reduzindo risco clássico de search-path hijacking.

## Classificação

| Função | Classe | Auth interna | Estado de grant | Decisão atual |
| --- | --- | --- | --- | --- |
| `current_profile_id()` | helper interno | resolve `auth.uid()` para `profiles.id` | authenticated pode executar diretamente | candidato a `REVOKE EXECUTE` de authenticated após prova final de consumidores |
| `has_campaign_role(uuid,text[])` | helper interno | resolve profile atual e membership ativo | authenticated pode executar diretamente | candidato a `REVOKE EXECUTE` após prova final de consumidores |
| `has_campaign_role_slug(text,text[])` | helper interno | resolve profile atual, campaign e membership ativo | authenticated pode executar diretamente | candidato a `REVOKE EXECUTE` após prova final de consumidores |
| `access_directory(text)` | endpoint autenticado de onboarding/claims | exige usuário autenticado; admin recebe visão ampliada | authenticated | manter por enquanto; revisar escopo multi-campaign antes do Edit público |
| `submit_profile_claim(...)` | endpoint autenticado de onboarding | exige requester ligado e valida target/claim | authenticated | manter enquanto fluxo de claim existir |
| `review_profile_claim(...)` | endpoint admin | usa autorização admin interna antes de aprovar/rejeitar | authenticated + autorização interna | manter enquanto fluxo legado existir |
| `table_notes_directory(text,text)` | endpoint autenticado de campanha | exige profile e membership ativo; filtra visibilidade | authenticated | manter enquanto fluxo legado existir |
| `review_table_note(...)` | endpoint admin | exige role admin interna antes do update | authenticated + autorização interna | manter enquanto fluxo legado existir |

## Helpers internos

### `current_profile_id()`

Função pequena e estável que traduz `auth.uid()` para o `profile_id` interno.

Ela é útil como building block dentro de políticas/RPCs, mas não há benefício óbvio em expô-la como endpoint REST direto para todo usuário autenticado.

**Hardening proposto:** retirar `EXECUTE` direto de `authenticated` quando a ausência de consumidores externos estiver comprovada e houver teste de regressão dos RPCs que dependem do helper.

### `has_campaign_role(...)`

Verifica membership ativo do profile atual em uma campanha por UUID e compara com roles permitidas.

É helper de autorização. Expor seu booleano diretamente não é equivalente a dar acesso ao dado protegido, mas aumenta superfície desnecessária.

**Hardening proposto:** mesma política de `current_profile_id()`.

### `has_campaign_role_slug(...)`

Versão de lookup por slug. Mesma classificação e decisão do helper anterior.

## Endpoints intencionais

### `access_directory(campaign_slug text)`

Objetivo observado: fornecer diretório para fluxo de associação/claim de perfil.

Comportamento observado:

- rejeita usuário sem Auth;
- detecta se o profile atual é admin da campanha;
- admin recebe visão de diretório mais ampla;
- não-admin recebe somente profiles ainda não ligados a Auth e campos Discord são mascarados.

### Ponto de atenção

No caminho não-admin, a função não exige explicitamente membership do caller na campanha solicitada antes de retornar profiles não vinculados daquele `campaign_slug`.

No estado atual existe somente a campanha principal conhecida, então isso não representa hoje um vazamento cross-campaign observado. Porém a regra fica perigosa quando houver múltiplas campanhas ou onboarding mais aberto.

**Decisão:** não alterar agora para não quebrar onboarding/claim legado. Antes do Edit público ou segunda campanha, decidir explicitamente uma destas regras:

1. usuário autenticado pode consultar diretório de onboarding de uma campanha conhecida; ou
2. consulta exige convite/claim token/membership prévia/capability específica.

A decisão deve virar contrato e teste negativo.

### `submit_profile_claim(...)`

Endpoint de onboarding. A definição observada:

- exige profile do requester;
- impede claim de target já vinculado;
- resolve campanha pelo slug;
- evita claim pendente duplicado;
- grava solicitação pendente em `profile_claims`.

**Decisão:** manter até o fluxo TDA substituir ou formalizar esse contrato.

### `review_profile_claim(...)`

Endpoint de revisão. A definição observada:

- carrega claim existente;
- resolve reviewer atual;
- exige autorização admin da campanha;
- valida decisão;
- quando aprovado, atualiza identidade/profile e associações necessárias;
- finaliza estado do claim.

**Decisão:** manter durante transição; o novo Edit deve migrar autorização para capabilities/RBAC sem quebrar o fluxo existente.

### `table_notes_directory(...)`

Endpoint de leitura autenticada de notas.

A definição observada exige profile e membership ativo e aplica regras diferentes para admin/player, incluindo máscara de reviewer para quem não é admin.

**Decisão:** manter durante transição e cobrir com testes de audience/visibilidade antes de reutilizar no TDA.

### `review_table_note(...)`

Endpoint de update/revisão administrativa.

A definição observada resolve a campanha da nota, exige autorização admin e valida os valores antes do update.

**Decisão:** manter durante transição; migrar para capability explícita quando a superfície Edit for implementada.

## RPC server-only do Edit — estado remoto revalidado

### `edit_transcript_segment_atomic(...)`

A inspeção read-only de 2026-09-08 confirmou a função física no Supabase canônico sob migration history remoto `20260908064257 edit_transcript_segment_atomic`.

A definição física observada corresponde ao contrato do arquivo local `20260907115300_edit_transcript_segment_atomic.sql` quanto a assinatura, corpo da função, `SECURITY INVOKER`, `search_path`, comentário e grants efetivos:

- `anon`: sem `EXECUTE`;
- `authenticated`: sem `EXECUTE`;
- `service_role`: com `EXECUTE`;
- `search_path = pg_catalog, public`;
- comentário server-only esperado presente.

Existe, porém, **drift de versionamento** entre o ID remoto e o nome do arquivo local. A equivalência funcional observada não autoriza reescrever migration history nem tratar os IDs como iguais. A reconciliação operacional permanece pendente em `migrations.md`.

Boundary físico observado/local:

- actor/profile é resolvido pelo contexto autorizado da aplicação;
- `segment -> session -> campaign` é revalidado pelo slug;
- `expectedRevision` controla concorrência otimista;
- update e `audit_log` fazem parte da mesma chamada/transação;
- falha de audit aborta o update;
- cross-campaign retorna `not_found`;
- nenhuma das 8 funções `SECURITY DEFINER` legadas é modificada por esse slice.

## RPCs server-only do World layout — estado remoto

### `save_world_layout_snapshot_atomic(...)` e sessão exclusiva

A persistência editorial do World layout foi integrada pela #117 e aplicada deliberadamente ao Supabase canônico. O migration history remoto registra `20260909205836 world_edit_lease` para a sessão exclusiva; o arquivo local equivalente preserva seu ID de desenvolvimento, sem reexecutar DDL apenas para alinhar nomes.

RPCs observadas/contratadas deste boundary:

- `save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)`;
- `acquire_world_edit_lease_atomic(uuid,uuid,text,uuid)`;
- `renew_world_edit_lease_atomic(uuid,uuid,text,uuid)`;
- `save_world_edit_layout_draft_atomic(uuid,uuid,text,uuid,jsonb)`;
- `publish_world_edit_layout_atomic(uuid,uuid,text,uuid)`;
- `release_world_edit_lease_atomic(uuid,uuid,text,uuid)`.

Classificação:

- `SECURITY INVOKER`;
- `search_path = pg_catalog, public`;
- `PUBLIC`, `anon` e `authenticated`: sem `EXECUTE`;
- `service_role`: grant de `EXECUTE` pretendido/observado;
- `world_layout_snapshots` e `world_edit_leases` com RLS habilitado e sem policy de browser.

Boundary:

- valida vínculo `auth_user_id -> profile_id`;
- exige capability `campaign.world.layout.edit` e assignment ativo no scope da campaign ou `project/tda`;
- lease exclusivo protege sessão editorial e recovery do mesmo holder;
- `expected_revision`/`base_layout_revision` controlam concorrência otimista;
- payload de positions é limitado a IDs/coords válidos;
- publish grava `world_layout.update` em audit na mesma operação lógica;
- dragging público não recebe permissão para persistir por inferência.

A leitura pública continua intersectando positions apenas com IDs já autorizados; chaves do JSONB de layout nunca decidem audience.

## RPCs server-only candidatas do World graph — #119

A migration candidata `20260909215000_world_graph_authoring` adiciona três RPCs de autoria factual. Na inspeção read-only de 2026-09-10 elas **ainda não existiam no Supabase canônico**; portanto os itens abaixo descrevem o contrato versionado da #119, não estado físico já aplicado.

### `acquire_world_graph_draft_atomic(uuid,uuid,text,uuid)`

Classe: aquisição de rascunho factual privado vinculado ao lease do World.

Boundary candidato:

- `SECURITY INVOKER`;
- `search_path = pg_catalog, public`;
- `PUBLIC`, `anon` e `authenticated`: sem `EXECUTE`;
- `service_role`: único caller SQL pretendido;
- revalida `auth_user_id -> profile_id`;
- exige `campaign.content.edit` no scope correto;
- exige lease vigente do mesmo profile/token/campaign;
- inicializa draft a partir do snapshot canônico e fixa `base_graph_revision`;
- recovery do mesmo editor preserva draft; handoff para outro editor zera o draft factual privado.

### `save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb)`

Classe: persistência privada do rascunho factual.

Boundary candidato:

- mesmas restrições de execução e capability da aquisição;
- valida shape/limites do payload antes de armazenar;
- exige revision compatível com `base_graph_revision`;
- conflito com head factual mais novo falha fechado e preserva rascunho;
- não grava entities/relations canônicas antes do publish.

### `publish_world_edit_state_atomic(uuid,uuid,text,uuid)`

Classe: publicação transacional de grafo factual + layout editorial.

Boundary candidato:

- `SECURITY INVOKER`, `search_path = pg_catalog, public`, `service_role` only;
- exige `campaign.content.edit` e lease válido de `campaign.world.layout.edit` para a mesma identity/profile;
- valida endpoints, tipos, status, visibility, UUIDs, duplicatas, relações simétricas e revision antes de escrever;
- publica layout e fatos na mesma transação SQL;
- incrementa `world_graph_heads.revision` apenas quando o snapshot factual muda;
- registra snapshot append-only em `world_graph_revisions` e `world_graph.publish` no `audit_log`;
- remove o lease apenas após publicação concluída;
- não promove candidate/IA automaticamente.

### Gate de review/provenance fora da RPC

A #119 cria `entity_relation_sources(relation_id, canon_entry_id)` e mantém a regra de que uma relação pública precisa de fonte/revisão. Nesta fatia, `service_role` recebe somente `SELECT` nessa tabela e não existe mutation genérica para anexar `canon_entry` nova.

Antes de chamar `publish_world_edit_state_atomic`, o server action verifica relações ativas `public_campaign`/`public_web` no draft e exige source já existente em `entity_relation_sources`; ausência retorna `review_required` e a RPC de publish não é chamada. Isso impede a UI desta fatia de inventar um atalho de publicação, mas **não conclui o fluxo de provenance**: relações novas devem permanecer privadas/review até uma fatia específica de source/review.

### Projection pública independente da existência das RPCs

A aplicação não ativa dados canônicos em `/mundo` só porque a migration foi aplicada. `TDA_WORLD_CANONICAL_ENABLED=true` é um gate deliberado separado; sem ele, a superfície pública continua usando o dataset demonstrativo não canônico. Esse gate evita substituir a experiência atual por um dataset esparso antes de curadoria/review/validação visual.

### Validação candidata

`tools/world-layout-db.py` aplica migrations em PostgreSQL 16 descartável e cobre, entre outros:

- browser roles sem grants diretos;
- layout-only sem autoria factual;
- acquire/save/publish do grafo;
- draft não vazando para tabelas canônicas antes de publish;
- publicação conjunta de layout + grafo;
- normalização simétrica/estilo;
- recovery e concorrência.

A aplicação remota continua condicionada a CI terminal no SHA final, preflight read-only, advisors e execução deliberada do database runbook.

## Auditoria de consumidores

### TDA reboot

Busca no código atual do `Faysk/tda` não encontrou chamadas diretas conhecidas às oito RPCs legadas acima. A integração Supabase atual do site público é server-only e focada em dados publicados.

O World layout integrado pela #117 possui consumidor server-side protegido por capability. A #119 acrescenta consumidores candidatos para as três RPCs factuais, todos via server actions; enquanto a migration não for aplicada, essa autoria factual não deve ser publicada em produção.

### `Faysk/dnd-scribe`

O backend principal legado observado em `api/[...path].js` usa conexão PostgreSQL server-side para resolver profile, membership, RBAC e permissions. O web app atual consulta `/api/auth/me`, e esse endpoint delega para o backend legado.

Não foram observadas referências diretas aos três helpers (`current_profile_id`, `has_campaign_role`, `has_campaign_role_slug`) no backend principal inspecionado.

Ainda assim, ausência em código versionado não prova ausência absoluta de consumidor manual, release antigo, script ou cliente externo.

## Observabilidade de chamadas

Na verificação de 2026-09-07, o PostgreSQL retornou `track_functions = none`.

Consequência: `pg_stat_user_functions` não oferece contagem histórica útil dessas RPCs no estado atual. Portanto não é possível usar a estatística nativa de funções como prova de que um helper não possui consumidor em runtime.

**Decisão:** não mudar `track_functions` em produção apenas para essa auditoria e não interpretar ausência de estatística como ausência de uso. A prova para revogar grant deve combinar inventário de código/consumidores, testes da superfície autenticada e janela de transição controlada quando a mudança for planejada.

## Plano de hardening

### Fase 1 — concluída

- inventariar todas as `SECURITY DEFINER`;
- conferir grants por role;
- conferir `search_path`;
- revisar corpo/autorização;
- mapear consumidores principais versionados;
- registrar riscos sem mudar produção às cegas.

### Writes server-only novos

- manter `SECURITY INVOKER` quando elevação não é necessária;
- negar execução direta a `anon/authenticated`;
- revalidar identity/capability/scope dentro do boundary sensível quando aplicável;
- manter audit e mutation atômicos;
- validar em PostgreSQL sintético antes de qualquer aplicação remota;
- revalidar grants/advisors após aplicação real.

### Fase 2 — antes do Edit público

- criar testes positivos/negativos para endpoints autenticados;
- decidir contrato de `access_directory` para cenário multi-campaign;
- provar ausência de consumidores diretos dos helpers;
- criar migration de grant para retirar exposição direta dos helpers quando seguro;
- executar advisors e testes após a migration.

### Fase 3 — convergência TDA

- substituir checks de role legada por capabilities do RBAC onde apropriado;
- reduzir número de `SECURITY DEFINER` públicos ao mínimo necessário;
- preferir fronteira server-side ou funções invoker quando a elevação não for necessária;
- remover endpoints legados somente depois da independência ser comprovada.

## Regra

Não transformar warning do advisor em alteração automática. O objetivo é **reduzir superfície sem quebrar autorização existente**, não deixar o painel verdinho enquanto a aplicação pega fogo.

## Candidato: `import_transcript_bundle_atomic`

`public.import_transcript_bundle_atomic(uuid,uuid,jsonb,boolean)` é candidato service-only `SECURITY INVOKER`, search_path `pg_catalog, public`, sem `EXECUTE` para `PUBLIC`/`anon`/`authenticated`. Revalida operador/profile, action explícita, scope e origem da sessão; grava segmentos/recibo/audit juntos ou consulta recibo. Não aplicado e não selecionado pelo endpoint produtivo. Contrato e rollback em [importação local](../integrations/transcript-import.md).