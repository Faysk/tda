# Superfícies públicas — ownership visual e composição

> Status: implementado na DS-5
> Owner: design-system / frontend público
> Última revisão: 2026-09-07

## Objetivo

Definir onde cada responsabilidade visual do frontend público do TDA deve viver depois da migração para o Design System v1.0.

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
| `src/app/design-tokens.css` | tokens canônicos e extensões aprovadas | composição de páginas |
| `src/app/design-system.css` | primitives visuais compartilhadas | layout de Home/sessão/feature específica |
| `src/app/public-shell.css` | header, nav pública, footer, skip-link, container público genérico | hero, cards, grafo |
| `src/app/theme.css` | theme toggle e troca dos masters black/white da marca | overrides de cards/páginas |
| `src/app/home.module.css` | composição exclusiva da Home | estilos de cards reutilizáveis |
| `src/components/session-list.module.css` | cards/listagem de sessões | layout do arquivo ou da Home |
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

O `<main>` global **não possui `max-width`**.

Cada superfície decide sua largura.

Motivo:

- Home e arquivo trabalham em até `1200px`;
- narrativa longa trabalha em aproximadamente `880px`;
- o futuro `/mundo` precisa poder ocupar a viewport disponível;
- um limite global obrigaria features full-width a desfazer CSS de outra área.

## Home

A Home usa:

- `Eyebrow`;
- `DisplayTitle`;
- `BodyCopy`;
- `SectionTitle`;
- `ActionLink`;
- `SessionList`.

`home.module.css` controla apenas:

- hero;
- composição artwork/overlay;
- CTA + última memória;
- separador do hero;
- seção de memórias;
- estados locais de disponibilidade.

## Conteúdo sobre artwork

Artwork do hero recebe overlay escuro de propósito. Portanto o texto sobre arte não pode trocar para tokens escuros apenas porque o usuário escolheu tema claro.

O reboot define os tokens theme-independent:

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

Eles representam **papéis semânticos sobre arte escurecida**, não um terceiro tema.

Usos atuais:

- Home hero com arte;
- hero de detalhe de sessão com arte.

Qualquer futura alteração precisa preservar contraste sobre o overlay usado pela superfície.

## Cards de sessão

`SessionList` é dono do card e importa `session-list.module.css`.

O card é responsável por:

- artwork/fallback;
- eyebrow;
- título;
- data;
- resumo curto;
- link de leitura;
- variante featured;
- responsividade própria;
- reduced motion de hover/zoom.

Home e arquivo somente decidem **quais sessões passam ao componente** e em que contexto.

## Arquivo

`/sessoes` é uma composição fina:

- heading do arquivo;
- estado loading-unavailable/preparing/empty;
- `SessionList`.

Não replica CSS de card.

## Detalhe de sessão

`/sessoes/[id]` separa duas responsabilidades:

### `page.module.css`

- hero;
- artwork e overlay;
- título/arc/data;
- voltar ao arquivo;
- largura do corpo;
- paginação anterior/próxima.

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

## Erro e 404

Estados globais usam os mesmos primitives do Design System:

- `DisplayTitle`;
- `Button`;
- `ActionLink`.

Não existe mais classe histórica `.button` como contrato público.

## Mobile

### 320px

É viewport de aceite automatizado.

Invariantes:

- sem overflow horizontal;
- navegação principal continua visível e focável;
- theme toggle permanece acessível;
- header reorganiza em duas linhas quando necessário;
- CTA principal permanece acionável;
- arquivo continua legível em uma coluna.

### Navegação

Não esconder links focáveis usando clipping apenas visual. Se uma navegação sair da tela no futuro, ela deve virar um padrão móvel real (drawer/menu) com estado e foco gerenciados.

Na superfície atual, a solução simples é reorganizar o header em duas linhas abaixo de `430px`.

## Acessibilidade

Contratos relevantes:

- foco usa `--ds-control-focus-ring`;
- controles cuja borda participa da identificação usam `--ds-control-border`;
- ações principais têm alvo mínimo de `44px`;
- links narrativos dentro de `story-content` usam underline, não apenas cor;
- `prefers-reduced-motion` remove animações decorativas;
- skip-link é o primeiro foco útil;
- artwork decorativo usa `alt=""`;
- navegação não fica invisível enquanto permanece focável.

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

A DS-5 é coberta por:

- `pnpm design:check`;
- typecheck;
- Biome;
- Vitest;
- docs check;
- Next build;
- Playwright.

Playwright cobre, entre outros:

- Home/arquivo sem cloud secrets;
- 320px sem overflow;
- navegação visível no mobile;
- skip-link focável;
- light/dark/system;
- masters corretos da marca;
- reduced motion;
- 404 público.

## O que não foi feito nesta fase

- Auth;
- Edit;
- React Flow;
- migration Supabase;
- alteração de conteúdo/canon;
- importação dos binários restantes do Brand Pack;
- deploy.

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
- shell possui ownership próprio;
- Home possui CSS Module próprio;
- cards possuem CSS Module próprio;
- archive não duplica card;
- long-form está separado do hero de sessão;
- nenhum token pre-v1 existe em `src/`;
- mobile 320px permanece navegável;
- light/dark/system continuam coerentes;
- CI protege essas regras.
