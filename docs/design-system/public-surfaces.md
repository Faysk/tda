# Superfícies públicas — ownership visual e composição

> Status: implementado; atualizado após Home V2 e shell responsiva
> Owner: design-system / frontend público
> Última revisão: 2026-09-07

## Objetivo

Definir onde cada responsabilidade visual do frontend público do TDA vive depois da migração para o Design System v1.0 e das evoluções de Home/shell feitas no reboot.

Este documento existe para impedir dois problemas recorrentes:

1. `globals.css` voltar a acumular regras de páginas e componentes;
2. novas features, especialmente o World Explorer, criarem um segundo sistema visual paralelo.

## Regra principal

**Global define contrato; módulo define composição.**

Tokens e primitives são compartilhados. Layout específico de uma superfície pertence à superfície.

## Camadas

| Arquivo / módulo | Responsabilidade | Não deve conter |
| --- | --- | --- |
| `src/app/globals.css` | reset mínimo e invariantes HTML | cards, hero, sessões, World Explorer, cores locais |
| `src/app/design-tokens.css` | tokens canônicos e extensões aprovadas, incluindo shell/gutter | composição de páginas |
| `src/app/design-system.css` | primitives visuais compartilhadas | layout de Home/sessão/feature específica |
| `src/app/public-shell.css` | header, nav pública, footer, skip-link, container público genérico | hero, cards de conteúdo, grafo |
| `src/app/theme.css` | controle binário de tema e troca dos masters black/white da marca | overrides de cards/páginas |
| `src/app/home.module.css` | composição exclusiva da Home e seus teasers | cards reutilizáveis do arquivo |
| `src/components/session-list.module.css` | cards/listagem reutilizável do arquivo de sessões | layout da Home ou do arquivo |
| `src/app/sessoes/page.module.css` | composição do arquivo | estilos internos dos cards |
| `src/app/sessoes/[id]/page.module.css` | hero e navegação do detalhe | parser/estilos do Markdown |
| `src/app/story.css` | leitura longa emitida por `StoryMarkdown` | hero, paginação, shell |

## Reset global

`globals.css` deve continuar pequeno.

Responsabilidades permitidas:

- `box-sizing`;
- mínimos estruturais de `html/body/main`;
- comportamento base de links;
- herança de fonte de controles;
- limites seguros de mídia;
- seleção de texto.

Se uma regra menciona uma feature, card, hero, sessão, entity, node ou página, ela provavelmente não pertence ao reset.

## Container público

O `<main>` global **não possui `max-width`**. Cada superfície decide sua largura.

O shell público usa as extensões de layout do reboot:

```css
--ds-layout-max: 2160px;
--ds-page-gutter: clamp(20px, 3.5vw, 72px);
```

Consequências:

- em 1920×1080 a superfície pública aproveita a largura disponível, preservando apenas o gutter fluido;
- em 2560×1440 o shell cresce até `2160px`, evitando tanto o antigo corredor de `1200px` quanto linhas excessivamente longas;
- Home, header, footer e `.page-section` compartilham a mesma referência horizontal;
- narrativa longa continua trabalhando em aproximadamente `880px` por decisão da superfície;
- `/mundo` poderá ocupar sua própria viewport ampla e não deve herdar um limite global do `<main>`.

## Home V2

A Home usa os primitives:

- `Eyebrow`;
- `DisplayTitle`;
- `BodyCopy`;
- `SectionTitle`;
- `ActionLink`.

A composição atual tem dois níveis de conteúdo.

### Primeira dobra

O hero deixou de ser uma imagem full-bleed com headline dominante e passou a ser uma composição editorial em duas colunas no desktop:

1. identidade/proposta do TDA (`Rolamos dados. Guardamos os dados.`);
2. última sessão publicada como conteúdo real, com artwork, arco, data, título, resumo e CTA.

Abaixo de `980px` essa composição empilha em uma coluna. A intenção é preservar leitura e protagonismo da artwork sem transformar mobile em uma miniatura do desktop.

