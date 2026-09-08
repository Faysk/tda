# ADR-0011 — persistência física candidata do layout editorial do World Explorer

> Status: accepted
> Data: 2026-09-08
> Owner: frontend / narrative-memory / dados / identity-access
> Relacionado: ADR-0008, ADR-0009, ADR-0010

## Contexto

O ADR-0010 definiu o contrato lógico do layout editorial do World Explorer e deliberadamente deixou a forma física em aberto. O staging de `/edit/mundo` agora produz um snapshot `overview` sanitizado, com revision observada e posições em espaço lógico do canvas. Isso estabiliza o payload o suficiente para escolher a primeira forma física sem acoplar coordenadas a `entities`, `entity_relations`, canon ou evidence.

A persistência precisa preservar quatro invariantes:

1. layout é apresentação, não verdade narrativa;
2. escrita exige capability explícita e scope da campaign;
3. duas edições concorrentes não podem sobrescrever uma à outra silenciosamente;
4. browser público nunca recebe IDs/posições fora da projection já autorizada.

## Decisão

O primeiro storage físico será um **snapshot único por campaign + view**, em tabela dedicada `world_layout_snapshots`.

Contrato físico candidato:

```text
world_layout_snapshots
- id uuid PK
- campaign_id uuid FK -> campaigns
- view_name = "overview"
- schema_version = 1
- revision bigint monotônica
- positions jsonb
- updated_by uuid FK -> profiles
- created_at / updated_at
- UNIQUE(campaign_id, view_name)
```

A tabela não recebe FK para cada node. O payload pode conter IDs de nodes que deixem de existir posteriormente; leitura continua aplicando somente a interseção com a projection autorizada atual, conforme ADR-0010.

## Capability

A capability específica escolhida é:

```text
campaign.world.layout.edit
```

Plane: `narrative`.

A migration candidata apenas registra a capability no `permission_catalog`. Ela **não cria `role_permissions`, `role_assignments` nem concede a capability a usuário/role algum**.

O staging atual pode continuar protegido por `campaign.content.edit` enquanto a persistência física estiver desligada. Ativar o botão de salvar e conceder a nova capability é um recorte posterior e deliberado.

## Mutation boundary

A escrita física será feita por:

```text
save_world_layout_snapshot_atomic(
  auth_user_id,
  actor_profile_id,
  campaign_slug,
  expected_revision,
  positions
)
```

A função candidata é `SECURITY INVOKER`, server-only e executável apenas por `service_role`.

Ela revalida:

- vínculo `auth_user_id -> profile_id`;
- presença física da capability no catálogo;
- assignment ativo e temporalmente válido;
- scope da campaign ou `project/tda`;
- payload `overview` implícito, limitado a 1000 posições;
- node IDs sintaticamente limitados;
- somente `{x,y}` numéricos dentro de `±5000`.

A aplicação continua responsável por construir o snapshot a partir de uma projection autorizada. O banco valida forma/autorização da mutation, mas não recria a projection narrativa dentro da função.

## Concorrência

O primeiro snapshot nasce com `revision=1` quando o caller observou `expected_revision=0`.

Depois disso:

- igualdade entre revision atual e `expected_revision` é obrigatória;
- save válido incrementa exatamente `+1`;
- writer stale recebe `conflict` com a revision corrente;
- save idêntico retorna `unchanged` sem incrementar revision nem criar audit;
- a corrida de dois primeiros inserts usa `UNIQUE(campaign_id, view_name)` + `ON CONFLICT DO NOTHING`, fazendo o perdedor observar conflito em vez de sobrescrever.

## Auditoria

Cada alteração real cria `audit_log.action = "world_layout.update"` na mesma transação.

O audit registra o snapshot anterior/novo (`schemaVersion`, `view`, `revision`, `positions`). O payload é limitado pela própria validação da função e permanece em boundary server-only. Falha do audit aborta a alteração do snapshot.

## RLS e grants

`world_layout_snapshots` nasce com RLS habilitado e sem policy de browser.

A migration candidata:

- revoga acesso de `PUBLIC`, `anon` e `authenticated`;
- concede somente `SELECT`, `INSERT`, `UPDATE` a `service_role`;
- não concede `DELETE`;
- revoga `EXECUTE` da RPC de `PUBLIC`, `anon` e `authenticated`;
- concede `EXECUTE` apenas a `service_role`.

Isso segue o padrão server-only já adotado para writes sensíveis do Edit. A existência da service role não substitui Auth/capability; a RPC revalida identidade, assignment e scope antes da mutation.

## Leitura pública

Este ADR não autoriza uma policy pública na tabela.

Fluxo futuro obrigatório:

```text
request + audience
  -> projection autorizada de nodes/edges
  -> leitura server-side do snapshot aplicável
  -> interseção positions ∩ IDs autorizados
  -> sanitizeWorldLayoutProjection
  -> browser
```

A projection pública nunca deve ser derivada a partir das chaves do snapshot.

## Validação antes de aplicação

As migrations candidatas devem passar em PostgreSQL 16 descartável com fixture sintética, provando:

- capability definida sem grant automático;
- tabela com RLS e sem policy pública;
- `anon/authenticated` sem acesso direto;
- `service_role` sem `DELETE`;
- usuário sem capability negado;
- identidade/scope incorretos negados;
- payload inválido rejeitado;
- save inicial, no-op, conflito stale e update `+1`;
- audit old/new correto;
- falha de audit revertendo o snapshot.

CI verde **não aplica** a migration ao Supabase canônico.

## Ativação

Aplicação no projeto `dmrqnbdvbkfqzctcerbx` exige rodada separada seguindo `docs/operations/database-runbook.md`:

1. reconciliar qualquer drift de migration history existente;
2. confirmar SHA exato das migrations na `main`;
3. aplicar de forma controlada;
4. validar tabela, grants, função, capability e migration history;
5. rodar advisors de segurança/performance;
6. registrar em `verification-log.md`;
7. somente depois integrar leitura/escrita real no app e conceder a capability necessária.

## Recuperação

Antes de existir consumidor, a recuperação preferida é migration corretiva que revogue/remova RPC e storage novo sem tocar em canon ou entities.

Depois de ativado, rollback de aplicação deve primeiro desligar o consumidor. Não apagar audit nem reduzir revision para simular rollback. Uma composição anterior pode ser restaurada por uma nova mutation explícita com a revision corrente.

## Consequências

### Positivas

- storage fica isolado do domínio narrativo;
- snapshot é barato de ler e atualizar;
- optimistic concurrency é simples e explícita;
- audit é atômico;
- nenhum browser ganha acesso direto à tabela;
- stale/removed nodes continuam seguros pelo filtro da projection.

### Custos

- JSONB não oferece FK por node;
- histórico completo depende do audit, não de uma tabela de revisions dedicada;
- leitura/escrita real ainda exigem adapters server-side próprios;
- capability precisa ser concedida deliberadamente após aplicação física.

## Fora deste recorte

Não faz parte desta decisão:

- aplicar a migration em produção;
- conceder a capability a qualquer role/profile;
- persistir `?foco=`, câmera, zoom, filtros ou seleção;
- persistir dragging público automaticamente;
- criar relations canônicas;
- substituir a projection/audience layer por leitura do JSONB;
- realtime colaborativo ou merge de conflitos.
