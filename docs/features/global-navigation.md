# Navegação global do TDA

> Status: painel global unificado integrado; contrato e QA automatizado ativos  
> Owner: navigation / frontend / identity-access  
> Última revisão: 2026-09-28  
> Fonte de verdade: este documento, decisão #963, floating shell #995/#999 e guards/capabilities da `main`

## Objetivo

Definir uma única arquitetura de informação para o shell global do TDA, sem manter launcher, conta e aparência como superfícies concorrentes.

O contrato canônico é:

```text
marca TDA -> início
avatar    -> navegação + conta + aparência + ferramentas
```

A marca continua apontando para `/`. O avatar é o **único trigger global à direita**. Marca e avatar compõem o **chrome flutuante do shell**: o landmark `header` permanece semanticamente, mas não existe mais uma barra superior visual ou uma faixa reservada no fluxo.

## Evolução e decisão vigente

A arquitetura entregue originalmente por #879/#880/#882/#885 separava:

```text
launcher -> destinos do produto
avatar   -> conta, autenticação e aparência
```

Esse histórico continua válido como entrega realizada, mas a divisão visual/interativa foi **superseded em 2026-09-28 por #963**. A implementação vigente reúne as duas superfícies em um único painel aberto pelo avatar.

A evolução preserva:

- a projeção privada/sanitizada de Auth de #881;
- os destinos e a ordenação pública definidos em #880;
- o painel de identidade/aparência entregue em #882;
- a retirada dos hubs de #883;
- a matriz de acessibilidade e responsividade de #884;
- a densidade icon-first de #926;
- o fechamento por mudança de pathname de #947;
- guards server-side e capabilities como autoridade.

A issue #964 registrou historicamente uma transição reversível deliberadamente longa (~2 s). A consolidação #1080/#1082 supersede esse timing para navegação corrente: o painel usa resposta curta (~280 ms) e o drill-down interno é imediato. Com `prefers-reduced-motion: reduce`, a transição é removida.

## Estado de entrega

| Slice | Estado | Evidência |
| --- | --- | --- |
| projeção privada de identidade + capabilities | integrada | #881 / PR #886 |
| destinos públicos e ferramentas capability-aware | integrada | #880 / PR #890 |
| identidade + conta + aparência | integrada | #882 / PR #902 |
| retirada dos hubs `/edit` e `/conta` | integrada | #883 / PR #908 |
| gate responsivo/teclado/visual | integrado | #884 / PR #915 / #920 |
| painel global unificado por avatar | integrado | #963 |
| motion reversível do painel único | integrado pelo slice #964 |
| contrato/gates do painel único | este documento + #965 |
| shell flutuante sem barra estrutural | implementado nesta mudança | #995 / #999 |
| âncora do painel + safe-area/scrims | implementado nesta mudança | #1000 / #1001 |
| Home full-bleed no topo real | implementado nesta mudança | #1002 |
| gates do floating chrome | este documento + #996 |
| IA hierárquica / progressive disclosure | implementação candidata #1082 dentro da consolidação #1080 |

Merge em `main` não prova publicação por si só; produção continua dependendo do pipeline e dos receipts operacionais vigentes.

## Shell flutuante

O TDA preserva um `<header>` semântico, mas ele **não é uma barra visual** e não reserva altura antes do `main`.

Contrato geométrico:

- marca fixa no canto superior esquerdo;
- avatar fixo no canto superior direito;
- ambos acompanham o viewport durante scroll;
- conteúdo começa no topo real da página;
- não existe `border-bottom`, background full-width ou spacer equivalente à antiga barra;
- offsets consideram `safe-area-inset-*` com fallback quando os insets são zero;
- o wrapper transparente do shell não bloqueia interação com conteúdo fora dos controles;
- scrims/fades são locais à marca/avatar e não podem reconstruir uma navbar visual;
- `scroll-padding-block-start` ou estratégia equivalente impede âncoras/foco de terminarem totalmente escondidos sob o chrome.

