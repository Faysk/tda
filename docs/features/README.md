# Especificações de features

> Status: vivo
> Owner: produto + domínios
> Última revisão: 2026-09-06

O [catálogo de features](../feature-catalog.md) responde **qual é o status**. Este diretório responde **o que a feature significa, quais dados usa, o que falta decidir e qual é o critério para implementá-la sem quebrar o modelo**.

## Índice

| Feature | Estado | Spec |
| --- | --- | --- |
| PCs/NPCs | preparado | [Personagens e NPCs](characters-and-npcs.md) |
| relations/grafo | em desenho | [Relações e grafo](relations-graph.md) |
| knowledge/audience | em desenho | [Conhecimento e audiência](knowledge-audience.md) |
| timeline por entity | preparado | [Timeline](entity-timeline.md) |
| busca semântica | em desenho | [Busca semântica](semantic-search.md) |
| mapas | em desenho | [Mapas](maps.md) |
| músicas/performances | preparado/em desenho | [Músicas](music-performances.md) |
| quests/hooks | preparado/em desenho | [Quests](quests-hooks.md) |
| sessão ao vivo | histórico/planejado | [Live session](live-session.md) |
| assistente Discord | histórico/planejado | [Discord assistant](discord-assistant.md) |
| intents/intenção | não definido | [Intents](intents.md) |

## Template mínimo para feature futura

Toda spec deve registrar:

- problema/valor;
- status;
- dependências;
- dados existentes reutilizáveis;
- novo schema necessário, se houver;
- authorization/audience;
- fonte/canon quando narrativo;
- UX mínima;
- failure modes;
- critérios de aceite;
- não objetivos;
- decisões pendentes.

## Regra de execução

`em desenho` não autoriza migration. Quando decisões pendentes forem fechadas:

1. atualizar spec;
2. atualizar feature catalog/roadmap;
3. ADR se estrutural;
4. migration/API/UI;
5. testes;
6. mudar status com evidência.
