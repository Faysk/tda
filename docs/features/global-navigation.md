# Navegação global do TDA

> Status: painel global unificado integrado; contrato e QA automatizado ativos  
> Owner: navigation / frontend / identity-access  
> Última revisão: 2026-09-29  
> Fonte de verdade: este documento, decisões #963/#1082, floating shell #995/#999 e guards/capabilities da `main`

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

A issue #964 adiciona ao painel único uma transição reversível deliberadamente longa (~2 s) sem alterar os tokens globais do Design System. Com `prefers-reduced-motion: reduce`, essa transição longa é removida.

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

O painel aberto pelo avatar usa **progressive disclosure hierárquico**. O primeiro nível prioriza navegação macro:

1. **Explorar**: Sessões, Mundo, Lores e Lembra;
2. **Ferramentas**, somente quando há capabilities efetivas;
3. identidade / estado de conta;
4. `Conta e acesso`, quando aplicável;
5. Aparência;
6. login ou logout.

`Mundo` e `Ferramentas` são buttons de drill-down. Os destinos concretos continuam links comuns dentro de `nav`; não usar `role="menu"`/menuitem.

Cada segunda camada possui contexto, heading e ação Voltar. Entrar numa camada move o foco para Voltar; retornar restaura o foco ao trigger que abriu a camada. Escape fecha o painel inteiro e devolve foco ao avatar.

O painel permanece ancorado ao avatar flutuante, limitado à viewport e com scroll interno apenas quando a altura disponível exigir. Em 1920×1080, a navegação principal deve ser alcançável sem scroll. Em mobile, sua posição deriva do inset do chrome + tamanho real do trigger + gap.

## Destinos públicos

A primeira camada canônica de **Explorar** é estável entre desktop e mobile:

| Rótulo | Destino |
| --- | --- |
| Sessões | `/sessoes` |
| Mundo | drill-down |
| Lores | `/lore` |
| Lembra | `/lembra` |

A camada **Mundo** agrupa a taxonomia:

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

Quando a rota atual pertence à taxonomia acima, `Mundo` permanece visualmente marcado no primeiro nível e o link concreto recebe `aria-current="page"` na segunda camada.

Uma rota inexistente ou apenas planejada não entra em Explorar. A navegação pública deve continuar utilizável antes de terminar a projeção privada de Auth e também quando Auth estiver temporariamente indisponível.

## Ferramentas autorizadas

Ferramentas aparecem como um drill-down separado e somente quando a projeção privada informa ao menos uma capability necessária. A segunda camada contém exclusivamente as ferramentas autorizadas.

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

- rota concreta usa `aria-current="page"`;
- deep links de Personagens/NPCs/Lugares/Facções/Quests/Músicas/Diários mantêm `Mundo` marcado no primeiro nível;
- existe uma única máquina de estado visual do painel: `closed → opening → open → closing`;
- abertura/fechamento externo normal continuam usando o token local deliberado de ~2000 ms de #964;
- drill-down interno usa transição curta (~180 ms), não bloqueia clique/teclado e é removido com reduced motion;
- fechamento remove interação imediatamente (`aria-hidden`/`inert`/pointer disabled) e desmonta ao término;
- abrir/fechar durante transição externa continua reversível sem painel duplicado;
- Escape fecha e devolve foco ao avatar;
- pathname change e outside dismiss continuam fechando a superfície global.

## Densidade e responsividade

O primeiro nível usa lista tipográfica/hierárquica compacta. Ícones apoiam reconhecimento, mas não são a unidade dominante.

Contrato visual:

- linhas com target confortável e pouca ornamentação;
- sem card/borda individual para cada item neutro;
- current/foco usam dourado apenas como acento;
- labels longos não truncam nem criam overflow;
- o painel não cresce proporcionalmente em 2K/4K;
- 320/390 px permanecem sem overflow horizontal;
- 1920×1080 alcança a navegação principal sem scroll;
- viewport curta pode usar o scroll interno do painel.

Matriz mínima:

- 320×800;
- 390×844;
- 768×1024;
- 1366×768;
- 1920×1080;
- 2560×1440;
- equivalente real de zoom 200% (viewport CSS reduzida);
- dark/light;
- reduced motion.

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
- o primeiro nível voltar a listar a taxonomia completa como destinos equivalentes;
- Mundo não abrir/voltar por teclado e pointer;
- um deep link do Mundo perder indicação no primeiro nível ou `aria-current` no link concreto;
- ferramenta sem capability aparecer;
- Ferramentas desaparecer quando capabilities válidas existirem;
- Explorar desaparecer enquanto Auth está pending/unavailable;
- Conta/Aparência/login/logout deixarem de existir no primeiro nível;
- dismiss/avatar toggle/Escape/pathname quebrarem;
- closing continuar interativo/focável;
- reduced motion mantiver a transição longa ou o motion interno;
- 320/390/zoom 200% produzirem overflow;
- 1920×1080 exigir scroll apenas para alcançar a navegação principal;
- o painel crescer sem limite em viewports grandes;
- o shell voltar a reservar uma faixa full-width antes do conteúdo.

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
