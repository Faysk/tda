# Design System oficial do TDA

> Status: canônico; fundação runtime e superfícies públicas implementadas
> Owner: design-system / frontend
> Última revisão: 2026-09-11

Este diretório registra a autoridade visual do **TDA — Tem Dado Aqui** no reboot `Faysk/tda`.

A fonte oficial recebida para esta revisão é o pacote **TDA Design System v1.0.0**, criado em `2026-09-06`, junto do **TDA Brand Pack (official)**. Os pacotes foram produzidos a partir de um snapshot histórico do `Faysk/dnd-scribe`, porém foram explicitamente aprovados como arquivos oficiais para o projeto atual.

O fato de o Design System ter sido extraído do legado **não transforma a arquitetura antiga em vigente**. O que é promovido ao TDA são os contratos visuais, tokens, princípios e masters de marca aqui revalidados.

## Índice do módulo

- [Assets oficiais e Brand Pack](official-assets.md)
- [Diretriz geral de UX, design e hierarquia](ux-hierarchy.md)
- [Plano de migração para o reboot](migration-plan.md)
- [Superfícies públicas — ownership visual](public-surfaces.md)
- [World Explorer — composição e UX](world-explorer-ui.md)
- [Feature World Explorer](../features/world-explorer.md)
- [ADR React Flow](../adr/0006-react-flow-world-explorer.md)

## Fontes oficiais

### TDA Design System v1.0.0

Arquivo fornecido: `TDA-Design-System-v1.0.zip`.

- versão: `1.0.0`;
- data: `2026-09-06`;
- snapshot de origem: `Faysk/dnd-scribe@68e974c0eb240e1658772f8ae64da36530f9452e`;
- SHA-256 do ZIP recebido: `fed119482a2854431691ef7e9073c984090c1c6dd810e77bd174be4b0a2b1ad2`.

Arquivos fundamentais do pacote:

- `docs/00_visao_geral.md`;
- `docs/01_principios.md`;
- `docs/02_cores_e_temas.md`;
- `docs/03_tipografia.md`;
- `docs/04_espacamento_layout_responsividade.md`;
- `docs/05_acoes_botoes_links.md`;
- `docs/06_superficies_cards.md`;
- `docs/07_status_feedback.md`;
- `docs/08_formularios.md`;
- `docs/09_navegacao.md`;
- `docs/10_movimento_interacao.md`;
- `docs/11_acessibilidade.md`;
- `docs/12_conteudo_e_hierarquia_editorial.md`;
- `docs/13_implementacao_next_tailwind.md`;
- `docs/14_governanca.md`;
- `docs/15_checklist_release_ui.md`;
- `docs/16_mapa_componentes.md`;
- `tokens/tda-design-tokens.css`;
- `tokens/tda-design-tokens.json`;
- `tokens/contrast-report.csv`;
- `tokens/proposed-extensions.css`.

Checksums relevantes do pacote recebido:

- `tokens/tda-design-tokens.css`: `d443f74ad2f4024af3ef9d74d3b061070e4ddfcb1de646735e1d5a1866a46250`;
- `tokens/tda-design-tokens.json`: `831f1b592726882f85c19e09376dcfb1d552951a83d8d652973d1617754577d7`;
- `docs/02_cores_e_temas.md`: `eed593613e4cccbc29d9c99675cb6d0d2d82453e968c94af405b528368571ba8`;
- `docs/03_tipografia.md`: `6eb6b3ac8f595b94f5dd0c7ff6e888baf1296137e9aa6cda7eef5820f8770094`;
- `docs/11_acessibilidade.md`: `00b726441e8ae4b8a220484cc63d938024624740545834e56066f3213088934e`;
- `docs/14_governanca.md`: `0caf535926132bec2107806d8130912876b18d73173759b9f175b36e7e665978`.

### TDA Brand Pack (official)

Arquivo fornecido: `tda-brand-pack (official).zip`.

- SHA-256 do ZIP recebido: `a56c89cc4d34888548168b87b71f3f369c686d46381c92b1a823169ed68e0cab`;
- geometria da marca e masters são tratados como oficiais;
- Brand Pack e Design System têm responsabilidades diferentes.

Detalhes em [official-assets.md](official-assets.md).

## Princípio central

> **Visitante vê história; editor vê estado editorial.**

Essa frase é um invariante de produto do reboot.

Na superfície pública, a narrativa tem prioridade: título, arco, data, resumo, arte, continuidade, personagens e mundo. Status internos, cobertura editorial, pipeline, revisão e diagnóstico pertencem ao Edit, salvo quando alterarem diretamente uma ação do visitante.

## Personalidade visual canônica

