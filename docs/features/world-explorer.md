# Feature — World Explorer / Ecos da Jornada

> Status: arquitetura aprovada; vertical slice visual em implementação
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-07

## Valor

O World Explorer é a superfície que transforma memória estruturada em exploração visual do universo da campanha.

Ele deve permitir responder perguntas como:

- quem está ligado a Dandelion?
- qual é a relação de Screacky com Ivory?
- quais lugares estão ligados a determinado personagem?
- quais músicas, eventos ou quests orbitam uma entity?
- como chegar de uma pessoa/lugar a outra sem ler dezenas de páginas?
- quais momentos importantes pertencem à trajetória dessa entity?

O World Explorer não substitui perfis, lore ou timeline. Ele conecta essas superfícies.

## Nome de produto

Nome de seção recomendado:

**Ecos da Jornada**

Nome técnico/documental:

**World Explorer**

A interface pode usar `Mundo` como item de navegação principal e `Ecos da Jornada` como título editorial da experiência.

## Referências oficiais

- referências visuais aprovadas pelo proprietário em 2026-09-06;
- [Design System oficial](../design-system/README.md);
- [composição visual](../design-system/world-explorer-ui.md);
- [ADR React Flow](../adr/0006-react-flow-world-explorer.md);
- [relations](relations-graph.md);
- [knowledge/audience](knowledge-audience.md);
- legado revalidado em [legacy/README.md](../legacy/README.md).

## Escopo V1

A primeira versão precisa:

1. abrir em `/mundo`;
2. mostrar uma entity focal;
3. mostrar relações diretas autorizadas;
4. permitir selecionar/focar outra entity;
5. filtrar tipos de node/relation relevantes;
6. abrir inspector contextual;
7. navegar ao perfil completo;
8. mostrar lista alternativa de relações;
9. funcionar em light/dark;
10. funcionar em desktop/mobile;
11. respeitar audience/RBAC antes do payload chegar ao browser.

## Fora do escopo V1

- edição de relation pelo canvas;
- criação de entity pelo canvas;
- grafo completo da campanha;
- layout colaborativo persistente;
- multiplayer/realtime cursor;
- physics simulation contínua;
- conhecimento/segredos completos antes do modelo ser aprovado;
- IA gerando edges automaticamente em produção;
- mapa geográfico;
- timeline completa;
- busca semântica em todo o canon.

Essas features podem se integrar depois sem deformar o primeiro slice.

## Rotas

### Canônica

`/mundo`

Pode aceitar estado serializável por query:

```text
/mundo?foco=<slug-ou-id>
/mundo?foco=dandelion&tipo=personagem
```

Não colocar listas gigantes de edge IDs na URL.

### Rotas editoriais derivadas

A navegação pode expor:

- `/personagens`;
- `/personagens/[slug]`;
- `/npcs/[slug]`;
- `/lugares/[slug]`;
- `/faccoes/[slug]`;
- `/musicas/[slug]`;
- `/quests/[slug]`.

Internamente todas podem resolver para `entities`, respeitando `entity_type`.

## Query/projection

O canvas não consulta tabelas narrativas livremente do browser.

Pipeline:

```text
request + identidade/audience
  -> resolver entity focal
  -> consultar relations autorizadas
  -> consultar metadata pública necessária
  -> aplicar filtros
  -> construir projection
  -> enviar DTO mínimo
```

### Node DTO conceitual

```ts
type WorldNodeDTO = {
  id: string;
  slug: string | null;
  kind: "entity" | "moment";
  entityType?: string;
  label: string;
  subtitle?: string;
  imageUrl?: string;
  status?: string;
  route?: string;
};
```

### Edge DTO conceitual

```ts
type WorldEdgeDTO = {
  id: string;
  source: string;
  target: string;
  relationType: string;
  label: string;
  direction: "directed" | "symmetric";
  family?: string;
};
```

Não incluir no DTO público:

- reviewer notes;
- hidden evidence IDs desnecessários;
- confidence interna;
- source transcript privada;
- metadata integral;
- relations secretas;
- dados de profiles que não pertencem à narrativa exibida.

## Focus model

Uma única entity é o foco principal do canvas.

Ao trocar o foco:

1. URL pode ser atualizada sem reload completo;
2. projection é recalculada;
3. layout radial reorienta nodes;
4. inspector acompanha o novo foco;
5. estado de filtros é preservado quando fizer sentido.

