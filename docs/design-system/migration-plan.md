# Plano de migração do Design System para o reboot

> Status: DS-1/DS-2/DS-3 concluídas na fundação; DS-4 parcial; DS-5 próxima
> Owner: design-system / frontend
> Última revisão: 2026-09-06

## Objetivo

Levar o **TDA Design System v1.0.0** e o **TDA Brand Pack (official)** para a implementação atual do `Faysk/tda` sem copiar cegamente a estrutura técnica do snapshot `dnd-scribe`.

## Diferença importante de implementação

O pacote oficial registra um snapshot em que tokens estavam em `apps/web/app/globals.css` e havia integração Tailwind via `@theme inline`.

O reboot atual:

- usa `src/app`;
- possui CSS próprio em `src/app/globals.css` e `src/app/theme.css`;
- **não possui Tailwind como dependência atual**;
- já tem light/dark/system implementado;
- possui componentes atuais que ainda consomem tokens simplificados como `--bg`, `--panel`, `--gold` e `--line`.

### Decisão

**Não adicionar Tailwind apenas para copiar a implementação antiga do Design System.**

Os tokens e princípios são canônicos; Tailwind era uma forma de consumo do snapshot.

Primeira migração usa CSS variables semânticas e componentes React atuais. Tailwind só entra no futuro se houver benefício próprio demonstrado e decisão/documentação específica.

## Estado inicial observado

### Tokens históricos do reboot

Exemplos:

```css
--bg
--panel
--panel-soft
--text
--muted
--gold
--line
```

Eles permanecem apenas como aliases temporários durante a migração.

### Tokens alvo oficiais

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

Extensão promovida e documentada pelo reboot:

```css
--ds-control-border
--ds-control-focus-ring
```

A extensão veio de `tokens/proposed-extensions.css` do próprio pack e foi promovida após auditoria de contraste. Ver [README do Design System](README.md).

## Estratégia

Migração por compatibilidade, não big bang.

```text
introduzir tokens oficiais
 -> alias tokens antigos
 -> criar primitives
 -> migrar componentes
 -> verificar light/dark/a11y
 -> remover consumers antigos
 -> remover aliases obsoletos
```

## Fase DS-1 — Tokens — CONCLUÍDA NA FUNDAÇÃO

Implementação:

`src/app/design-tokens.css`

O arquivo contém os valores oficiais do v1 para light/dark/system, aliases temporários e a extensão de control border aprovada.

### Aliases temporários

```css
--bg: var(--ds-canvas);
--panel: var(--ds-surface);
--panel-soft: var(--ds-canvas-subtle);
--text: var(--ds-foreground);
--muted: var(--ds-foreground-muted);
--gold: var(--ds-accent);
--line: var(--ds-border);
```

Esses aliases são compatibilidade temporária. Componentes novos não devem nascer consumindo aliases antigos.

### Evidência

- `tools/check-design-system.mjs` valida tokens canônicos e extensões promovidas;
- `pnpm check` executa essa auditoria;
- Playwright valida resolução real de `--ds-canvas` em light e dark.

## Fase DS-2 — Tipografia — CONCLUÍDA NA FUNDAÇÃO

Famílias aplicadas:

- display/body editorial: Georgia/Times;
- UI: Inter/system stack.

Regras:

- conteúdo narrativo longo usa body editorial;
- buttons/inputs/nav/filter/metadata de sistema usam UI font;
- heading hierarchy continua semântica, não apenas visual.

A migração fina por componente continua em DS-5, mas a fundação tipográfica já está operacional.

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

### Regra de componente

Reutilizar semântica do pack. Implementação segue Next/React atuais do reboot e regras de acessibilidade vigentes.

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

## Fase DS-5 — Migrar telas existentes — PRÓXIMA

Ordem de execução:

1. header/theme toggle;
2. Home hero;
3. session cards;
4. archive;
5. session detail/long-form;
6. auth controls;
7. empty/error/loading.

Parte do header/theme toggle já foi estabilizada pela fundação. DS-5 deve agora migrar as superfícies públicas para os primitives/tokens oficiais e eliminar hardcodes locais quando houver equivalente semântico.

### Auditoria obrigatória de DS-5

- light/dark/system;
- 320px e desktop;
- overflow horizontal;
- keyboard/focus;
- reduced motion;
- sem artwork;
- erro/empty;
- texto curto/longo;
- nenhuma informação editorial vazando para visitante.

## Fase DS-6 — World Explorer

Só iniciar depois que tokens/primitives mínimos e as superfícies públicas estiverem estáveis.

Elementos que precisam do Design System:

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

## Fase DS-7 — Cleanup

Quando não houver consumidores:

- remover aliases `--bg`, `--panel`, `--gold` etc.;
- remover declarações históricas equivalentes em `globals.css`;
- remover hex duplicados equivalentes a tokens;
- remover implementações locais duplicadas de button/surface/status;
- atualizar docs para marcar migração concluída.

Não remover token antigo apenas porque "parece não usado"; confirmar via busca/CI/visual.

## Acessibilidade

Cada fase valida:

- 4.5:1 texto normal;
- 3:1 texto grande;
- 3:1 em componente/gráfico essencial quando fronteira é necessária;
- foco 2px via `--ds-control-focus-ring`, offset 3px;
- `--ds-control-border` quando a borda identifica o controle;
- keyboard-only;
- Escape em overlays;
- 44px para ação principal/touch;
- alt/accessibility names;
- reduced motion.

## Responsividade

Escala operacional oficial:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px`.

O reboot pode materializar tokens de spacing futuramente, mas não deve fingir que eles já existem no pacote como CSS canônico.

Layout muda pela necessidade da composição, não por nome de device.

## Testes

### Automatizados

- `pnpm check`;
- `pnpm design:check`;
- `pnpm build`;
- `pnpm test:e2e`;
- tests de component/model quando aplicável.

### Visuais/manuais antes de publicação

- 320px;
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

Cada fase deve ser reversível por commit/revert.

Não misturar na mesma migração visual:

- troca completa de tokens;
- redesign de todas as telas;
- React Flow;
- auth;
- migration de banco.

Separar PRs reduz risco e permite descobrir divergências do pacote oficial com dados reais.

## Definition of Done da migração completa

- pack oficial registrado e verificável;
- assets principais integrados;
- tokens `--ds-*` são a fonte operacional;
- light/dark usam os valores oficiais ou uma futura alteração documentada;
- primitives compartilhadas cobrem padrões repetidos;
- telas públicas não exibem estado editorial indevido;
- aliases antigos removidos ou explicitamente documentados como compatibilidade;
- World Explorer usa o mesmo sistema visual, não um micro-design-system próprio;
- CI e checklist visual passam.