O TDA deve ser:

- editorial e narrativo;
- limpo, maduro e calmo;
- inspirado em D&D sem virar uma interface medieval caricata;
- altamente legível;
- orientado à arte e ao conteúdo;
- consistente entre tema claro e escuro;
- contido no uso do dourado.

O dourado é **acento raro**. Marca prioridade, foco, metadado forte ou ação principal; não é decoração contínua.

## Tokens canônicos v1

Os tokens semânticos do pacote v1.0 são a base oficial do reboot e vivem operacionalmente em `src/app/design-tokens.css`.

### Tema escuro

| Papel | Token | Valor |
| --- | --- | --- |
| canvas | `--ds-canvas` | `#0a0c0f` |
| canvas-subtle | `--ds-canvas-subtle` | `#101419` |
| surface | `--ds-surface` | `#151a20` |
| surface-hover | `--ds-surface-hover` | `#1a2027` |
| surface-elevated | `--ds-surface-elevated` | `#11151a` |
| border | `--ds-border` | `#2a3038` |
| foreground | `--ds-foreground` | `#eee8dc` |
| foreground-soft | `--ds-foreground-soft` | `#c8c2b7` |
| foreground-muted | `--ds-foreground-muted` | `#9aa1aa` |
| accent | `--ds-accent` | `#d7aa61` |
| accent-strong | `--ds-accent-strong` | `#f2c879` |
| action-primary-bg | `--ds-action-primary-bg` | `#e7b95f` |
| danger | `--ds-danger` | `#e59383` |
| success | `--ds-success` | `#8fc49b` |

### Tema claro

| Papel | Token | Valor |
| --- | --- | --- |
| canvas | `--ds-canvas` | `#f3efe7` |
| canvas-subtle | `--ds-canvas-subtle` | `#fffdf8` |
| surface | `--ds-surface` | `#e9e3d8` |
| surface-hover | `--ds-surface-hover` | `#ffffff` |
| surface-elevated | `--ds-surface-elevated` | `#fffdf8` |
| border | `--ds-border` | `#c8c0b3` |
| foreground | `--ds-foreground` | `#191917` |
| foreground-soft | `--ds-foreground-soft` | `#4f4b44` |
| foreground-muted | `--ds-foreground-muted` | `#625d55` |
| accent | `--ds-accent` | `#805817` |
| accent-strong | `--ds-accent-strong` | `#9a6a1d` |
| action-primary-bg | `--ds-action-primary-bg` | `#805817` |
| danger | `--ds-danger` | `#9a3025` |
| success | `--ds-success` | `#326c42` |

`tools/check-design-system.mjs` verifica o contrato completo de valores do v1 em toda execução de `pnpm check`.

## Extensão promovida — borda de controle

A auditoria do `tokens/contrast-report.csv` confirmou que `--ds-border` é uma borda decorativa e não deve ser o único delimitador de um controle essencial.

O próprio pacote forneceu `tokens/proposed-extensions.css`. O reboot promove:

| Tema | Token | Valor | Papel |
| --- | --- | --- | --- |
| dark | `--ds-control-border` | `#5f6772` | delimitar controles |
| light | `--ds-control-border` | `#8b8379` | delimitar controles |
| ambos | `--ds-control-focus-ring` | `var(--ds-accent-strong)` | foco oficial |

Essa é uma **extensão do reboot promovida a partir do pack**, não uma alegação de que o token fazia parte de `tda-design-tokens.css` v1.0.

Separadores e contornos puramente decorativos continuam usando `--ds-border`/`--ds-border-subtle`.

## Extensão do reboot — layout fluido

A Home V2 promove dois papéis de layout para impedir que cada superfície volte a inventar largura e gutter próprios:

| Token | Valor | Papel |
| --- | --- | --- |
| `--ds-layout-max` | `2160px` | teto do shell público amplo |
| `--ds-page-gutter` | `clamp(20px, 3.5vw, 72px)` | respiro horizontal responsivo |

Esses tokens não pertenciam ao snapshot v1.0 recebido; são extensões operacionais do reboot atual e devem ser protegidas por `design:check`.

## Extensão semântica DS-5 — conteúdo sobre artwork

Artwork deliberadamente escurecida por overlay precisa manter contraste independente da preferência light/dark do usuário.

O reboot define:

| Token | Valor | Papel |
| --- | --- | --- |
| `--ds-on-art-foreground` | `#fffdf8` | título/conteúdo principal sobre arte |
| `--ds-on-art-soft` | `#d7d2c9` | metadata/corpo secundário sobre arte |
| `--ds-on-art-accent` | `#f2c879` | eyebrow/acento sobre arte |

