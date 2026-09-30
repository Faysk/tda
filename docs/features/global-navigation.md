# Navegação global do TDA

> Status: launcher global seccionado implementado; validação automatizada em revisão  
> Owner: navigation / frontend / identity-access  
> Última revisão: 2026-09-30  
> Fonte de verdade: este documento, decisões #963/#1082/#1188/#1189, floating shell #995/#999 e guards/capabilities da `main`

## Objetivo

Definir uma única arquitetura de informação para o shell global do TDA, sem manter launcher, conta e aparência como superfícies concorrentes.

O contrato canônico continua:

```text
marca TDA -> início
avatar    -> navegação + conta + aparência + ferramentas
```

A marca continua apontando para `/`. O avatar é o **único trigger global à direita**. Marca e avatar compõem o **chrome flutuante do shell**: o landmark `header` permanece semanticamente, mas não existe barra superior visual ou faixa reservada no fluxo.

Dentro do painel, a composição vigente passa a ser um **launcher seccionado**: grid icon-first para destinos de produto, separação tonal entre grupos coerentes e uma única superfície rolável.

## Evolução e decisão vigente

A arquitetura entregue originalmente por #879/#880/#882/#885 separava:

```text
launcher -> destinos do produto
avatar   -> conta, autenticação e aparência
```

Essa divisão foi substituída em 2026-09-28 por #963: o avatar virou o único trigger e passou a abrir a superfície unificada.

A issue #1082 reorganizou corretamente a informação por **progressive disclosure**, removendo a taxonomia inteira de Mundo do primeiro nível. Essa decisão de arquitetura permanece.

Em 2026-09-30, #1188/#1189 evoluem a **composição visual e de acesso** sem desfazer #1082:

- `Explorar` mantém apenas Sessões, Mundo, Lores e Lembra;
- `Mundo` continua sendo o único drill-down de taxonomia;
- `Ferramentas` deixa de exigir uma segunda camada e vira uma seção de launcher no primeiro nível, filtrada por capabilities;
- conta, aparência e sessão continuam fora do grid de apps;
- o painel passa a assumir scroll interno como comportamento normal em viewports curtos;
- a transição externa histórica de ~2 s de #964 é substituída por motion de utilitário baseado nos tokens do Design System.

A referência de organização é o modelo mental de app launcher do Google: grid regular, ícone + label, painel limitado e scroll interno. Não copiar branding, ícones, cores ou medidas do Google.

## Estado de entrega

| Slice | Estado | Evidência |
| --- | --- | --- |
| projeção privada de identidade + capabilities | integrada | #881 / PR #886 |
| destinos públicos e ferramentas capability-aware | integrada | #880 / PR #890 |
| identidade + conta + aparência | integrada | #882 / PR #902 |
| retirada dos hubs `/edit` e `/conta` | integrada | #883 / PR #908 |
| gate responsivo/teclado/visual histórico | integrado | #884 / PR #915 / #920 |
| painel global unificado por avatar | integrado | #963 |
| progressive disclosure de Mundo | integrado | #1082 / PR #1102 |
| shell flutuante sem barra estrutural | integrado | #995 / #999 |
| âncora do painel + safe-area/scrims | integrado | #1000 / #1001 |
| Home full-bleed no topo real | integrado | #1002 |
| launcher seccionado / IA híbrida | implementado nesta mudança | #1188 / #1189 |
| grid icon-first + camadas tonais | implementado nesta mudança | #1190 |
| scroll/foco/motion de utilitário | implementado nesta mudança | #1191 |
| gates do launcher seccionado | implementados nesta mudança | #1192 |

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

Superfícies com ações na primeira linha usam **corner clearance** apenas onde marca/avatar realmente ocupam espaço.

A ordem de camadas é deliberada: conteúdo comum abaixo do chrome; marca/avatar/painel acima das superfícies ordinárias; dialogs e top layers modais acima do chrome. Não resolver colisões com escalada arbitrária de `z-index`.

### Marca

