# Plano de migração do Design System para o reboot

> Status: DS-1/DS-2/DS-3 concluídas; DS-4 parcial; DS-5 implementada; DS-7 cleanup legado aplicado
> Owner: design-system / frontend
> Última revisão: 2026-09-07

## Objetivo

Levar o **TDA Design System v1.0.0** e o **TDA Brand Pack (official)** para a implementação atual do `Faysk/tda` sem copiar cegamente a estrutura técnica do snapshot `dnd-scribe`.

A migração é incremental e auditável. Cada fase precisa deixar contratos claros para que features futuras reutilizem o sistema, em vez de criarem exceções locais.

## Diferença importante de implementação

O pacote oficial registra um snapshot em que tokens estavam em `apps/web/app/globals.css` e havia integração Tailwind via `@theme inline`.

O reboot atual:

- usa `src/app`;
- consome CSS variables semânticas diretamente;
- **não possui Tailwind como dependência atual**;
- mantém `system / light / dark`;
- usa CSS Modules para composição de superfícies;
- preserva globals apenas para reset/contratos realmente globais.

### Decisão

**Não adicionar Tailwind apenas para copiar a implementação antiga do Design System.**

Os tokens e princípios são canônicos; Tailwind era uma forma de consumo do snapshot.

Adicionar Tailwind no futuro exige benefício próprio demonstrado e decisão/documentação específica.

## Tokens oficiais

Base operacional:

```css
--ds-canvas
--ds-canvas-subtle
--ds-surface
--ds-surface-hover
--ds-surface-elevated
--ds-border
--ds-border-subtle
--ds-foreground
--ds-foreground-soft
--ds-foreground-muted
--ds-accent
--ds-accent-strong
--ds-accent-muted
--ds-action-primary-*
--ds-danger
--ds-success
--ds-shadow
--ds-radius-*
--ds-font-*
```

Extensão promovida a partir de `tokens/proposed-extensions.css` do pack:

```css
--ds-control-border
--ds-control-focus-ring
```

Extensão semântica criada pelo reboot na DS-5 para conteúdo sobre artwork deliberadamente escurecido:

```css
--ds-on-art-foreground
--ds-on-art-soft
--ds-on-art-accent
```

Esses três tokens são theme-independent porque descrevem um **contexto de contraste sobre arte**, não um terceiro tema.

## Estratégia executada

```text
introduzir tokens oficiais
 -> criar primitives
 -> migrar shell/Home/cards/archive/detail
 -> separar long-form
 -> validar light/dark/mobile/a11y
 -> remover consumers antigos
 -> remover aliases antigos
 -> proteger estado final na CI
```

## Fase DS-1 — Tokens — CONCLUÍDA

Implementação:

`src/app/design-tokens.css`

O arquivo contém:

- valores oficiais do v1 para dark/light/system;
- extensão auditada de borda/foco de controle;
- contrato semântico `on-art` do reboot.

### Evidência

- `tools/check-design-system.mjs` valida valores canônicos e extensões;
- `pnpm check` executa a auditoria;
- Playwright valida resolução real dos temas.

## Fase DS-2 — Tipografia — CONCLUÍDA

Famílias aplicadas:

- display/body editorial: Georgia/Times;
- UI: Inter/system stack.

Regras:

- conteúdo narrativo longo usa body editorial;
- buttons/inputs/nav/filter/metadata de sistema usam UI font;
- heading hierarchy continua semântica, não apenas visual.

## Fase DS-3 — Primitives — FUNDAÇÃO CONCLUÍDA

Implementados em `src/components/ui/`:

```text
action.tsx
surface.tsx
typography.tsx
status.tsx
```

Também existem helper de class names, barrel exports e cobertura unitária do contrato de Action.

Próximos primitives entram somente conforme uso real exigir:

- `icon-button`;
- `tabs`;
- `field/input/select/textarea`;
- `dialog/popover`;
- `skeleton`;
- `empty-state`;
- `inline-message`.

## Fase DS-4 — Brand Pack — PARCIAL

Integrado e protegido por checksum:

- `tda-icon-duck-black.svg`;
- `tda-icon-duck-white.svg`;
- `tda-mark-black.svg`;
- `tda-mark-white.svg`;
- `favicon.svg`.

Header usa masters black/white reais conforme tema; favicon oficial está ligado à metadata.

Pendente em entrega binária própria:

1. horizontal white/black;
2. stacked white/black;
3. favicon ICO/PNGs;
4. Apple/Android/PWA;
5. manifest + browserconfig;
6. Open Graph/Twitter.

Não apontar a aplicação para manifest/PNG antes de importar todos os assets referenciados.

## Fase DS-5 — Superfícies públicas — IMPLEMENTADA

A DS-5 migra o frontend público atual para a fundação oficial sem introduzir Auth, React Flow ou mudança de banco.

### Ownership final

```text
src/app/globals.css                      reset mínimo
src/app/design-tokens.css                tokens
src/app/design-system.css                primitives
src/app/public-shell.css                 header/nav/footer/skip-link
src/app/theme.css                        theme toggle + masters da marca
src/app/home.module.css                  Home
src/components/session-list.module.css  cards
src/app/sessoes/page.module.css          arquivo
src/app/sessoes/[id]/page.module.css     detalhe
src/app/story.css                        leitura longa
```

