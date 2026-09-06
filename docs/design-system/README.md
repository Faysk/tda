# Design System oficial do TDA

> Status: canônico para direção visual; fundação runtime em validação
> Owner: design-system / frontend
> Última revisão: 2026-09-06

Este diretório registra a autoridade visual do **TDA — Tem Dado Aqui** no reboot `Faysk/tda`.

A fonte oficial recebida para esta revisão é o pacote **TDA Design System v1.0.0**, criado em `2026-09-06`, junto do **TDA Brand Pack (official)**. Os pacotes foram produzidos a partir de um snapshot histórico do `Faysk/dnd-scribe`, porém foram explicitamente aprovados como arquivos oficiais para o projeto atual.

O fato de o Design System ter sido extraído do legado **não transforma a arquitetura antiga em vigente**. O que é promovido ao TDA são os contratos visuais, tokens, princípios e masters de marca aqui revalidados.

## Índice do módulo

- [Assets oficiais e Brand Pack](official-assets.md)
- [Plano de migração para o reboot](migration-plan.md)
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

## Extensão promovida pelo reboot — borda de controle

A auditoria do `tokens/contrast-report.csv` confirmou que `--ds-border` tem contraste aproximado de apenas **1.47:1** no dark e **1.57:1** no light contra os canvases correspondentes. O próprio pacote marca essa borda como **decorativa**, não adequada como único delimitador de um controle essencial.

O pacote também forneceu `tokens/proposed-extensions.css`, com uma proposta específica de borda de controle. O reboot promove essa proposta após revisão porque ela resolve um requisito já declarado em `docs/08_formularios.md` e `docs/11_acessibilidade.md`:

| Tema | Token | Valor | Contraste de referência |
| --- | --- | --- | ---: |
| dark | `--ds-control-border` | `#5f6772` | ~3.06:1 contra `#151a20` |
| light | `--ds-control-border` | `#8b8379` | ~3.68:1 contra `#fffdf8` |
| ambos | `--ds-control-focus-ring` | `var(--ds-accent-strong)` | foco oficial |

Essa é uma **extensão do reboot**, não uma alegação de que o token fazia parte do arquivo canônico `tda-design-tokens.css` v1.0. A origem e a diferença ficam registradas deliberadamente.

Uso inicial: controles cuja borda participa da identificação visual, começando pelo theme toggle. Separadores puramente decorativos continuam usando `--ds-border`/`--ds-border-subtle`.

## Tipografia

Famílias oficiais do pacote:

- `font-display`: Georgia, Times New Roman, serif;
- `font-body`: Georgia, Times New Roman, serif;
- `font-ui`: Inter, `ui-sans-serif`, system UI.

A narrativa e leitura longa usam caráter editorial. Controles, filtros, metadata operacional e ações usam a stack de UI.

## Estado da implementação do reboot

A fundação runtime em validação introduz:

- `src/app/design-tokens.css` — tokens oficiais + aliases temporários + extensão auditada de control border;
- `src/app/design-system.css` — base visual e classes dos primitives;
- `src/components/ui/action.tsx`;
- `src/components/ui/surface.tsx`;
- `src/components/ui/typography.tsx`;
- `src/components/ui/status.tsx`;
- `tools/check-design-system.mjs` — auditoria automatizada de tokens e masters de marca;
- E2E de light/dark, variante da marca e reduced motion.

A implementação antiga ainda contém declarações simplificadas (`--bg`, `--panel`, `--text`, `--gold`, `--line`) em CSS histórico. Elas deixam de ser autoridade porque `design-tokens.css` é carregado depois e redefine esses nomes como aliases para `--ds-*`.

Isso é **compatibilidade de migração**, não um segundo Design System. A remoção física das declarações e dos consumers antigos pertence ao cleanup após as telas serem migradas.

O plano detalhado está em [migration-plan.md](migration-plan.md).

## Tailwind

O snapshot antigo documenta consumo de tokens via Tailwind. Isso é detalhe de implementação histórico, não requisito visual.

O reboot atual não depende de Tailwind; a primeira migração consome tokens CSS diretamente. Adicionar Tailwind no futuro exige benefício próprio e decisão/documentação específica, não paridade artificial com o legado.

## Regras de governança

1. Semântica antes de hexadecimal.
2. Se um papel visual já possui token, componentes não inventam cor local.
3. Novo token precisa de papel definido, valores light/dark, origem e verificação de contraste.
4. Extensão do reboot deve ser distinguida explicitamente de token original do pack.
5. Componentes repetidos viram primitives compartilhadas.
6. Movimento comunica estado; não compete com narrativa.
7. Mobile reorganiza composição; não comprime desktop.
8. Marca não é redesenhada pelo Design System.
9. Tela não está pronta apenas porque parece boa em desktop dark.

## Definition of Done visual

Uma superfície nova deve ser verificada em:

- tema claro;
- tema escuro;
- 320px/mobile;
- desktop;
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

## Autoridade após a migração

A ordem de autoridade operacional do reboot será:

1. documentos canônicos em `docs/design-system/`;
2. tokens/componentes compartilhados implementados em `Faysk/tda`;
3. Brand Pack oficial para geometria/assets de marca;
4. pacote TDA Design System v1.0 como snapshot de origem e auditoria;
5. referências históricas do `dnd-scribe` apenas quando explicitamente revalidadas.

O path histórico `apps/web/...` citado dentro do ZIP **não é path vigente**. O reboot usa `src/app` e módulos atuais do `Faysk/tda`.
