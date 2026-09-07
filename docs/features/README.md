# Especificações de features

> Status: vivo
> Owner: produto + domínios
> Última revisão: 2026-09-07

O [catálogo de features](../feature-catalog.md) responde **qual é o status**. Este diretório responde **o que a feature significa, quais dados usa, o que falta decidir e qual é o critério para implementá-la sem quebrar o modelo**.

## Índice

| Feature | Estado | Spec |
| --- | --- | --- |
| Edit Workbench / administração | implementação incremental | [Edit Workbench](edit-workbench.md) |
| Edit / transcript server-side | leitura autorizada implementada; mutation canônica aguarda revision | [Slice server-side de transcrição](edit-transcript-server-slice.md) |
| Edit / bypass temporário | workbench funcional sem Auth por flag explícita | [Modo temporário sem autenticação](edit-unsafe-development.md) |
| PCs/NPCs | preparado | [Personagens e NPCs](characters-and-npcs.md) |
| perfis editoriais de entities | preparado; projection publicada pendente | [Entity profiles](entity-profiles.md) |
| World Explorer / Ecos da Jornada | arquitetura aprovada | [World Explorer](world-explorer.md) |
| relations/grafo | arquitetura visual aprovada; schema em desenho | [Relações e grafo](relations-graph.md) |
| contrato de dados de relations | proposta para revisão | [Relations data contract](relations-data-contract.md) |
| knowledge/audience | em desenho | [Conhecimento e audiência](knowledge-audience.md) |
| timeline por entity | preparado | [Timeline](entity-timeline.md) |
| busca semântica | em desenho | [Busca semântica](semantic-search.md) |
| mapas | em desenho | [Mapas](maps.md) |
| músicas/performances | preparado/em desenho | [Músicas](music-performances.md) |
| quests/hooks | preparado/em desenho | [Quests](quests-hooks.md) |
| sessão ao vivo | histórico/planejado | [Live session](live-session.md) |
| assistente Discord | histórico/planejado | [Discord assistant](discord-assistant.md) |
| intents/intenção | não definido | [Intents](intents.md) |

## Design e visualização

Features com superfície visual forte devem apontar para o [Design System oficial](../design-system/README.md).

O World Explorer possui também um contrato de composição em [world-explorer-ui.md](../design-system/world-explorer-ui.md).

Os perfis editoriais mantêm o próprio contrato de apresentação, scenes/beats e narração em [Entity profiles](entity-profiles.md), sem documento paralelo que duplique ownership.

O Edit usa o mesmo Design System e possui boundary técnico próprio em [arquitetura do Edit](../architecture/edit-workbench.md), com paridade histórica rastreada em [Edit — paridade com o legado](../legacy/edit-parity.md). A exceção transitória que permite validar a UI antes de Auth está isolada em [modo temporário sem autenticação](edit-unsafe-development.md).

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

`arquitetura aprovada` também não implica schema ou código em produção: significa que o boundary e a direção já foram aceitos, mas a implementação ainda precisa cumprir seus critérios de aceite.
