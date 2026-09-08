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

## RPC server-only candidata do World Explorer

### `save_world_layout_snapshot_atomic(...)`

**Estado:** definida somente na migration candidata `20260908192600_world_layout_snapshot_atomic`; **não existe no Supabase canônico na inspeção read-only de 2026-09-08 e não foi aplicada**.

Classificação candidata:

- `SECURITY INVOKER`;
- `search_path = pg_catalog, public`;
- `PUBLIC`, `anon` e `authenticated`: sem `EXECUTE`;
- `service_role`: único grant de `EXECUTE` pretendido;
- storage `world_layout_snapshots` com RLS habilitado e sem policy de browser;
- `service_role` recebe somente `SELECT`, `INSERT`, `UPDATE`, sem `DELETE`.

Boundary:

- valida vínculo `auth_user_id -> profile_id`;
- exige capability física `campaign.world.layout.edit`;
- exige assignment ativo e válido no scope da campaign ou `project/tda`;
- aceita somente snapshot `overview` implícito, até 1000 nodes, IDs limitados e coordenadas numéricas em `±5000`;
- usa `expected_revision` para optimistic concurrency;
- primeiro save nasce em revision 1; writer stale recebe `conflict`;
- payload idêntico retorna `unchanged` sem bump/audit;
- alteração válida incrementa revision exatamente em 1;
- `world_layout.update` é gravado no `audit_log` na mesma transação;
- falha de audit deve reverter o snapshot.

A função **não** reconstrói audience/canon no banco. O app deve construir a projection autorizada antes de salvar e, na leitura pública futura, intersectar positions apenas com IDs já autorizados antes de emitir payload ao browser.

Validação sintética:

- PostgreSQL 16 descartável, Unix socket only;
- testes de grants/RLS, identidade, capability/scope, payload inválido, save/no-op/conflict/update e rollback por falha de audit;
- CI do PR candidato executa `python tools/world-layout-db.py`.

Ativação remota permanece bloqueada até a reconciliação do drift de migration history e uma rodada deliberada do database runbook.

## Auditoria de consumidores

### TDA reboot

Busca no código atual do `Faysk/tda` não encontrou chamadas diretas conhecidas às oito RPCs legadas acima. A integração Supabase atual do site público é server-only e focada em dados publicados.

`save_world_layout_snapshot_atomic(...)` ainda não possui consumidor produtivo: `/edit/mundo` permanece staging local/exportável e não persiste no Supabase.

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
