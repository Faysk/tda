# Feature — Mapas narrativos

> Status: em desenho
> Owner: narrative-memory/maps
> Última revisão: 2026-09-06

## Valor

Navegar geograficamente lugares, eventos, NPCs, quests, perigos e memórias da campanha.

## Base existente

- `entities(type=location)`;
- sessions;
- mentions/canon;
- relations futuras.

Não existe contrato canônico de coordenadas/geometria/provider.

## Perguntas a decidir

O mapa da campanha é:

- mapa real com latitude/longitude?
- imagem desenhada com coordenadas relativas?
- múltiplos mapas/continentes/cidades?
- hierarquia de locations?
- mistura de mapa geográfico e diagrama?

Essas opções exigem modelos diferentes. Não criar `lat/lng` até saber qual realidade precisa ser representada.

## Modelo conceitual possível

Se for mapa de imagem:

- map asset/version;
- location entity;
- normalized X/Y;
- zoom/layer;
- visibility;
- validity/history.

Se for geográfico, considerar geometry apropriada apenas após requirement real.

## Pins

Pin é representação de entity/event, não identity nova. Pode referenciar:

- location;
- session event;
- quest;
- NPC;
- danger;
- performance/memory.

## Audience

Mapa de DM pode conter lugares/objetivos secretos. Queries devem filtrar antes do browser.

## UX

- pan/zoom;
- seleção de pin;
- filtros;
- link para entity/session;
- alternativa em lista acessível;
- mobile/touch.

## Critérios antes da implementação

- fonte real de mapa localizada/autorizada;
- tipo de coordenada definido;
- assets/storage definidos;
- exemplos reais de pins;
- audience definida;
- provider/lib avaliado na versão atual.

## Não fazer agora

- adotar Google Maps/Mapbox sem necessidade confirmada;
- colocar coords genéricas em metadata;
- tornar mapa única forma de navegar locations;
- expor pins secretos no client e escondê-los visualmente.
