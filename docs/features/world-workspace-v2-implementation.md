# World Workspace v2 — plano de implementação

> Status: em implementação
> Owner: product / frontend / narrative-memory
> Início: 2026-09-10
> Branch inicial: `refactor/world-workspace-foundation`

## Objetivo

Evoluir `/mundo` de uma página com grafo encaixado em shell estrutural para uma **workspace canvas-first**, mantendo React Flow como engine e preservando os contratos canônicos, de audience, authorization, draft, lease e publicação já existentes.

A referência de interação é a gramática de ferramentas maduras de canvas: o canvas é a superfície principal; UI frequente fica disponível de forma compacta; UI contextual aparece no contexto; painéis fechados não consomem área útil; ações raras ficam em menus/popovers/command layer.

O resultado deve manter a identidade visual do TDA e a semântica narrativa do World Explorer. O objetivo não é copiar pixels do Excalidraw nem transformar o Mundo em um editor técnico genérico.

## Princípios não negociáveis

1. React Flow continua sendo a engine de interação/renderização do grafo.
2. Canon, audience, visibility, authorization, capabilities, leases, drafts e publicação não migram para a camada React Flow/UI.
3. `/mundo` pode ter shell especializado; páginas como `/personagens`, `/npcs`, `/lugares`, `/faccoes` e `/musicas` continuam usando o `WorldSectionLayout` enquanto isso fizer sentido.
4. Navegação e inspector fechados devem consumir `0px` de área do canvas por padrão.
5. Seleção transitória não deve forçar recomputação de layout/routing do grafo inteiro.
6. Preferências de workspace (painel aberto/dockado, largura, MiniMap etc.) não pertencem ao layout editorial canônico.
7. Nenhum merge, deploy, migration, grant de capability ou alteração canônica é parte automática desta evolução.
8. Mudanças visuais relevantes exigem validação em 1920×1080, 1366×768, 390×844 e 320×800.

## Camadas arquiteturais

### 1. Domínio e segurança

Responsável por canon, audience, capabilities, Supabase, leases, drafts e publicação.

Esta camada não conhece React Flow nem chrome de workspace.

### 2. Projection e layout

Responsável por projection autorizada, constellation layout, layout editorial, edge routing e adapters para React Flow.

### 3. Estado e comandos da workspace

Responsável por seleção transitória, busca, filtros, view, painéis, preferência de dock e command registry.

Estado local da workspace não substitui projection ou estado editorial server-side.

### 4. Canvas engine

Responsável por React Flow, viewport, nodes, edges, pan, zoom, drag, Controls e MiniMap.

### 5. Workspace UI

Responsável por toolbar, navegação, busca, filtros, inspector, status editorial, NodeToolbar e EdgeToolbar.

### 6. Experiência e qualidade

Responsável por responsive, mobile, acessibilidade, semantic zoom, performance, motion e testes.

## Fases

### Fase 1 — Fundação sem redesign

Objetivo: preparar a arquitetura interna mantendo a aparência e o comportamento atuais o máximo possível.

Entregas:

- extrair o lifecycle editorial do `WorldExplorerClient` para uma unidade dedicada (`useWorldEditSession` ou equivalente);
- introduzir `ReactFlowProvider` em uma raiz que permita chrome externo usar hooks/instância do React Flow;
- separar `WorldCanvas` da composição principal;
- extrair o modelo de navegação do Mundo para ser compartilhado entre shell atual e futura workspace;
- preparar um store por instância para estado transitório da workspace;
- preparar um command registry sem exigir Command Palette nesta fase;
- manter os testes funcionais atuais verdes.

Fora da fase:

- mudança de banco;
- mudança de projection/canon;
- redesign amplo;
- otimização de handles/edges.

### Fase 2 — World Workspace shell

Objetivo: tornar `/mundo` uma workspace especializada e canvas-first.

Entregas:

- `/mundo` deixa de depender do rail estrutural do `WorldSectionLayout`;
- canvas ocupa toda a área útil restante após o header global;
- footer não ocupa a experiência da workspace;
- evitar `height: calc(100dvh - Npx)` baseado em números mágicos;
- navegação e inspector deixam de reservar espaço quando fechados;
- preservar URL, SSR metadata, audience e capabilities atuais.

### Fase 3 — Floating chrome

Objetivo: substituir linhas permanentes de controles por UI flutuante e progressiva.

Entregas:

- `Panel`/overlays para toolbar principal;
- busca compacta;
- filtros + legenda em superfície única sob demanda;
- navegação do Mundo como overlay/drawer;
- Controls integrados à linguagem visual TDA;
- MiniMap responsiva/opcional;
- comandos de fit/reorganizar/view acessíveis pelo command layer.

### Fase 4 — Contexto e inspector