- ação de início;
- aponta para `/`;
- mantém identidade oficial;
- não compete com o avatar;
- pode usar scrim local para legibilidade sobre artwork.

### Avatar / trigger global

É o único trigger global.

Requisitos:

- `button`;
- target mínimo 44×44;
- `aria-expanded` sincronizado;
- `aria-controls` aponta para a superfície única;
- Enter/Space alternam abertura/fechamento;
- segundo clique fecha;
- Escape fecha e devolve foco ao avatar;
- outside click/tap fecha;
- mudança de pathname fecha;
- nenhum trigger 3×3/`Abrir navegação` volta ao header.

O avatar **não concede autoridade**. Guards server-side continuam sendo a autoridade para cada rota e mutation.

## Painel global único

O painel é uma superfície única, ancorada ao avatar, limitada à viewport e com **um único dono de scroll vertical**.

Não criar scrollers independentes para Explorar, Ferramentas ou Conta.

### Primeiro nível — launcher seccionado

Ordem canônica:

1. **Explorar**
2. **Ferramentas**, somente se houver capability efetiva
3. **Conta e preferência**

A separação usa simultaneamente:

- headings;
- espaçamento;
- containers semânticos;
- bordas/superfícies tonais discretas.

Cor nunca é o único sinal de agrupamento.

### Explorar

| Rótulo | Tipo | Destino |
| --- | --- | --- |
| Sessões | link | `/sessoes` |
| Mundo | disclosure | segunda camada |
| Lores | link | `/lore` |
| Lembra | link | `/lembra` |

Cada destino usa composição **ícone acima + label visível abaixo**.

`Mundo` continua visualmente marcado quando a rota atual pertence à sua taxonomia.

### Segunda camada — Mundo

| Rótulo | Destino |
| --- | --- |
| Explorar tudo | `/mundo` |
| Personagens | `/personagens` |
| NPCs | `/npcs` |
| Lugares | `/lugares` |
| Facções | `/faccoes` |
| Quests | `/quests` |
| Músicas | `/musicas` |
| Diários | `/diario` |

A segunda camada usa a mesma gramática de launcher.

Ao entrar:

- o painel volta visualmente ao topo;
- o foco vai para `Voltar`;
- Escape continua fechando o painel inteiro.

Ao voltar:

- a camada raiz é restaurada;
- o foco volta para `Mundo`;
- a posição de scroll anterior da raiz é restaurada quando relevante.

A rota concreta recebe `aria-current="page"`.

## Ferramentas autorizadas

Ferramentas aparecem diretamente em uma seção própria do launcher e somente quando a projeção privada informa a capability necessária.

| Ferramenta | Destino | Capability principal para exibição |
| --- | --- | --- |
| Transcrições | `/transcricoes` | `campaign.transcript.read` |
| Editar sessões | `/edit/sessoes` | `campaign.transcript.read` |
| Processar | `/edit/processamento` | `campaign.local.process` |
| Editar mundo | `/mundo` | `campaign.world.layout.edit` |
| Revisão | `/edit/revisao` | `narrative.review.read` |
| Permissões | `/edit/yuhara-main/permissions` | `campaign.permissions.manage` |

Regras:

- ferramenta sem capability não aparece;
- não renderizar placeholders desabilitados;
- ordem permanece determinística;
- presentation filtering não substitui guard server-side;
- `Editar mundo` compartilha a rota `/mundo`, mas a indicação canônica de página atual permanece com o destino público `Mundo`, evitando duas marcas de `aria-current` para a mesma rota.

## Conta e preferência

Conta é uma superfície utilitária, não um conjunto de apps.

Autenticado:

- identidade sanitizada;
- `Conta e acesso`;
- Aparência;
- Sair.

Anônimo:

- orientação curta;
- Entrar com Discord;
- Aparência.

`unavailable`:

- Explorar continua utilizável;
- ferramentas privadas não aparecem;
- estado recuperável + ação para tentar novamente;
- não reutilizar projection privada stale.

## Projeção privada de navegação

O shell reutiliza `GET /api/auth/me` como projeção mínima:

- `anonymous`: estado/scope, sem identidade/capabilities privadas;
- autenticados: identidade sanitizada + capabilities efetivas;
- `unavailable`: distinto de logout/anônimo;
- resposta `private, no-store` e variante por cookie;
- auth user id, grants crus, role internals e metadata integral não fazem parte do contrato.

A navegação pública aparece imediatamente. Identidade e ferramentas hidratam progressivamente no cliente.

### Estados do avatar/conta

- anônimo: fallback genérico;
- autenticado com avatar: imagem sanitizada;
- autenticado sem avatar/falha de imagem: iniciais seguras/fallback;
- linked sem grants: conta visível, sem Ferramentas;
- capability parcial: somente ferramentas autorizadas;
- capability ampla: conjunto correspondente;
- unavailable: Explorar permanece, ferramentas privadas somem.

Imagem de avatar é apresentação, nunca prova de identidade/permissão.

## `/edit` continua entrypoint de compatibilidade

`/edit` não volta a ser um segundo launcher.

Contrato:

1. anônimo → `/entrar?next=%2Fedit`;
2. auth/acesso indisponível → `/conta?acesso=indisponivel`;
3. linked com capabilities → primeira ferramenta autorizada pela prioridade explícita;
4. unlinked/sem grants úteis → `/conta?acesso=negado`.

Prioridade determinística:

1. `/edit/sessoes`;
2. `/edit/processamento`;
3. `/mundo`;
4. `/edit/revisao`;
5. `/edit/yuhara-main/permissions`.

Deep links mantêm seus próprios guards.

## `/conta` continua identidade e acesso

`/conta` permanece destino para identidade, vínculo, grants/capabilities, acesso negado e indisponibilidade.

Ela não repete a grade de ferramentas.

## Aparência

O `ThemeToggle` vive dentro do painel.

- preferência do sistema somente antes de escolha salva;
- depois persistir `light` ou `dark`;
- não introduzir opção Sistema sem nova decisão;
- mover o controle não altera tokens do Design System.

## Camadas visuais

O launcher reutiliza a gramática semântica existente:

- shell: `--ds-surface-elevated`;
- Explorar / Mundo: superfície primária;
- Ferramentas: superfície secundária;
- Conta e preferência: superfície utilitária mais quieta;
- hover: `--ds-surface-hover`;
- current: `--ds-accent-muted`;
- foco: `--ds-control-focus-ring`.

O dourado continua acento raro. Não usar cor como único significado.

Não criar borda/card pesado permanente em cada célula neutra.

## Densidade e responsividade

A geometria padrão do launcher é icon-first.

- desktop/tablet: 3 colunas;
- 390 px: preservar 3 colunas quando labels reais couberem;
- <=360 px / zoom alto: 2 colunas;
- labels podem ocupar duas linhas;
- painel não cresce proporcionalmente em 2K/4K;
- short viewport usa scroll em vez de encolher targets;
- sem scroll horizontal.

Matriz mínima:

- 320×800;
- 390×844;
- 768×1024;
- 1366×768;
- 1920×1080;
- 2560×1440;
- 683×384 como aproximação automatizada de zoom/reflow alto;
- viewport desktop curta;
- dark/light;
- reduced motion.

## Scroll

O painel é o único scroll owner vertical.

- `overflow-y: auto`;
- `overscroll-behavior: contain` como progressive enhancement;
- scrollbar nativa continua disponível;
- `scrollbar-gutter: stable` pode estabilizar a geometria;
- sections internas não criam nested scroll;
- foco abaixo da dobra deve permanecer visível;
- não fixar footer/logout de forma que esconda itens focados.

## Estado, foco e motion

- máquina visual única: `closed → opening → open → closing`;
- abertura/fechamento usam motion de utilitário baseado em `--ds-motion-base`;
- timing deve permanecer abaixo de 600ms;
- drill-down interno usa motion curto baseado nos tokens;
- interação nunca espera animação terminar;
- fechamento torna a superfície `inert`/não-interativa imediatamente;
- abrir/fechar durante transição continua reversível;
- reduced motion remove deslocamento/transições longas;
- Escape fecha e devolve foco ao avatar;
- pathname change e outside dismiss continuam fechando;
- navegação por link não devolve foco artificialmente ao avatar.

