# ADR-0006 — React Flow como engine de visualização do World Explorer

> Status: aceito
> Data: 2026-09-06
> Owner: frontend / narrative-memory

## Contexto

O TDA precisa de uma superfície para explorar visualmente relações entre personagens, NPCs, lugares, facções, músicas, quests e momentos narrativos.

As referências visuais oficiais aprovadas para o projeto mostram um canvas central de relações, com entity focada, nodes ilustrados, edges rotulados, filtros e inspector lateral.

O legado `Faysk/dnd-scribe` já registrava React Flow como candidato para relações, mas corretamente condicionava a escolha à definição do modelo de entities/relações, visibilidade e acessibilidade.

O reboot já possui:

- registry `entities`;
- canon/evidence;
- visibility;
- RBAC/capabilities;
- documentação de relations/knowledge;
- direção visual oficial para o World Explorer.

A dúvida restante era se a biblioteca de visualização deveria continuar apenas como opção ou ser formalmente adotada.

## Decisão

O TDA adota **React Flow (`@xyflow/react`) como engine de visualização interativa do World Explorer**.

A decisão é deliberadamente limitada à camada de apresentação.

React Flow **não**:

- define o schema do banco;
- define os tipos de relação;
- armazena canon;
- armazena knowledge;
- decide visibilidade;
- decide autorização;
- é fonte de verdade de layout narrativo.

O domínio produz uma projection autorizada de nodes/edges; React Flow renderiza essa projection.

## Versão e licença verificadas

Na revisão de `2026-09-06`:

- pacote: `@xyflow/react`;
- linha atual documentada: React Flow 12;
- release verificada mais recente na documentação oficial: `12.11.3` (2026-08-12);
- licença: MIT, conforme repositório/package oficial do projeto xyflow.

No momento da implementação, a versão deve ser novamente verificada e fixada no lockfile do TDA. Não usar `latest` de forma implícita em produção.

Referências oficiais consultadas:

- `https://reactflow.dev/`;
- `https://reactflow.dev/learn/customization/custom-nodes`;
- `https://reactflow.dev/learn/customization/edge-labels`;
- `https://reactflow.dev/learn/advanced-use/accessibility`;
- `https://reactflow.dev/learn/advanced-use/performance`;
- `https://reactflow.dev/learn/layouting/layouting`;
- `https://github.com/xyflow/xyflow`.

## Por que React Flow

### Custom nodes

Nodes são componentes React normais, compatíveis com retratos, emblemas, estados e labels próprios do TDA.

Isso permite representar:

- PC/NPC;
- lugar;
- facção;
- música;
- quest;
- momento/evento projetado;
- fallback sem arte.

### Custom edges e labels

Relações do TDA precisam de labels semânticos como `Amizade`, `Rivalidade`, `Família`, `Mentor` e `Origem`.

React Flow permite custom edges e conteúdo React fora do SVG via `EdgeLabelRenderer`, suficiente para nossa composição.

### Pan/zoom/selection

Essas interações já são parte da biblioteca e evitam implementar uma camada gráfica inteira do zero.

### Acessibilidade

A biblioteca possui suporte a teclado, nodes/edges focáveis, ARIA roles/attributes e mensagens configuráveis.

Isso não elimina nossa responsabilidade: o TDA manterá lista textual alternativa e inspector/perfil acessíveis.

### Performance

A biblioteca documenta padrões para memoização, evitar subscriptions amplas a `nodes/edges`, esconder/colapsar subconjuntos e simplificar estilos em grafos grandes.

A arquitetura do TDA também reduz volume por padrão usando vizinhança curta em vez do grafo completo.

## Modo público não é editor

Apesar de React Flow ser muito usado para editores de nodes, o World Explorer público é uma experiência de exploração.

Primeiro slice:

- `nodesConnectable = false`;
- sem handles visíveis;
- sem ação de delete;
- sem criação de edges;
- sem edição inline do domínio;
- selection habilitada;
- pan/zoom habilitados;
- foco de entity habilitado;
- dragging persistente desabilitado.

O Edit futuro poderá reutilizar a engine visual com capacidades diferentes, mas edição de relation exigirá autorização e workflow próprios.

## Projection layer

Fluxo obrigatório:

```text
Supabase/domain
  -> authorization/audience filter
  -> graph projection
       nodes[]
       edges[]
  -> React Flow
```

O browser não recebe edges/nodes secretos para depois escondê-los.

A projection deve carregar apenas dados necessários à UI.

Exemplo conceitual:

```ts
type WorldNode = {
  id: string;
  kind: "entity" | "moment";
  entityType?: string;
  label: string;
  imageUrl?: string;
  status?: string;
};

type WorldEdge = {
  id: string;
  source: string;
  target: string;
  relationType: string;
  label: string;
  directed: boolean;
};
```

