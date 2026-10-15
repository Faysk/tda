# 🌍 Como explorar o World Explorer

> **Para quem:** quem quer descobrir relações entre personagens, lugares e acontecimentos sem conhecer o banco de dados. **Estado:** fundamentos multi-hub implementados; relações reais publicadas ainda dependem de fontes revisadas, autorização e projeções habilitadas.

## O que é “Ecos da Jornada”?

O **World Explorer**, chamado de **Ecos da Jornada** na experiência, é um mapa de informações narrativas. Cada elemento do mapa representa uma entidade do universo de uma campanha: um personagem, lugar, organização ou outro conceito. Uma conexão só deve mostrar relações permitidas ao leitor.

Não é um mapa geográfico: aproximar ou arrastar nós ajuda a explorar a visualização, mas **não altera a história oficial**.

## Como navegar

1. Abra [Mundo](https://dnd.faysk.dev/mundo), ou a área Mundo disponível dentro da campanha.
2. Observe os agrupamentos visíveis. A visão inicial pode ter **mais de um protagonista ou núcleo**: nenhum precisa ser sempre o centro.
3. Escolha uma entidade. Quando houver dados autorizados, o **inspector** oferece contexto.
4. Use foco, busca e filtros quando disponíveis no ambiente. Um foco solicitado por URL não concede autorização.
5. Quando existir uma rota válida, siga para o perfil editorial completo. Se não houver dados reais suficientes, a interface pode mostrar demonstração ou estado vazio, devidamente identificado.
6. Em telas pequenas ou usando teclado, utilize a alternativa de relações em lista, caso essa superfície esteja disponível.

**Atenção:** arrastar um nó pode modificar **apenas as posições locais**. Um layout editorial salvo, por outro lado, é um snapshot de apresentação autorizado e versionado — também não é canon. Criar uma relação verdadeira exige outro fluxo de dados e revisão.

## De onde vêm as ligações?

~~~mermaid
flowchart TD
  E["Fontes identificadas"] --> C["Candidatos de entidades/relações"]
  C --> R["Revisão de fonte e canon"]
  R --> D["Dados canônicos autorizados"]
  D --> P["Filtro servidor: campanha e audiência"]
  P --> G["Nós e conexões enviados ao navegador"]
  G --> V["Mapa e inspector"]
~~~

O fluxo representa o **contrato pretendido para informações reais**. Nem todas as relações que aparecem num ambiente demonstrativo vieram de dados canônicos. A existência de duas personagens numa mesma transcrição **não autoriza** criar uma conexão automaticamente.

## Um segredo pode aparecer no mapa?

O servidor deve filtrar o conteúdo **antes** de enviá-lo ao navegador. Esconder com CSS uma conexão já enviada é insuficiente, pois a própria existência daquela ligação pode revelar um segredo.

A audiência técnica de uma informação é diferente do que uma personagem sabe na história. Por exemplo, um jogador pode ter acesso a uma interface sem que seu personagem tenha descoberto determinado fato. O modelo amplo de crenças/rumores e conhecimentos narrativos ainda está em desenho.

| Termo | O que é |
| --- | --- |
| **Nó** | Entidade que pode aparecer no mapa |
| **Relação** | Conexão entre entidades, com tipo e proveniência |
| **Inspector** | Painel de contexto do elemento selecionado |
| **Foco** | Escolha temporária do que explorar |
| **Layout** | Como os nós aparecem posicionados |
| **Audience** | Quais dados podem ser enviados ao público atual |

## Se não encontrar a relação procurada

Isso não significa que a história tenha sido apagada. A relação pode não existir como dado revisado, pertencer a outra audiência, depender de projeção ainda não habilitada ou ainda estar em trabalho editorial. A Wiki não inventa personagens ou relações para preencher lacunas.

**Fontes canônicas:** [World Explorer](https://github.com/Faysk/tda/blob/main/docs/features/world-explorer.md), [Projeções do grafo](https://github.com/Faysk/tda/blob/main/docs/architecture/data-flows.md), [Relações](https://github.com/Faysk/tda/blob/main/docs/features/relations-graph.md), [Audiência e conhecimento](https://github.com/Faysk/tda/blob/main/docs/features/knowledge-audience.md) e [ADR-0009](https://github.com/Faysk/tda/blob/main/docs/adr/0009-world-explorer-multihub-layout.md).

Continue: [Entidades e conceitos](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) · [Quem pode ver o quê](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes) · [Estágios de funcionalidades](https://github.com/Faysk/tda/wiki/Funcionalidades-e-estados)