Superfícies que possuam ações na primeira linha usam **corner clearance**: protegem apenas os cantos ocupados, sem reservar uma faixa horizontal inteira.

A ordem de camadas é deliberada: conteúdo comum fica abaixo do chrome global; marca/avatar e o painel global ficam acima das superfícies ordinárias; dialogs, command palettes e outras top layers modais ficam acima do chrome. A implementação não deve resolver colisões com uma escalada arbitrária de `z-index`.

### Marca

- ação de início;
- aponta para `/`;
- mantém identidade visual oficial;
- não compete com o avatar;
- pode usar scrim local para continuar legível sobre artwork ou superfícies variáveis.

### Avatar / trigger global

É o único trigger global do shell.

Requisitos:

- elemento `button`;
- target mínimo 44×44;
- `aria-expanded` sincronizado com o estado interativo;
- `aria-controls` aponta para a superfície única;
- Enter/Space alternam abertura e fechamento;
- segundo clique fecha;
- Escape fecha e devolve foco ao avatar;
- outside click/tap fecha;
- mudança de pathname fecha;
- nenhum trigger 3×3/`Abrir navegação` é renderizado no header.

O avatar **não concede autoridade**. Ele apenas abre uma superfície que projeta identidade sanitizada, navegação e ações disponíveis. Guards server-side continuam sendo a autoridade para cada rota e mutation.

## Painel global único

O painel aberto pelo avatar prioriza navegação do produto e usa progressive disclosure:

1. **Explorar** — Sessões, Mundo, Lores e Lembra;
2. **Mundo** abre uma segunda camada com a taxonomia pública;
3. **Ferramentas** abre uma segunda camada somente quando existem capabilities efetivas;
4. identidade, `Conta e acesso`, Aparência e login/logout permanecem utilidades previsíveis abaixo da navegação.

Links de destino continuam links comuns dentro de `nav`. Entradas que abrem uma camada interna são `button` e oferecem ação **Voltar** com heading de contexto. Não usar `role="menu"`/`menuitem`: trata-se de navegação de site, não de menu de aplicação.

O painel permanece ancorado ao avatar flutuante, limitado à viewport e com scroll interno em altura curta. Em mobile, sua posição deriva do inset do chrome + tamanho real do trigger + gap; não existe dependência conceitual de “altura da navbar”.

## Destinos públicos

A primeira camada de **Explorar** é deliberadamente curta:

| Rótulo | Rota / comportamento |
| --- | --- |
| Sessões | `/sessoes` |
| Mundo | drill-down contextual |
| Lores | `/lore` |
| Lembra | `/lembra` |

A camada **Mundo** preserva o macro destino e agrupa sua taxonomia:

| Rótulo | Rota |
| --- | --- |
| Explorar tudo | `/mundo` |
| Personagens | `/personagens` |
| NPCs | `/npcs` |
| Lugares | `/lugares` |
| Facções | `/faccoes` |
| Quests | `/quests` |
| Músicas | `/musicas` |
| Diários | `/diario` |

Uma deep-link de qualquer item da camada Mundo marca **Mundo** como contexto atual na primeira camada. Uma rota inexistente ou apenas planejada não entra na navegação. A navegação pública deve ficar utilizável **antes** de terminar a projeção privada de Auth e também quando Auth estiver temporariamente indisponível.

## Ferramentas autorizadas

Ferramentas aparecem em grupo separado e somente quando a projeção privada informa a capability necessária.

| Ferramenta | Destino | Capability principal para exibição |
| --- | --- | --- |
| Transcrições | `/transcricoes` | `campaign.transcript.read` |
| Editar sessões | `/edit/sessoes` | `campaign.transcript.read` |
| Processar | `/edit/processamento` | `campaign.local.process` |
| Editar mundo | `/edit/mundo` | `campaign.world.layout.edit` |
| Revisão | `/edit/revisao` | `narrative.review.read` |
| Permissões | `/edit/yuhara-main/permissions` | `campaign.permissions.manage` |