Esses tokens são theme-independent. Eles **não criam um terceiro tema**; descrevem um contexto visual controlado.

Usos atuais:

- hero do detalhe de sessão quando há artwork;
- badges/elementos diretamente sobre a artwork da última sessão na Home.

## Tipografia

Famílias oficiais do pacote:

- `font-display`: Georgia, Times New Roman, serif;
- `font-body`: Georgia, Times New Roman, serif;
- `font-ui`: Inter, `ui-sans-serif`, system UI.

A narrativa e leitura longa usam caráter editorial. Controles, filtros, metadata operacional e ações usam a stack de UI.

## Estado da implementação do reboot

### Fundação runtime

Implementada:

- `src/app/design-tokens.css`;
- `src/app/design-system.css`;
- `src/components/ui/action.tsx`;
- `src/components/ui/surface.tsx`;
- `src/components/ui/typography.tsx`;
- `src/components/ui/status.tsx`;
- `tools/check-design-system.mjs`;
- E2E de tema, marca, responsividade e reduced motion.

### Loader global de espera

**Status em 2026-09-10: implementado, validado e aceito visualmente em uso real.** O loader global passa a ser parte do contrato de feedback do Design System, não um efeito isolado de uma página.

A linguagem visual aprovada é deliberadamente simples na hierarquia e rica apenas nos detalhes de movimento:

- overlay full-screen com fade e blur do conteúdo anterior;
- marca oficial TDA centralizada, sem texto auxiliar;
- rotação contínua em velocidade moderada durante a espera;
- halos, órbitas, rastros e partículas sutis como camadas de apresentação separadas da geometria da marca;
- ao concluir, a rotação desacelera, assenta a marca em posição estável e o overlay desaparece em fade;
- o movimento é o mesmo em light e dark; o tema altera somente a paleta visual.

O runtime está concentrado em `src/components/global-loading/`:

```text
global-loading.tsx                 provider, concorrência, fases e API pública
global-loading.module.css          composição, motion e efeitos base
global-loading-theme.module.css    paleta por tema e integração com tokens
form-loading-bridge.tsx            submits nativos same-origin
events.ts                          bridge imperativo por eventos
index.ts                           exports públicos
```

O `GlobalLoadingProvider` usa tokens internos por operação. Vários carregamentos podem coexistir; o overlay só entra em saída quando todos os tokens ativos terminam. Esperas normais usam uma janela de aproximadamente `110 ms` antes de aparecer para evitar flash em operações instantâneas. A saída visual dura aproximadamente `680 ms`, incluindo a desaceleração final.

#### Contrato de ativação

O loader deve representar **espera bloqueante percebida pelo usuário**. Hoje entram no contrato:

- navegação interna por `PublicLink`, que acompanha o pending state real do App Router;
- submits nativos same-origin por `GlobalFormLoadingBridge`;
- elementos com `aria-busy="true"`;
- opt-in explícito por `data-global-loading="true"`;
- estados existentes com `data-state="saving"` quando a espera é bloqueante;
- hooks `useGlobalLoading()` e `useGlobalLoadingFlag()`;
- bridge de eventos para integrações imperativas;
- fallback de rota específico quando realmente necessário.

Polling, heartbeat, prefetch, autosave silencioso e sincronização de fundo **não** devem abrir o overlay. Um subtree pode declarar `data-global-loading="off"` para manter trabalho de background fora do feedback global. O provider não intercepta `window.fetch` globalmente.

Essa separação é de UX e de arquitetura: o loader comunica “você está esperando por esta ação”, não “algum request existe no sistema”.

#### Tema escuro e tema claro

O dark aprovado originalmente continua sendo a baseline visual. A versão clara não é outro loader: é a mesma composição usando a linguagem cromática do Design System.

No tema claro, `global-loading-theme.module.css` deriva backdrop, vinheta, halos, órbitas, rastros e partículas de tokens como `--ds-canvas`, `--ds-foreground`, `--ds-accent` e `--ds-accent-strong` por `color-mix()`. A marca continua usando o master oficial `tda-mark-white.svg`; no light, somente a apresentação aplica filtro para obter a leitura escura, sem alterar o arquivo ou sua geometria.

A resolução de tema segue o contrato global do TDA:

- `:root[data-theme="dark"]` preserva a versão dark aprovada;
- `:root[data-theme="light"]` usa canvas claro, foreground escuro e acento dourado contido;
- quando `data-theme` não está definido, `prefers-color-scheme: light` fornece o fallback esperado;
- não existe terceiro tema específico do loader.

Isso protege o princípio de que **light e dark são o mesmo produto e preservam a mesma hierarquia**. A troca de tema não muda velocidade, tamanho, sequência ou significado da animação.

