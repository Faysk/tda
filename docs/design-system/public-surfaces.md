# Superfícies públicas — ownership visual e composição

> Status: implementado; baseline cinematográfica da Home formalizada
> Owner: design-system / frontend público
> Última revisão: 2026-09-29

## Objetivo

Definir onde cada responsabilidade visual do frontend público do TDA vive depois da migração para o Design System v1.0 e das evoluções de Home/shell feitas no reboot.

Este documento existe para impedir dois problemas recorrentes:

1. `globals.css` voltar a acumular regras de páginas e componentes;
2. novas features, especialmente o World Explorer, criarem um segundo sistema visual paralelo.

## Regra principal

**Global define contrato; módulo define composição.**

Tokens e primitives são compartilhados. Layout específico de uma superfície pertence à superfície.

Exceção de 2026-09-12: [lores individuais](../features/independent-lores.md) podem definir identidade visual própria e não precisam reutilizar tokens/primitives/shell TDA. Manter seus estilos isolados; essa liberdade não se estende automaticamente ao catálogo `/lore`, ao Mundo ou ao Edit.

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

## Home cinematográfica — baseline geométrica

A Home é a referência **cinematic + expansive** do shell público. A baseline formalizada por #1083 preserva a composição integrada em #1002/#1004: artwork full-bleed, chrome global flutuante e conteúdo editorial sobre a própria imagem. Ela não volta ao antigo layout de duas colunas e não reserva uma faixa superior invisível.

### Topo real e shell

O hero começa no topo estrutural real da página. O shell global continua viewport-fixed e com altura estrutural zero; marca e avatar não participam do fluxo e, portanto, não reduzem o hero.

O contrato runtime é:

```text
hero min-block = max(--home-hero-min-block, 100svh)
desktop comum   = 640px mínimo
mobile          = 620px mínimo
>2160px         = 860px mínimo
```

Esses mínimos protegem composições muito baixas, mas a viewport continua sendo a referência dominante. Não reintroduzir cálculos do tipo `100svh - altura-do-header`, spacers ou `padding-top` globais equivalentes à navbar antiga.

### Keyline editorial

A Home possui uma única keyline de conteúdo, derivada do contrato global:

```css
--home-editorial-keyline: var(--ds-page-gutter);
```

Metadata, título, resumo e CTA compartilham esse eixo. O fallback sem sessão usa a mesma referência.

Até `--ds-layout-max: 2160px`, a keyline visual coincide com o gutter do viewport. Acima disso, o conteúdo da Home centraliza a superfície de até 2160px e aplica o gutter dentro dela. A marca e o avatar, por outro lado, continuam presos aos cantos do viewport conforme o contrato do shell. Essa divergência em ultra-wide é deliberada: chrome global continua alcançável nos cantos enquanto o texto não se espalha indefinidamente.

Compensações ópticas do símbolo da marca pertencem ao shell. Elas **não** alteram o gutter/keyline do conteúdo da Home.

### Largura de leitura do bloco

O hero é expansivo; o texto não.

Valores de referência:

| Faixa | Título | Metadata | Resumo |
| --- | ---: | ---: | ---: |
| até 2160px | 760px | 760px | 720px |
| acima de 2160px | 900px | 820px | 820px |

São limites máximos, não larguras forçadas. O objetivo é preservar linhas confortáveis em 1920/2560 sem transformar o bloco editorial em coluna estreita artificial.

### Artwork, shade e scrims

A imagem da última sessão é **conteúdo**, não background decorativo genérico:

- mantém `next/image`;
- candidata a LCP usa `preload` e `sizes="100vw"`;
- `object-fit: cover`;
- posicionamento muda por breakpoint para preservar o assunto da imagem;
- o shade narrativo da Home serve à leitura do conteúdo;
- scrims de marca/avatar permanecem locais no shell;
- o radial atrás do bloco editorial permanece local ao texto.

Não adicionar overlay opaco full-screen, blur dinâmico, leitura de luminância em runtime ou biblioteca de motion apenas para “dar cara premium”.

Posições atuais da artwork fazem parte da baseline perceptiva: `center 46%` no desktop comum, `center 44%` em ultra-wide, `58% center` abaixo de 980px, `64% center` abaixo de 700px e `67% center` abaixo de 460px.

### Mobile

Mobile é composição própria, não desktop reduzido.

- `390×844` e `320×800` preservam hero de viewport inteira;
- artwork é reposicionada para a direita nos breakpoints estreitos;
- metadata pode quebrar e, abaixo de 460px, passa para coluna;
- resumo usa até quatro linhas abaixo de 700px;
- título continua limitado pelo gutter e pela largura disponível;
- marca/avatar permanecem flutuantes e não podem interceptar o título/CTA;
- não existe overflow horizontal de página.

### Continuidade de scroll

A ordem narrativa permanece:

```text
Hero / última sessão
→ entrada de Lore quando aplicável
→ Memórias recentes
```

A transição é fluxo normal de documento. Não há snapping obrigatório, spacer da navbar antiga ou margem negativa para “colar” seções. `Memórias recentes` deve começar somente depois do hero e das entradas narrativas intermediárias reais.

### Fallback sem sessão

Sem sessão publicada ou com repository indisponível, `ArchivePreview` ocupa o hero preservando:

- topo real;
- a mesma keyline;
- clearance funcional do chrome;
- diferença semântica entre arquivo vazio e indisponibilidade.

O fallback não inventa artwork e não muda o contrato geométrico da superfície.

### Movimento e performance

A Home não adiciona timeline JavaScript para scroll. Microinterações usam CSS e `transform` quando necessário. Com `prefers-reduced-motion: reduce`, zoom/transições decorativas dos cards/artwork permanecem removidos.

A baseline não adiciona novos assets, dependências de motion ou medições por frame. Preservar esse limite é parte do gate de LCP: qualquer evolução que inclua decoração/motion precisa demonstrar que não degrada a candidata de LCP nem causa layout thrashing.

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

O logo/wordmark continua sendo a ação de início. Por isso `Início` não é repetido no launcher.

O contrato canônico do header passou a ser **marca + launcher + avatar** e pertence a [Navegação global do TDA](../features/global-navigation.md). O launcher concentra destinos públicos reais e, quando a projeção privada permitir, ferramentas autorizadas; o avatar concentra conta, autenticação e aparência.

Na baseline `main@8855e5de513d5875221a785e8a5cd7b03011d644`, a projeção sanitizada de Auth de #881, o launcher de #880, o avatar/painel de conta de #882 (PR #902) e a retirada dos hubs de #883 (PR #908) já estão integrados. `/edit` funciona como entrypoint de compatibilidade e `/conta` como superfície focada de identidade/acesso. O controle de aparência vive dentro do painel de conta. #884 permanece como gate completo de QA.

O controle de tema:

- segue a preferência do sistema quando não existe escolha salva;
- **não exibe uma opção `Sistema`**: o sistema serve apenas para resolver o tema inicial quando o usuário ainda não escolheu manualmente;
- após a primeira interação, persiste apenas `light` ou `dark` em `tda-theme`;
- mantém o switch binário compacto original, com o knob à esquerda no tema claro e à direita no tema escuro;
- usa no knob o **ícone da ação de destino**, não do estado atual: lua no tema claro para indicar “ir para escuro” e sol no tema escuro para indicar “ir para claro”;
- usa `role="switch"`, `aria-checked` e rótulo acessível estável `Modo escuro`;
- mantém alvo de interação de pelo menos `44px`;
- remove microanimações com `prefers-reduced-motion`.

### Movimento da troca de tema

A primeira implementação de suavização usou `@property` para registrar os tokens de cor e permitir interpolação real entre claro e escuro. O experimento seguinte elevou propositalmente os tempos para **1s no tema global e 2s no controle**. Esse estado foi diagnóstico: serviu para tornar cada fase perceptível e não representa timing final aprovado.

O candidato final desta rodada usa tempos coordenados, porém ainda visíveis:

- tema global e crossfade da marca: `700ms`;
- track/borda/sombra do switch: `520ms`;
- deslocamento do knob: `650ms` com a spring curta já adotada;
- fade/rotação dos glyphs: `460ms`;
- feedback de pressão: `140ms`.

O objetivo é que o tema inteiro pareça transformar-se, enquanto o controle responde imediatamente e termina sem ficar “viajando” depois da página. A interpolação de cor continua acontecendo nos tokens semânticos; não foi introduzida View Transition nem snapshot de página porque isso congelaria a interação viva do switch e adicionaria complexidade desnecessária a este caso.

O Playwright valida este contrato nos projetos `desktop-1080p`, `desktop-2k` e `mobile`: além dos tempos computados, existe uma asserção de que `--ds-canvas` passa por um valor intermediário durante a troca, provando que a mudança não é um snap disfarçado. Com `prefers-reduced-motion: reduce`, as transições globais, do knob e das demais microinterações permanecem em `0s`.

A aprovação perceptiva do timing ainda depende de revisão visual do proprietário: testes automatizados conseguem provar interpolação, duração e acessibilidade, mas não substituem julgamento de ritmo/agradabilidade.

O launcher de #880 já usa a composição responsiva definida em [Navegação global](../features/global-navigation.md): no mobile o painel se reorganiza sem voltar a uma lista textual quebrada em múltiplas linhas. O shell continua obrigado a caber no aceite de `320px`, removendo o subtítulo da marca quando necessário.

## Responsividade e matriz de aceite

As três telas primárias do TDA são testadas diretamente por Playwright:

- `1920×1080`;
- `2560×1440`;
- `390×844`.

`320×800` continua como limite mínimo explícito do shell público.

A auditoria geométrica automatizada verifica, entre outros:

- ausência de overflow horizontal;
- shell flutuante com altura estrutural zero;
- logo e ações do header sem sobreposição;
- Home começando no topo real e mantendo pelo menos a altura da viewport;
- keyline editorial resolvida a partir de `--ds-page-gutter`;
- limites de leitura da Home em 1920/2560;
- `390×844` e `320×800` sem colisão entre chrome e conteúdo;
- `Memórias recentes` começando depois do hero/entradas narrativas reais, sem offset fantasma da antiga navbar.

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
- interpolação real e timings do candidato de motion;
- reduced motion;
- geometria da Home/shell;
- 404 público.

## O que não foi feito nesta camada

- projeção mínima de Auth (#881), launcher (#880), avatar/painel de conta (#882 / PR #902) e retirada dos hubs (#883 / PR #908) estão integrados na `main`; o gate completo de QA segue em #884;
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