Detalhamento em [public-surfaces.md](public-surfaces.md).

### Home

Migrada para:

- `Eyebrow`;
- `DisplayTitle`;
- `BodyCopy`;
- `SectionTitle`;
- `ActionLink`;
- `SessionList`.

Hero com artwork usa tokens `--ds-on-art-*`, mantendo contraste estável independentemente do tema do usuário.

### Cards

`SessionList` agora possui CSS Module próprio e é dono de:

- media/fallback;
- title/date/summary;
- CTA;
- featured layout;
- hover/reduced motion;
- mobile.

Home e arquivo não duplicam esse CSS.

### Arquivo

`/sessoes` virou uma composição fina: heading, estados e `SessionList`.

### Detalhe

`/sessoes/[id]` separa:

- hero/paginação no CSS Module da página;
- conteúdo narrativo longo em `story.css`.

### Error/404

Estados usam `Button`, `ActionLink` e `DisplayTitle`; classe histórica `.button` deixou de ser contrato.

### Mobile

A auditoria identificou que esconder a navegação visualmente abaixo de `430px` deixaria links focáveis fora da tela.

Correção adotada:

- header reorganiza em duas linhas;
- nav permanece visível;
- theme toggle permanece acessível;
- 320px é viewport de aceite E2E.

### Auditoria obrigatória de DS-5

Cobertura definida para:

- light/dark/system;
- 320px e desktop;
- overflow horizontal;
- keyboard/skip-link/focus;
- reduced motion;
- sem artwork;
- erro/empty/404;
- texto curto/longo;
- nenhuma informação editorial vazando para visitante.

## Fase DS-7 — Cleanup legado — PARCIALMENTE CONCLUÍDA JUNTO DA DS-5

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

foram removidos de `src/`.

`tools/check-design-system.mjs` percorre **todo `src/`** e falha se qualquer declaração ou consumo desses nomes reaparecer.

Também foram removidos:

- styling global de Home;
- styling global de cards;
- styling global de long-form que tinha ownership indefinido;
- seletores históricos de `.button`, `.session-card` e overrides de tema já substituídos.

DS-7 continua aberta apenas para cleanup que depender de features futuras ou da importação completa do Brand Pack.

## Próximo consumidor — Auth/capabilities e depois DS-6 World Explorer

No roadmap geral do produto, a próxima fase estrutural é **Auth + capabilities**. Controles de autenticação devem nascer usando os primitives/tokens atuais.

Depois, o World Explorer será o primeiro grande consumidor de uma superfície full-width.

## Fase DS-6 — World Explorer

O `<main>` global não possui `max-width`. Isso é intencional e prepara `/mundo` para controlar sua própria composição.

Elementos que precisam reutilizar o Design System:

- sidebar;
- topbar/search;
- filter pills;
- custom nodes;
- custom edges/labels;
- inspector;
- tabs;
- relation list;
- cards inferiores;
- controls/zoom;
- bottom sheet mobile.

React Flow não cria um micro-design-system próprio.

## Acessibilidade

Cada fase valida:

- 4.5:1 texto normal;
- 3:1 texto grande;
- 3:1 em componente/gráfico essencial quando fronteira é necessária;
- foco 2px via `--ds-control-focus-ring`, offset 3px;
- `--ds-control-border` quando a borda identifica o controle;
- keyboard-only;
- Escape em overlays futuros;
- 44px para ação principal/touch;
- alt/accessibility names;
- reduced motion;
- navegação móvel visível/focável.

## Responsividade

Escala operacional oficial:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px`.

Layout muda pela necessidade da composição, não por nome de device.

## Testes

### Automatizados

- `pnpm check`;
- `pnpm design:check`;
- `pnpm build`;
- `pnpm test:e2e`;
- tests de component/model quando aplicável.

### Playwright DS-5

- Home e arquivo sem cloud secrets;
- viewport 320px sem overflow;
- nav e theme toggle visíveis no mobile;
- skip-link recebe o primeiro foco;
- light/dark/system;
- master de marca correspondente ao tema;
- reduced motion;
- 404 público.

### Visuais/manuais antes de publicação

Ainda fazem parte do aceite de uma eventual publicação:

- mobile comum;
- tablet;
- desktop;
- desktop amplo;
- light;
- dark;
- system;
- texto longo;
- artwork ausente;
- empty/loading/error;
- keyboard;
- reduced motion.

## Rollback

Cada fase é reversível por commit/revert.

Não misturar na mesma entrega:

- redesign público;
- React Flow;
- Auth;
- migration de banco;
- deploy.

## Definition of Done da migração completa

- pack oficial registrado e verificável;
- assets principais integrados;
- tokens `--ds-*` são a única base runtime;
- light/dark usam os valores oficiais ou extensão documentada;
- primitives compartilhadas cobrem padrões repetidos;
- superfícies públicas possuem ownership modular;
- telas públicas não exibem estado editorial indevido;
- aliases históricos não existem em `src/`;
- World Explorer usa o mesmo sistema visual;
- CI e checklist visual passam.