Esses tipos são projection DTOs, não schema do banco.

## Layout

React Flow não inclui engine de layout própria; a documentação oficial lista opções externas como Dagre, D3 e ELK.

Para o primeiro slice, o TDA **não adicionará outra biblioteca de layout**.

Decisão inicial:

- layout radial próprio;
- entity focada no centro;
- 1-hop padrão;
- 2-hop sob ação explícita;
- distribuição por anéis/setores;
- pequeno ajuste determinístico para colisões;
- posições recalculadas quando o foco muda;
- sem persistência no domínio.

Motivo: combina melhor com a referência oficial do que um organograma hierárquico e mantém dependências pequenas.

Se dados reais mostrarem que o radial não escala, uma ADR futura escolherá/introduzirá engine externa.

## Nodes e edges

`nodeTypes` e `edgeTypes` devem ser declarados fora do componente de canvas ou memoizados, seguindo recomendações de performance da biblioteca.

Os custom components devem consumir somente Design System tokens.

Nenhum node/edge pode ter hexadecimal inline como contrato permanente.

## Cores

O banco não armazena cor de relation como identidade.

`relation_type` fornece semântica; a UI mapeia famílias semânticas para tokens do Design System.

Isso permite alterar light/dark e acessibilidade sem migration.

## Acessibilidade obrigatória

1. nodes selecionáveis por teclado;
2. labels acessíveis e localizados;
3. edges relevantes com nome compreensível;
4. lista textual alternativa de relações;
5. inspector navegável sem canvas;
6. foco visível;
7. não comunicar relação/status apenas por cor;
8. `prefers-reduced-motion` respeitado;
9. mensagens ARIA da biblioteca localizadas para português quando a feature entrar em produção;
10. mobile com controles de toque adequados.

## Performance e escala

O World Explorer não renderiza toda a campanha por padrão.

Política:

- foco atual + 1-hop;
- expansão opcional para 2-hop;
- filtros server-aware;
- nodes/edges memoizados;
- sem gradients/glows animados contínuos em centenas de elementos;
- evitar componente assinando arrays globais de nodes/edges sem necessidade;
- resultados de projection podem ser cacheados por foco/audience/revisão quando seguro.

## SSR/Next

O canvas é uma superfície interativa client-side dentro da aplicação Next.

Páginas editoriais e perfis continuam server-first quando possível.

A escolha de React Flow não transforma o domínio inteiro em Client Components.

O servidor pode fornecer a projection inicial serializável; interação do canvas ocorre no cliente.

## Alternativas consideradas

### SVG/D3 custom do zero

Prós: controle máximo.

Contras: teríamos que reimplementar pan, zoom, selection, edge routing, teclado, focus e várias interações já maduras.

Rejeitado para o primeiro produto.

### D3 Force como engine principal

Útil para redes livres, mas acrescenta uma simulação que não é necessária para a composição radial aprovada e pode produzir instabilidade visual.

Pode ser usado futuramente apenas como apoio/layout, não como substituto obrigatório do React Flow.

### Dagre

Bom para grafos hierárquicos/direcionados, mas a narrativa do TDA é cíclica e centrada na entity selecionada.

Não escolhido para o primeiro slice.

### ELK

Muito poderoso para layouts complexos, porém mais pesado/complexo do que o necessário neste estágio.

Pode ser reavaliado se relações densas exigirem roteamento sofisticado.

## Consequências

### Positivas

- acelera o World Explorer;
- customização suficiente para a identidade TDA;
- reduz implementação gráfica própria;
- mantém domínio independente da biblioteca;
- possibilita reutilização futura no Edit;
- acessibilidade e performance têm base madura.

### Custos

- nova dependência frontend;
- canvas é client-side;
- requer disciplina para não modelar banco com conceitos da biblioteca;
- precisa de projection layer;
- precisa de testes de interação e acessibilidade específicos.

## Critérios antes de instalar o pacote

- relation data contract aprovado o suficiente para fixture/DTO;
- Design System oficial registrado no reboot;
- rota e composição do World Explorer documentadas;
- primeiro dataset de demo separado de canon real;
- plano de testes definido;
- versão do pacote verificada novamente.

## Primeiro slice aprovado

**Dandelion como entity focal**, usando fixtures explicitamente marcadas como demo quando uma relação ainda não for canon confirmada.

O objetivo do slice é validar:

- composição;
- custom nodes;
- custom edges;
- layout radial;
- inspector;
- filtros;
- temas;
- mobile;
- acessibilidade;
- projection boundary.

Persistir relações reais no Supabase é uma etapa posterior e exige o contrato de dados aprovado.