Essa tabela controla **apresentação/navegação**, não segurança. Uma ferramenta escondida continua protegida pelo guard server-side da rota; conhecer ou digitar a URL nunca substitui capability + scope.

Capabilities adicionais usadas dentro de uma ferramenta, como publicação ou revisão de escrita, continuam verificadas no boundary específico e não viram entradas separadas.

## Projeção privada de navegação

O shell público reutiliza `GET /api/auth/me` como projeção mínima:

- `anonymous`: estado/scope, sem identidade e sem capabilities privadas;
- estados autenticados: identidade sanitizada + apenas capabilities efetivas;
- `unavailable`: distinto de logout/anônimo, sem projeção privada stale;
- resposta `private, no-store` e variante por cookie;
- auth user id, grants crus, role internals e metadata integral não fazem parte do contrato.

A navegação pública aparece imediatamente. Identidade e ferramentas privadas hidratam progressivamente no cliente; não existe polling de autorização como requisito do shell.

### Estados do avatar/conta

- anônimo: fallback genérico + `Entrar com Discord`;
- autenticado com avatar: imagem sanitizada;
- autenticado sem avatar ou com falha de imagem: iniciais seguras/fallback;
- linked sem grants: conta visível, sem grupo Ferramentas;
- capability parcial: somente ferramentas autorizadas;
- capability ampla: todas as ferramentas correspondentes;
- `unavailable`: estado recuperável, Explorar permanece disponível, Ferramentas privadas não aparecem.

Imagem de avatar é apresentação, nunca prova de identidade ou permissão.

## `/edit` continua entrypoint de compatibilidade

`/edit` não volta a ser um segundo launcher.

Contrato de redirect:

1. anônimo → `/entrar?next=%2Fedit`;
2. auth/acesso indisponível → `/conta?acesso=indisponivel`;
3. linked com capabilities → primeira ferramenta autorizada pela prioridade explícita;
4. unlinked ou sem grants úteis → `/conta?acesso=negado`.

Prioridade determinística:

1. `/edit/sessoes`;
2. `/edit/processamento`;
3. `/edit/mundo`;
4. `/edit/revisao`;
5. `/edit/yuhara-main/permissions`.

Deep links continuam válidos e mantêm seus próprios guards server-side.

## `/conta` continua identidade e acesso

`/conta` permanece como destino semântico para identidade, vínculo, grants/capabilities, acesso negado e indisponibilidade.

Ela não repete a grade de ferramentas. O painel global fornece a navegação; `/conta` explica a conta e o acesso.

## Aparência

O `ThemeToggle` vive dentro do painel global.

- preferência do sistema é usada somente antes de existir escolha salva;
- depois persistir `light` ou `dark`;
- não introduzir opção `Sistema` sem nova decisão de produto;
- mover o controle não altera tokens do Design System.

## Estado atual, foco e motion

- rota atual usa `aria-current="page"`;
- subrotas pertencem ao destino raiz correspondente;
- existe uma única máquina de estado visual: `closed → opening → open → closing`;
- abertura/fechamento normal usam o token local do painel (~280 ms);
- fechamento remove interação imediatamente (`aria-hidden`/`inert`/pointer disabled) e desmonta ao término;
- abrir/fechar durante transição deve ser reversível sem painel duplicado;
- navegação interna não espera a animação terminar;
- Escape fecha e devolve foco ao avatar;
- pathname change fecha sem bloquear navegação;
- reduced motion elimina a transição longa.

## Densidade e responsividade

O painel usa hierarquia tipográfica compacta em vez de um app-grid plano.

Contrato visual:

- glyph pequeno apoia o label; não é a unidade dominante;
- primeira camada cabe normalmente em 1920×1080 sem scroll interno;
- taxonomia de Mundo e Ferramentas aparece somente após drill-down;
- `Editar sessões`, `Transcrições` e `Permissões` não podem truncar;
- largura não cresce proporcionalmente em 2K/4K;
- 320/390 permanecem utilizáveis em flow vertical;
- viewport curta pode usar scroll interno no painel, nunca overflow do body.

Matriz mínima:

- 320×800;
- 390×844;
- 768×1024;
- 1366×768;
- 1920×1080;
- 2560×1440;
- equivalente real de zoom 200% (viewport CSS reduzida);
- dark/light;
- reduced motion;
- documento rolado com marca/avatar ainda viewport-fixed;
- painel aberto após scroll;
- Home com hero ocupando o topo real.

## Acessibilidade

- trigger é `button`;
- `aria-expanded` + `aria-controls`;
- painel usa região/nav com nomes claros;
- links continuam links comuns;
- sem `role="menu"` acidental;
- `aria-current="page"`;
- foco visível;
- tab order natural;
- conteúdo fechado/closing não permanece focável;
- labels visíveis além dos ícones;
- target do avatar >=44×44;
- navegação pública não desaparece em falha de Auth.

## Testes e receipts canônicos

O gate `tests/global-navigation.spec.ts`, executado pelo job `navigation-e2e`, deve falhar se:

- o trigger 3×3/`Abrir navegação` reaparecer;
- existir mais de um trigger global de avatar;
- o avatar deixar de abrir Explorar;
- ferramenta sem capability aparecer;
- Explorar desaparecer enquanto Auth está pending/unavailable;
- dismiss/avatar toggle/Escape/pathname quebrarem;
- closing continuar interativo/focável;
- reduced motion mantiver a transição longa;
- 320/390/zoom 200% produzirem overflow;
- labels críticos truncarem;
- o painel crescer sem limite em viewports grandes;
- o shell voltar a reservar uma faixa full-width antes do conteúdo;
- marca/avatar deixarem de acompanhar o viewport;
- mobile voltar a ancorar o painel em offsets derivados da antiga navbar;
- skip link ou foco ficarem totalmente obscurecidos pelo floating chrome;
- a Home voltar a subtrair a altura antiga da barra do hero.

Receipts sintéticos obrigatórios:

- desktop dark;
- desktop light;
- mobile dark;
- mobile light.

Fixtures/receipts usam identidade e avatar sintéticos; nunca dados privados reais.

## Não objetivos

- mudar RBAC/capabilities;
- tornar capability client-side autoridade;
- criar novo endpoint concorrente de Auth;
- reintroduzir `/edit` ou `/conta` como launcher;
- adicionar destinos inexistentes;
- criar sidebar global;
- transformar o painel em command palette/search;
- introduzir uma terceira opção de tema;
- transformar navegação comum em ARIA application menu.

## Referências

- #995 / #999 — decisão e implementação do shell flutuante sem barra;
- #1000 — safe-area e scrims locais;
- #1001 — âncora do painel no avatar flutuante;
- #1002 — Home full-bleed no topo real;
- #996 — gates de floating chrome, foco, reflow e receipts;
- #963 — decisão vigente: painel único aberto pelo avatar;
- #964 — motion reversível do painel único;
- #965 — migração do contrato e browser gates;
- #879/#880/#882/#885 — histórico entregue da arquitetura anterior, superseded apenas na divisão launcher + avatar;
- #881 / PR #886 — projeção sanitizada de Auth;
- #883 / PR #908 — retirada dos hubs;
- #884 / PR #915 / #920 — gates de QA;
- #926 — compactação icon-first;
- #947 — pathname dismiss;
- #115 — pesquisa histórica do shell;
- [Identidade, Auth e autorização](../domains/identity-access.md);
- [Superfícies públicas](../design-system/public-surfaces.md);
- [Diretriz geral de UX](../design-system/ux-hierarchy.md).
