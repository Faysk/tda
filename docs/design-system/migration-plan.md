# Plano de migração do Design System para o reboot

> Status: aprovado para execução incremental
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

### Tokens atuais do reboot

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

## Fase DS-1 — Tokens

Criar arquivo canônico da implementação, por exemplo:

`src/app/design-tokens.css`

Conteúdo inicial deve refletir byte/semanticamente os tokens oficiais aprovados, adaptando apenas selectors necessários ao tema atual.

### Aliases temporários

Durante migração:

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

### Critérios

- dark igual semanticamente ao pack;
- light igual semanticamente ao pack;
- system continua funcionando;
- sem flash agressivo de tema;
- nenhum componente quebra antes da migração individual.

## Fase DS-2 — Tipografia

Aplicar famílias oficiais:

- display/body editorial: Georgia/Times;
- UI: Inter/system stack.

Não é necessário baixar/redistribuir fonte proprietária.

### Regras

- conteúdo narrativo longo usa body editorial;
- buttons/inputs/nav/filter/metadata de sistema usam UI font;
- heading hierarchy continua semântica, não apenas visual.

## Fase DS-3 — Primitives

Recriar no reboot, sem copiar paths do legado como autoridade:

```text
src/components/ui/
  action.tsx
  surface.tsx
  typography.tsx
  status.tsx
```

Depois, conforme necessidade real:

- `icon-button`;
- `tabs`;
- `field/input/select/textarea`;
- `dialog/popover`;
- `skeleton`;
- `empty-state`;
- `inline-message`.

### Regra de componente

Reutilizar semântica do pack. Implementação deve seguir Next/React atuais do reboot e regras de acessibilidade vigentes.

## Fase DS-4 — Brand Pack

Copiar assets oficiais selecionados para `public/brand/` e verificar SHA-256.

Prioridade:

1. `tda-mark.svg` / variações;
2. horizontal white/black;
3. favicon SVG/ICO/PNG;
4. Apple/Android/PWA;
5. manifest;
6. Open Graph.

### Atualizações de app

- header/brand;
- metadata icons;
- manifest;
- Open Graph default;
- fallback social.

Não redesenhar SVG nem usar filtros CSS como substituto permanente de variantes oficiais quando o asset correto existir.

## Fase DS-5 — Migrar telas existentes

Ordem recomendada:

1. header/theme toggle;
2. Home hero;
3. session cards;
4. archive;
5. session detail/long-form;
6. auth controls;
7. empty/error/loading.

Motivo: estabilizar primitives e tokens antes do World Explorer, que é uma tela visualmente mais complexa.

## Fase DS-6 — World Explorer

Só iniciar depois que tokens/primitives mínimos estiverem utilizáveis.

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
- remover hex duplicados equivalentes a tokens;
- remover implementações locais duplicadas de button/surface/status;
- atualizar docs para marcar migração concluída.

Não remover token antigo apenas porque "parece não usado"; confirmar via busca/CI/visual.

## Acessibilidade

Cada fase valida:

- 4.5:1 texto normal;
- 3:1 texto grande;
- 3:1 em componente/gráfico essencial quando fronteira é necessária;
- foco 2px `accent-strong`, offset 3px ou equivalente mais forte;
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

Não misturar na mesma migration visual:

- troca completa de tokens;
- redesign de todas as telas;
- React Flow;
- auth;
- migration de banco.

Separar PRs reduz risco e permite descobrir divergências do pacote oficial com dados reais.

## Definition of Done da migração

- pack oficial registrado e verificável;
- assets principais integrados;
- tokens `--ds-*` são a fonte operacional;
- light/dark usam os valores oficiais ou uma futura alteração documentada;
- primitives compartilhadas cobrem padrões repetidos;
- telas públicas não exibem estado editorial indevido;
- aliases antigos removidos ou explicitamente documentados como compatibilidade;
- World Explorer usa o mesmo sistema visual, não um micro-design-system próprio;
- CI e checklist visual passam.