## Acessibilidade

- trigger é `button`;
- `aria-expanded` + `aria-controls`;
- painel usa região/nav nomeados;
- links continuam links;
- `Mundo` continua button de disclosure;
- sem `role="menu"`/`menuitem` acidental;
- sem grid ARIA de aplicação;
- `aria-current="page"` no destino concreto;
- foco visível;
- ordem de Tab natural;
- conteúdo closing não permanece focável;
- labels sempre visíveis além dos ícones;
- target do avatar >=44×44;
- células possuem target confortável;
- agrupamento/current não dependem apenas de cor;
- foco não pode ser obscurecido por fades/overlays.

## Testes e receipts canônicos

O gate `tests/global-navigation.spec.ts`, executado pelo job `navigation-e2e`, deve falhar se:

- trigger 3×3 reaparecer;
- existir mais de um trigger global de avatar;
- taxonomia de Mundo voltar ao primeiro nível;
- Mundo perder drill-down/Back/foco;
- ferramenta sem capability aparecer;
- Ferramentas desaparecer com capabilities válidas;
- conta/aparência virarem células de app;
- Explorar desaparecer enquanto Auth está pending/unavailable;
- current route/`aria-current` quebrarem;
- dismiss/avatar toggle/Escape/pathname quebrarem;
- closing continuar interativo/focável;
- motion de ~2s retornar;
- reduced motion mantiver deslocamento longo;
- section interna virar segundo scroll owner;
- foco abaixo da dobra ficar obscurecido;
- 320/390/zoom produzirem overflow;
- grid perder 3 colunas onde contratado ou 2 colunas no fallback;
- labels essenciais forem truncados/ocultos.

Receipts sintéticos mínimos:

- desktop dark/light;
- mobile 390 dark/light;
- 320 fallback;
- Mundo;
- capabilities parciais;
- capabilities amplas + região utilitária após scroll;
- deep link dentro de Mundo.

Fixtures nunca usam identidade/avatares privados reais.

## Não objetivos

- mudar RBAC/capabilities;
- tornar capability client-side autoridade;
- criar endpoint de Auth concorrente;
- reintroduzir `/edit` ou `/conta` como launcher;
- adicionar destinos inexistentes;
- criar sidebar global;
- command palette/search;
- drag-and-drop/reordenação/favoritos;
- nova biblioteca de ícones apenas para o painel;
- copiar visual/branding/assets do Google;
- transformar navegação comum em ARIA application menu;
- introduzir terceira opção de tema.

## Referências

- #1188 — epic do launcher seccionado;
- #1189 — IA híbrida e agrupamento;
- #1190 — grid icon-first e hierarquia tonal;
- #1191 — scroll, foco, drill-down e motion;
- #1192 — gates responsivos/a11y/visuais;
- #1082 / PR #1102 — progressive disclosure de Mundo, preservado;
- #995 / #999 — shell flutuante;
- #1000 / #1001 — safe-area, scrims e âncora do painel;
- #1002 — Home full-bleed;
- #996 — gates do floating chrome;
- #963 — painel único aberto pelo avatar;
- #964 — decisão histórica de motion ~2 s, substituída pelo launcher de utilitário;
- #965 — contrato/browser gates do painel único;
- #879/#880/#882/#885 — arquitetura histórica do launcher separado;
- #881 / PR #886 — projeção sanitizada de Auth;
- #883 / PR #908 — retirada dos hubs;
- #884 / PR #915 / #920 — QA histórico;
- #926 — referência histórica icon-first/Google launcher;
- #947 — pathname dismiss;
- #115 — pesquisa histórica do shell;
- [Identidade, Auth e autorização](../domains/identity-access.md);
- [Superfícies públicas](../design-system/public-surfaces.md);
- [Diretriz geral de UX](../design-system/ux-hierarchy.md).