Quando não há sessão disponível, o mesmo espaço recebe um estado de arquivo. Falha temporária de dados e arquivo ainda não configurado/vazio são mensagens diferentes; a interface não deve comunicar “próxima memória” quando o problema real é indisponibilidade.

### Memórias recentes

A última sessão já ocupa o hero e, por isso, não é repetida na grade imediatamente abaixo.

A Home possui teasers compactos próprios para as memórias recentes. Eles são uma **composição específica da Home**, não o card canônico do arquivo. A grade usa layout intrínseco (`auto-fit`/`minmax`) para aproveitar 1080p, 2K e mobile sem multiplicar breakpoints artificiais.

`SessionList` continua sendo o componente reutilizável do arquivo `/sessoes`; a Home não deve fazer o arquivo depender de sua composição promocional/compacta.

## Conteúdo sobre artwork

O reboot mantém os tokens theme-independent:

```css
--ds-on-art-foreground
--ds-on-art-soft
--ds-on-art-accent
```

Valores atuais:

```text
foreground  #fffdf8
soft        #d7d2c9
accent      #f2c879
```

Eles representam papéis semânticos sobre arte deliberadamente escurecida, não um terceiro tema.

Usos atuais incluem:

- hero de detalhe de sessão com artwork;
- badges/elementos sobre a artwork da última sessão na Home.

Texto colocado diretamente sobre artwork precisa usar esses papéis em vez de assumir que o tema da página garante contraste.

## Cards do arquivo de sessões

`SessionList` é dono do card reutilizável do arquivo e importa `session-list.module.css`.

O card é responsável por:

- artwork/fallback;
- eyebrow;
- título;
- data;
- resumo curto;
- link de leitura;
- variante featured quando necessária;
- responsividade própria;
- reduced motion de hover/zoom.

O arquivo decide quais sessões passa ao componente, sem replicar o CSS interno do card.

## Arquivo

`/sessoes` é uma composição fina:

- heading do arquivo;
- estado unavailable/preparing/empty;
- `SessionList`.

Não replica CSS de card.

## Detalhe de sessão

`/sessoes/[id]` separa duas responsabilidades.

### `page.module.css`

- hero;
- artwork e overlay;
- título/arc/data;
- voltar ao arquivo;
- largura do corpo;
- paginação anterior/próxima.

A artwork é full-width e, no Next 16, usa `preload` quando é candidata a LCP e `sizes="100vw"` para selecionar resolução coerente com 1080p/2K.

### `story.css`

- headings internos;
- parágrafos;
- listas;
- blockquotes;
- links;
- separators;
- inline code;
- leitura longa/mobile.

O parser de Markdown não conhece styling de página.

## Header e navegação

O logo/wordmark é a ação de início. Por isso `Início` não é repetido na navegação principal.

Na superfície pública atual, `Sessões` é o único link de navegação canônico além da marca. Novas entradas só devem aparecer quando a rota/experiência correspondente existir; a Home não anuncia features fictícias.

O controle de tema:

- segue a preferência do sistema quando não existe escolha salva;
- **não exibe uma opção `Sistema`**: o sistema serve apenas para resolver o tema inicial quando o usuário ainda não escolheu manualmente;
- após a primeira interação, persiste apenas `light` ou `dark` em `tda-theme`;
- mantém o switch binário compacto original, com o knob à esquerda no tema claro e à direita no tema escuro;
- usa no knob o **ícone da ação de destino**, não do estado atual: lua no tema claro para indicar “ir para escuro” e sol no tema escuro para indicar “ir para claro”;
- usa `role="switch"`, `aria-checked` e rótulo acessível estável `Modo escuro`;
- mantém alvo de interação de pelo menos `44px`;
- remove microanimações com `prefers-reduced-motion`.

O header atual permanece em uma linha inclusive no aceite de `320px`; o subtítulo da marca é removido quando necessário para preservar espaço. Se a navegação crescer no futuro, deve virar um padrão móvel real em vez de voltar a quebrar arbitrariamente em múltiplas linhas.

## Responsividade e matriz de aceite

As três telas primárias do TDA são testadas diretamente por Playwright:

- `1920×1080`;
- `2560×1440`;
- `390×844`.

`320×800` continua como limite mínimo explícito do shell público.

A auditoria geométrica automatizada verifica, entre outros:

- ausência de overflow horizontal;
- shell ocupando `min(viewport, 2160px)`;
- logo e ações do header sem sobreposição;
- gutter dentro do contrato do Design System;
- hero em duas colunas no desktop e empilhado no mobile;
- início de `Memórias recentes` dentro da primeira viewport em 1080p/2K, evitando desperdício vertical excessivo.

## Acessibilidade

Contratos relevantes:

- foco usa `--ds-control-focus-ring`;
- controles cuja borda participa da identificação usam `--ds-control-border`;
- ações principais têm alvo mínimo de `44px`;
- links narrativos dentro de `story-content` usam underline, não apenas cor;
- `prefers-reduced-motion` remove animações decorativas;
- skip-link é o primeiro foco útil;
- artwork decorativo usa `alt=""`;
- navegação não fica invisível enquanto permanece focável;
- SVGs puramente decorativos do theme switch ficam ocultos da árvore acessível.

## Performance visual

A Home evita carregar bibliotecas de motion pesado apenas por decoração.

Regras atuais:

- artwork candidata a LCP usa `next/image` com `preload` no contrato do Next 16;
- imagens de cards abaixo da dobra permanecem lazy por padrão;
- `sizes` descreve a largura real esperada em mobile/1080p/2K;
- `content-visibility: auto` pode ser usado em seções abaixo da dobra quando não prejudicar o contrato da superfície;
- transform/opacity são preferidos para microinterações;
- GSAP permanece reservado para experiências narrativas onde timeline/câmera realmente agreguem valor, como lores cinematográficas.

## Legado visual removido

Os antigos tokens:

```text
--bg
--panel
--panel-soft
--text
--muted
--gold
--line
```

não são mais definidos nem consumidos em runtime.

`tools/check-design-system.mjs` percorre todo `src/` e falha se qualquer um deles voltar a aparecer como declaração ou `var(...)`.

Isso transforma a remoção em invariante de CI, não em convenção informal.

## Testes automatizados

A camada pública é coberta por:

- `pnpm design:check`;
- typecheck;
- Biome;
- Vitest;
- docs check;
- Next build;
- Playwright.

Playwright cobre, entre outros:

- Home/arquivo sem cloud secrets;
- matriz 1080p/2K/mobile;
- 320px sem overflow;
- navegação visível e não redundante;
- skip-link focável;
- system-default + overrides explícitos `light`/`dark`;
- ícone de ação coerente com o próximo tema do switch;
- masters corretos da marca;
- reduced motion;
- geometria da Home/shell;
- 404 público.

## O que não foi feito nesta camada

- UI de Auth/perfil no branch canônico;
- Edit;
- implementação do React Flow;
- implementação das lores GSAP;
- migration Supabase;
- alteração de conteúdo/canon;
- deploy automático.

## Relação com o World Explorer

O World Explorer deve consumir a fundação existente, mas **não** deve ser colocado dentro de `.page-section` se precisar de viewport ampla.

A estrutura esperada é:

```text
root layout
  public shell / futura shell autenticada
    main sem largura global
      /mundo
        world-explorer layout próprio
        React Flow canvas
        inspector
        filters/controls
```

Nodes, edges, inspector e filtros usam tokens/primitives do Design System. O canvas é uma composição de feature, não uma razão para alterar o reset global.

## Definition of Done desta camada

- `globals.css` contém apenas reset/invariantes;
- shell possui ownership próprio e layout fluido;
- Home possui CSS Module próprio;
- arquivo mantém card reutilizável em `SessionList`;
- teasers específicos da Home não vazam para o arquivo;
- long-form está separado do hero de sessão;
- nenhum token pre-v1 existe em `src/`;
- 1080p, 2K, mobile e mínimo de 320px permanecem navegáveis;
- tema segue sistema por padrão e overrides explícitos são coerentes;
- CI protege os contratos automatizáveis.