Seleção e foco são estados distintos no primeiro slice: selecionar um node atualiza apenas o inspector; promover aquela entity a foco exige a ação explícita `Explorar conexões de ...`, que atualiza `?foco=` e recalcula a projection. Isso evita reorganização inesperada do grafo durante inspeção simples.

## Profundidade

### 1-hop

Default.

Mostra relações diretas do foco.

### 2-hop

Disponível por expansão explícita.

Deve ter limite e filtros para evitar explosão combinatória.

### Full graph

Não é V1.

Se um dia existir, será uma visão especializada e não o default do produto.

## Filtros

Filtros possíveis:

- todos;
- PCs/personagens;
- NPCs;
- lugares;
- facções/organizações;
- músicas;
- quests;
- momentos/eventos projetados;
- famílias de relação;
- status temporal/ativo.

Filtro de UI nunca substitui filtro de autorização.

## Busca

Busca global deve ser permission-aware.

### Resultado entity

Selecionar resultado:

- navega/foca no World Explorer; ou
- abre perfil completo conforme ação.

### Resultado sessão/momento

Pode abrir a sessão ou, futuramente, projetar um moment node.

## Inspector

O inspector recebe a entity/moment selecionado.

### Dados mínimos

- título;
- subtítulo;
- imagem;
- tags editoriais autorizadas;
- resumo;
- relations em destaque;
- CTA para detalhe.

### Relações em destaque

Critério não deve ser simplesmente “primeiras 5 linhas do banco”.

Possíveis sinais futuros:

- relation marcada editorialmente;
- relevância narrativa;
- atividade recente;
- relação com foco atual;
- importância canônica.

No primeiro slice, fixture explícita é suficiente.

## Perfil completo de entity

O perfil editorial é uma feature irmã.

Estrutura futura provável:

- hero;
- overview;
- canon/lore;
- relações;
- momentos;
- timeline;
- sessões;
- músicas;
- galeria;
- knowledge autorizado quando existir.

O inspector é resumo, não duplicação da página inteira.

O vertical slice não duplica o roteamento preparado pela frente Lore. Enquanto a PR de Lore permanecer draft, `route` fica opcional e o inspector mostra o estado pendente; depois da integração, o World Explorer deve reutilizar o resolver canônico de Lore em vez de introduzir um segundo mapa de `entityType -> rota`.

## Relations

World Explorer consome relações first-class.

Não derivar edge canônico diretamente de:

- duas entities mencionadas no mesmo segmento;
- embeddings semelhantes;
- LLM sugerindo vínculo;
- artwork mostrando personagens juntos;
- fixture visual.

O modelo de dados está em [relations-data-contract.md](relations-data-contract.md).

## Moments/eventos

A referência visual inclui itens que funcionam melhor como momento/evento do que entity.

Decisão:

- não adicionar `event` a `entities` só para satisfazer o canvas;
- momentos podem ser projections de sessão/canon entry/contrato futuro;
- o mesmo canvas aceita `kind=moment` sem alterar a registry narrativa.

## Música

Música pode existir como `entities(type=song)`.

Uma performance específica de uma música em determinada sessão pode ser um moment/canon relation, não outra song entity obrigatoriamente.

## Segurança e knowledge

O World Explorer é uma das superfícies mais sensíveis do produto porque conexões podem revelar segredos mesmo quando textos individuais parecem inofensivos.

Exemplo:

Mostrar um edge `serve_a` entre um NPC e um vilão pode revelar mais do que mostrar os dois nomes isoladamente.

Portanto autorização é aplicada em:

- node;
- edge;
- label;
- inspector;
- busca;
- relation list;
- paths/expansion.

O servidor deve assumir que **a própria existência da relação pode ser segredo**.

## Semântica de “quem sabe”

O World Explorer V1 mostra a visão permitida ao usuário, não necessariamente tudo que o personagem sabe na ficção.

Quando [knowledge-audience.md](knowledge-audience.md) for implementado, poderemos oferecer perspectivas como:

- visão pública;
- visão da mesa;
- visão de um personagem;
- visão DM.

Isso exige consulta authorization-aware e não pode ser simulado escondendo nodes no cliente.

## Acessibilidade

### Relação textual alternativa

Toda graph projection deve ter uma representação textual acessível, por exemplo:

```text
Dandelion
- é companheiro de Screacky
- é amigo de Astel
- tem vínculo com O Reino Vai Cantar
```

A lista pode aparecer no inspector ou em view alternável.

### Teclado

- foco entra no canvas de forma previsível;
- nodes têm accessible name;
- Enter/Space seleciona quando aplicável;
- Escape fecha inspector/drawer quando apropriado;
- foco não fica preso no canvas.

## Mobile

Contrato:

- canvas permanece utilizável;
- inspector vira bottom sheet/drawer;
- filtros não ocupam múltiplas linhas permanentemente;
- search pode virar overlay;
- sidebar não fica fixa;
- controles têm alvos >= 44px quando essenciais;
- relation list é alternativa natural ao canvas.

## Empty/loading/error

### Sem relações

Não mostrar canvas vazio sem explicação.

Exemplo:

> Ainda não há relações publicadas para esta memória.

### Loading

Skeleton discreto; não desenhar nodes fake como se fossem dados reais.

### Erro

Oferecer retry e navegação por lista/perfil.

### Entity inexistente/privada

Responder como não disponível conforme boundary de segurança; não revelar que existe mas é secreta.

## Primeiro slice: Dandelion

Objetivo do protótipo/vertical slice:

- route `/mundo`;
- Dandelion como foco default/demo;
- 10–15 nodes;
- custom entity node;
- custom relation edge;
- layout radial;
- inspector;
- filtros básicos;
- light/dark;
- mobile bottom sheet;
- relation list acessível;
- sem escrita no Supabase.

### Fixtures

Dados de fixture devem viver separados de dados reais e ser marcados como demonstração.

Uma relação desenhada na referência não é automaticamente canon.

### Estado do recorte em implementação

O recorte visual iniciado em `feat/world-explorer-visual-slice` usa somente fixture explícita em `src/features/world-explorer/fixtures/dandelion.ts`. O código separa DTO/projection, layout radial puro, adapter React Flow e componentes de apresentação. A rota `/mundo` resolve `?foco=` no servidor e entrega somente a projection 1-hop para o cliente; filtros do protótipo operam sobre essa projection já limitada.

A versão de `@xyflow/react` foi revalidada em 2026-09-07 antes da implementação: `12.11.6`, linha 12.x suportada e licença MIT. O pacote é fixado exatamente, conforme a política do repositório. O lockfile ainda precisa ser regenerado pelo `pnpm` canônico antes de a PR ser considerada validada.

Este recorte não altera root layout, rotas de Lore, Supabase, relations, RLS, DNS ou deployment. A integração com perfis completos permanece deliberadamente pendente do resolver canônico da frente Lore.

## Critérios para ligar ao Supabase

Antes de substituir fixtures por relations reais:

- migration de relations revisada;
- seed/backfill com fonte conhecida;
- RLS/autorização testadas;
- nenhuma relation criada apenas por coocorrência;
- relation types estáveis;
- queries por 1-hop indexadas;
- profile/slug resolution consistente;
- tests com visão DM/player/public.

## Métricas futuras

A feature deve ser avaliada por utilidade, não por quantidade de edges.

Métricas possíveis:

- tempo para localizar uma entity;
- taxa de clique para perfil;
- número de mudanças de foco por sessão de navegação;
- uso de filtros;
- performance com 20/50/100 nodes em dataset de teste;
- acessibilidade/keyboard completion;
- ausência de vazamento em testes de audience.

## Critério de pronto V1

Validação de suporte em 2026-09-07: lockfile regenerado por pnpm 12.3.4, grupo de filtros convertido em `fieldset` acessível e catálogo documental regenerado. `pnpm check` (59 testes unitários), build e 45 E2E passaram localmente em Node 24.20.0, incluindo foco, filtros, metadata e largura mínima de 320 px. Revisão visual local em desktop e 390 px confirmou a composição dos filtros. Permanecem três avisos de especificidade CSS, sem bloqueio de lint; esta evidência não representa merge, deploy ou validação de dados reais. A integração central de imagem/metadata continua sob seu ownership próprio.

Um usuário autorizado consegue abrir `/mundo`, compreender visualmente as relações diretas de uma entity, navegar para outra, consultar detalhes e chegar ao perfil completo sem depender do grafo como única fonte e sem receber dados fora de sua audience.
