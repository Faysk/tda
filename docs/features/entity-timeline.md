# Feature — Timeline por entidade

> Status: preparado
> Owner: narrative-memory
> Última revisão: 2026-09-06

## Valor

Responder "quando esse personagem/local/item apareceu, foi mencionado ou teve canon alterado?" com links para sessões/fontes.

## Base existente

- `participants.character_entity_id` — aparição representada por participant;
- `entity_mentions` — menções em session/segment/Roll20;
- `canon_entries.entity_id` — memória aprovada;
- sessions com data/start/duration;
- transcript offsets/event timing.

## Tipos de evento da timeline

A primeira versão pode derivar views sem nova tabela:

- participant appearance;
- mention;
- approved canon entry;
- publication relevante;
- futuramente relation/knowledge changes.

## Regra de autoridade

Visualmente distinguir:

- **aparição/ocorrência**;
- **menção**;
- **fato canônico**.

Não mostrar toda mention como se entity estivesse fisicamente presente.

## Ordenação

Preferência:

1. `session_date/started_at`;
2. offsets dentro da session quando existentes;
3. fallback documentado para items sem timing preciso.

## Audience

A query deve filtrar cada evento conforme permission/visibility. Não buscar timeline completa no browser e esconder entries secretas localmente.

## UX mínima

- entity header;
- filtros por event type;
- agrupamento por session/data;
- link para session/source quando permitido;
- badge de canon/mention/appearance;
- empty state.

## Critérios de aceite

- os 4 participants históricos de cada PC aparecem corretamente;
- mentions vazias não quebram timeline;
- canon vazio não inventa eventos;
- ordem estável;
- public/player/DM recebem eventos autorizados diferentes quando necessário;
- paginação para crescimento futuro.

## Futuro

Relations, knowledge changes, quests e locations podem contribuir eventos depois que seus contratos forem aprovados.
