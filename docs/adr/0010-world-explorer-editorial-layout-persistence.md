# ADR-0010 — persistência editorial do layout do World Explorer separada do canon

> Status: accepted
> Data: 2026-09-08
> Owner: frontend / narrative-memory / identity-access
> Última revisão: 2026-09-08
> Relacionado: ADR-0008, ADR-0009

## Contexto

O ADR-0009 tornou o World Explorer multi-hub e permitiu dragging público como reorganização visual local. Isso resolveu a hierarquia narrativa acidental do primeiro slice, mas deixou deliberadamente uma questão aberta: como uma composição organizada por um editor pode sobreviver entre sessões sem transformar coordenadas em canon, relation ou propriedade da entity.

Misturar posição de canvas com `entities`, `entity_relations`, canon ou evidence criaria um acoplamento errado. Coordenadas mudam por decisões de composição, densidade visual e evolução da UI; nenhuma dessas mudanças altera a verdade narrativa.

Também existe um risco de segurança: um layout persistido pode conter IDs de nodes que uma audience específica não pode receber. Portanto a leitura pública não pode simplesmente carregar um snapshot completo e esconder posições no browser.

## Decisão

O TDA trata o layout persistente do World Explorer como **estado editorial de apresentação versionado**, separado do domínio narrativo.

O contrato lógico é um snapshot atômico da visão geral da campanha:

```ts
type WorldLayoutSnapshot = {
  schemaVersion: 1;
  view: "overview";
  revision: number;
  positions: Record<nodeId, { x: number; y: number }>;
};
```

Esse formato é um contrato da aplicação/projection. Ele **não aprova uma tabela, migration, JSONB ou RPC específica**.

### Precedência de layout

A posição exibida segue esta ordem:

```text
seed determinístico da projection
  -> layoutHint curatorial quando existir
  -> snapshot editorial autorizado
  -> dragging local da sessão atual
```

Dragging público continua tendo maior prioridade apenas enquanto a página está aberta e não grava automaticamente.

## Escopo inicial persistível

O primeiro contrato persistente cobre somente `view="overview"`.

Não persistir inicialmente:

- `?foco=` temporário;
- pan/zoom/câmera;
- filtros do usuário;
- node selecionado;
- estado aberto/fechado do inspector;
- largura do inspector;
- preferências específicas de dispositivo;
- positions produzidas por qualquer dragging público sem ação editorial explícita.

A câmera continua responsiva ao viewport, o que evita salvar enquadramentos ruins de desktop e reaplicá-los em mobile ou 4K.

## Coordenadas

As posições persistidas usam o espaço lógico do canvas/React Flow, não pixels de viewport.

O contrato aceita apenas coordenadas finitas dentro de um limite defensivo da aplicação. Valores inválidos, infinitos ou absurdamente distantes são rejeitados/ignorados antes de compor a projection.

O runtime atual usa limite de `±5000` unidades por eixo como proteção de payload e UX; mudar esse limite é detalhe de implementação e não exige migration.

## Evolução do grafo

Um snapshot não precisa possuir exatamente o mesmo conjunto de nodes da projection atual.

Ao ler:

- posição persistida é aplicada somente na interseção entre snapshot e nodes autorizados atuais;
- node novo sem posição usa o seed determinístico;
- node removido/stale é ignorado;
- mudança de edges não apaga automaticamente posições válidas;
- um reset editorial futuro pode regenerar o seed e salvar uma nova revision.

Isso permite evolução incremental sem invalidar toda a composição quando uma entity entra ou sai do grafo.

## Segurança e audience

A autorização narrativa continua anterior ao payload do browser.

Fluxo obrigatório de leitura:

```text
request + identidade/audience
  -> projection autorizada de nodes/edges
  -> carregar/resolver layout editorial aplicável
  -> intersectar positions com IDs já autorizados
  -> emitir WorldGraphProjection mínimo
```

O browser não pode receber posições de nodes secretos para depois descartá-las.

A sanitização do runtime é defesa adicional; ela não substitui o filtro de audience no servidor.

## Escrita editorial

Salvar layout é uma ação administrativa/editorial e deverá seguir ADR-0008:

```text
sessão Auth válida
  -> capability explícita
  -> scope da campanha/projeto aplicável
  -> ownership da campanha validado
  -> optimistic concurrency por revision
  -> escrita + auditoria no mesmo boundary transacional quando a persistência física existir
```

Este ADR não cria nem escolhe o nome definitivo da capability no `permission_catalog`. O nome deve ser aprovado junto com a implementação física para evitar uma string de autorização paralela ao catálogo canônico.

A UI pública `/mundo` não recebe permissão de escrita por simplesmente permitir dragging.

## Concorrência

O snapshot possui `revision` monotônica.

Uma escrita futura precisa informar a revision observada. Se outra edição já tiver produzido revision nova, a operação falha com conflito em vez de sobrescrever silenciosamente o layout mais recente.

A resolução de conflito pode oferecer recarregar/reaplicar mudanças no futuro, mas last-write-wins silencioso não é o contrato.

## Auditoria

Quando a persistência física for implementada, o storage deve permitir identificar pelo menos:

- campaign/scope dono do layout;
- revision atual;
- quem atualizou;
- quando atualizou.

Histórico completo de todas as revisões é desejável, mas não é exigido por este ADR até existir necessidade operacional comprovada. O mínimo é uma escrita auditável e rollback operacional possível.

## Forma física ainda aberta

Este ADR não decide entre:

- snapshot JSONB por campanha/view;
- rows por node + revision de snapshot;
- tabela dedicada + RPC;
- outro formato equivalente no Supabase existente.

A migration futura deve ser proposta pelo owner de dados/Supabase depois que o contrato de aplicação estiver estável e os testes de audience/concurrency estiverem definidos.

Não adicionar coordinates em `entities` nem `entity_relations` como atalho.

## Projection runtime

`WorldGraphProjection` pode carregar opcionalmente um `layout` já filtrado:

```ts
{
  schemaVersion: 1,
  view: "overview",
  revision: 12,
  positions: {
    dandelion: { x: 120, y: -80 }
  }
}
```

O adapter de React Flow aplica esse snapshot sobre o seed determinístico. Overrides locais produzidos pelo dragging da sessão continuam por cima do snapshot.

Focus mode ignora esse layout no primeiro contrato.

## Consequências

### Positivas

- composição editorial pode evoluir sem contaminar canon;
- layout funciona com qualquer viewport porque não persiste câmera;
- nodes novos recebem fallback determinístico;
- stale/hidden IDs podem ser filtrados fail-closed;
- optimistic concurrency fica prevista antes da DDL;
- a UI pública mantém dragging livre sem adquirir poder de escrita.

### Custos

- haverá um storage e mutation boundary adicional no futuro;
- save/reset editorial exigirão UX e capability próprias;
- snapshots precisam ser filtrados junto com a projection;
- migrations futuras precisam preservar revision/auditoria sem acoplar ao React Flow.

## Fora deste recorte

Esta decisão não autoriza:

- migration ou DDL;
- grant/RLS/RPC novos;
- escrita no Supabase;
- persistência automática do dragging público;
- sincronização realtime de múltiplos editores;
- armazenamento de câmera/filtros por usuário;
- promoção de fixture/demo a canon.

## Próximos passos

1. estabilizar o DTO/sanitização e precedence no runtime;
2. expandir inspector e navegação contextual sem depender do storage;
3. definir UX editorial de `Salvar layout`/`Restaurar` dentro do Edit;
4. então propor persistence física + capability + testes de concurrency/audience ao owner de dados/Supabase.