#### Acessibilidade e comportamento

O overlay expõe `role="status"`, `aria-busy="true"` e `aria-label="Carregando"`, embora não mostre texto visual. `prefers-reduced-motion: reduce` remove animações decorativas e evita depender de movimento para comunicar o estado.

O loader não deve alterar semântica HTTP nem ser implementado por um boundary global que converta respostas dinâmicas de `notFound()` em streaming `200`. Por isso a navegação do App Router é observada no nível de link/estado pendente e fallbacks de rota ficam específicos.

A validação automatizada cobre tema claro e escuro, estados bloqueantes, operações rápidas que não devem piscar, trabalho explicitamente de background e regressões de navegação. O aceite visual de produto foi confirmado após uso em produção em `2026-09-10`, encerrando esta frente como concluída.

### Superfícies públicas

A composição pública foi modularizada:

```text
src/app/globals.css                      reset mínimo
src/app/public-shell.css                 shell pública
src/app/theme.css                        theme switch + marca
src/app/home.module.css                  Home
src/components/session-list.module.css  cards do arquivo
src/app/sessoes/page.module.css          arquivo
src/app/sessoes/[id]/page.module.css     detalhe
src/app/story.css                        leitura longa
```

Detalhes e ownership em [public-surfaces.md](public-surfaces.md).

### Cleanup de tokens históricos

Os nomes pre-v1:

```text
--bg
--panel
--panel-soft
--text
--muted
--gold
--line
```

foram removidos de todo `src/`.

`tools/check-design-system.mjs` percorre a árvore runtime e falha se declaração ou consumo desses nomes voltar a aparecer.

Portanto, eles não são mais aliases de compatibilidade nem segunda camada de tokens.

### Layout global

O `<main>` não possui `max-width` global.

Isso é deliberado:

- header, footer, Home e `.page-section` compartilham o shell fluido até `2160px`;
- long-form controla sua largura de leitura;
- `/mundo` poderá usar viewport ampla sem desfazer CSS de sessões.

As telas primárias de aceite visual são `1920×1080`, `2560×1440` e mobile `390×844`; `320×800` permanece como limite mínimo automatizado.

## Tailwind

O snapshot antigo documenta consumo de tokens via Tailwind. Isso é detalhe de implementação histórico, não requisito visual.

O reboot atual não depende de Tailwind. Adicionar Tailwind no futuro exige benefício próprio e decisão/documentação específica, não paridade artificial com o legado.

## Regras de governança

1. Semântica antes de hexadecimal.
2. Se um papel visual já possui token, componentes não inventam cor local.
3. Novo token precisa de papel definido, valores/escopo, origem e verificação de contraste.
4. Extensão do reboot deve ser distinguida explicitamente de token original do pack.
5. Componentes repetidos viram primitives compartilhadas.
6. Global define contrato; módulo define composição.
7. Movimento comunica estado; não compete com narrativa.
8. Mobile reorganiza composição; não comprime desktop.
9. Navegação focável nunca pode ficar escondida apenas visualmente.
10. Marca não é redesenhada pelo Design System.
11. Tela não está pronta apenas porque parece boa em desktop dark.

## Definition of Done visual

Uma superfície nova deve ser verificada em:

- tema claro;
- tema escuro;
- mobile alvo e mínimo de `320px`;
- `1920×1080`;
- `2560×1440` quando a superfície for ampla;
- navegação por teclado;
- foco visível;
- `prefers-reduced-motion`;
- conteúdo curto e longo;
- vazio/loading/erro;
- contraste;
- leitura com zoom;
- assets ausentes/fallbacks.

## Relação com o Mundo / Ecos da Jornada

As referências visuais oficiais do World Explorer usam este Design System como base de composição, não como exceção. A especificação está em [world-explorer-ui.md](world-explorer-ui.md) e o comportamento da feature em [../features/world-explorer.md](../features/world-explorer.md).

O World Explorer não deve herdar o teto do shell público quando sua composição exigir canvas full-width; ele terá layout próprio e reutilizará tokens/primitives existentes.

## Autoridade operacional

A ordem de autoridade do reboot é:

1. documentos canônicos em `docs/design-system/`;
2. tokens/componentes compartilhados implementados em `Faysk/tda`;
3. Brand Pack oficial para geometria/assets de marca;
4. pacote TDA Design System v1.0 como snapshot de origem e auditoria;
5. referências históricas do `dnd-scribe` apenas quando explicitamente revalidadas.

O path histórico `apps/web/...` citado dentro do ZIP **não é path vigente**. O reboot usa `src/app` e módulos atuais do `Faysk/tda`.
