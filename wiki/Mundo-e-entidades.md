# 🌍 Mundo, personagens e entidades

O TDA procura conectar informações de um universo de RPG: **pessoas da história, lugares, facções, objetos, músicas, acontecimentos e relações**. Essa organização tem um modelo de dados, mas só informações autorizadas e suficientemente revisadas devem chegar ao público.

## O que é o World Explorer?

É uma forma visual de descobrir conexões, também chamada de **Ecos da Jornada**. Em vez de ler páginas isoladas, você pode navegar entre elementos relacionados do mundo.

~~~mermaid
flowchart TD
  A["Campanha"] --> B["Personagens"]
  A --> C["Lugares"]
  A --> D["Eventos e sessões"]
  B --> E["Relações revisadas"]
  C --> E
  D --> F["Fontes e evidências"]
  F --> G["Revisão humana"]
  G --> E
~~~

**Atenção:** esse diagrama é conceitual, não o retrato de um grafo real de campanha. O contrato do World Explorer distingue visualização da existência de relações reais publicadas.

## Como explorar

1. Abra [Mundo](https://dnd.faysk.dev/mundo) ou a rota de Mundo disponibilizada pela campanha.
2. Navegue pelos agrupamentos e elementos visíveis.
3. Selecione um elemento para ler o contexto autorizado.
4. Quando houver link canônico para um perfil, continue a leitura por ele.

Reorganizar visualmente elementos no canvas não significa alterar uma relação da história. Editar fatos/relações é um fluxo editorial diferente e exige permissão, fonte e revisão.

## Personagens, NPCs e outras entidades

**PC** é uma personagem de jogador; **NPC** é personagem não controlada como um PC. O catálogo canônico também considera locais, organizações, facções, itens, arcos, quests, músicas e conceitos. Nem todos os tipos possuem necessariamente página pública completa ou dados revisados na campanha atual.

## O que significa “canon”?

~~~mermaid
flowchart LR
  F["Fonte identificada"] --> C["Candidato"]
  C --> H["Revisão humana"]
  H --> A{"Aprovado?"}
  A -->|Sim| K["Canon ou publicação autorizada"]
  A -->|Não| R["Não aprovado / outra classificação"]
~~~

Uma informação gerada por IA ou citada em uma conversa não vira canon por aparecer num grafo. O TDA registra a **proveniência**, isto é, de onde saiu a informação, e a **audiência**, isto é, quem pode vê-la.

**Fontes:** [World Explorer](https://github.com/Faysk/tda/blob/main/docs/features/world-explorer.md), [entidades](https://github.com/Faysk/tda/blob/main/docs/domains/entities.md), [canon/revisão](https://github.com/Faysk/tda/blob/main/docs/domains/canon-review.md) e [audiência](https://github.com/Faysk/tda/blob/main/docs/features/knowledge-audience.md).

Continue: [Lores, diários e referências](https://github.com/Faysk/tda/wiki/Lores-e-Lembra)