Objetivo: tornar seleção e inspeção contextuais sem reduzir o canvas.

Entregas:

- inspector overlay com `0px` fechado;
- abertura pela seleção;
- dock opcional apenas quando houver espaço real;
- `NodeToolbar` para ações curtas;
- `EdgeToolbar` para ações curtas de relação;
- seleção continua diferente de foco explícito (`?foco=`);
- lista textual alternativa continua disponível.

### Fase 5 — Conduzir

Objetivo: integrar autoria factual/editorial à workspace sem transformar o modo público em painel administrativo.

Entregas:

- chrome muda claramente entre explorar e Conduzir;
- `WorldContentEditor` passa a ocupar o inspector/drawer editorial;
- seleção de node/edge abre contexto editorial correspondente;
- status de draft compacto;
- publicar/descartar permanecem ligados ao lifecycle já existente;
- conflito, lease lost e erros continuam tratados com destaque apropriado.

### Fase 6 — Escala e performance

Objetivo: preparar o grafo para datasets mais densos sem sacrificar identidade visual.

Entregas:

- separar topologia/layout de seleção/highlight transitório;
- evitar rebuild global do graph apenas por selecionar um node;
- memoização e selectors específicos;
- adjacency/index para connected/highlight quando necessário;
- fixtures/stress de 50, 100 e 200 nodes;
- semantic/contextual zoom;
- benchmark dos handles atuais (40 por node) e alternativas;
- revalidar o workaround de edge SVG no Chrome/React Flow atuais antes de simplificá-lo.

### Fase 7 — Mobile, acessibilidade e polimento

Objetivo: fechar a experiência como produto.

Entregas:

- drawer/bottom sheet mobile;
- touch targets >= 44px;
- keyboard/focus management;
- ARIA em português alinhada ao comportamento real do TDA;
- `prefers-reduced-motion`;
- dark/light;
- 320px sem overflow horizontal;
- validação visual e funcional nas quatro viewports-alvo.

## Arquitetura alvo indicativa

```text
src/features/world-explorer/
├── components/
│   ├── world-workspace-client.tsx
│   ├── world-canvas.tsx
│   ├── world-workspace-toolbar.tsx
│   ├── world-navigation-menu.tsx
│   ├── world-search.tsx
│   ├── world-filters.tsx
│   ├── world-inspector-drawer.tsx
│   ├── world-node-toolbar.tsx
│   ├── world-edge-toolbar.tsx
│   ├── world-edit-status.tsx
│   ├── entity-node.tsx
│   ├── relation-edge.tsx
│   ├── world-inspector.tsx
│   └── world-content-editor.tsx
├── hooks/
│   ├── use-world-edit-session.ts
│   └── use-world-commands.ts
├── state/
│   ├── world-workspace-store.ts
│   ├── world-selection-index.ts
│   └── world-commands.ts
├── adapters/react-flow.ts
├── projection.ts
├── constellation-layout.ts
├── edge-routing.ts
└── ...
```

Os nomes são indicativos. Separação de responsabilidade é mais importante do que reproduzir esta árvore literalmente.

## Contratos que devem permanecer verdadeiros

- seleção simples não altera URL;
- foco explícito continua usando `?foco=<slug>`;
- filtros atuam sobre projection e não criam verdade canônica;
- nenhum conteúdo fora da audience autorizada chega ao browser;
- nodes/edges públicos não ganham mutation por causa da nova UI;
- edição continua protegida por capability + lease + draft + publish;
- layout editorial continua separado de facts/relations;
- drag público não vira persistência automática;
- lista textual permanece alternativa ao canvas.

## Testes e gates

### Gate da Fase 1

- suíte atual do World Explorer continua verde;
- nenhuma mudança de banco/auth;
- comportamento público equivalente.

### Gate da Fase 2/3

Em 1366×768:

- canvas começa praticamente após o header;
- canvas ocupa toda a altura útil restante;
- navegação fechada não reduz canvas;
- inspector fechado não reduz canvas;
- abrir overlay não altera o bounding box do canvas;
- página não ganha scroll estrutural por causa do workspace.

### Gate mobile

Em 390×844 e 320×800:

- canvas permanece acessível imediatamente;
- menu é drawer;
- inspector é sheet/drawer;
- targets interativos >= 44px;
- nenhum overflow horizontal.

### Gate de performance

Medir pelo menos 50/100/200 nodes com dataset sintético representativo antes de declarar otimizações concluídas.

## Sequência de entrega

A ordem recomendada é Fase 1 → 2 → 3 → 4 → 5 → 6 → 7.

Mudanças de experiência podem ser divididas em PRs menores desde que preservem os contratos acima. Não misturar deliberadamente refatoração de shell, mudança de banco e otimização de routing no mesmo incremento.
