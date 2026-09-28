# Navegação global do TDA

> Status: painel global unificado integrado; contrato e QA automatizado ativos  
> Owner: navigation / frontend / identity-access  
> Última revisão: 2026-09-28  
> Fonte de verdade: este documento, decisão #963, motion #964 e guards/capabilities da `main`

## Objetivo

Definir uma única arquitetura de informação para o shell global do TDA, sem manter launcher, conta e aparência como superfícies concorrentes.

O contrato canônico é:

```text
marca TDA -> início
avatar    -> navegação + conta + aparência + ferramentas
```

A marca continua apontando para `/`. O avatar é o **único trigger global à direita** do header.

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

Merge em `main` não prova publicação por si só; produção continua dependendo do pipeline e dos receipts operacionais vigentes.

## Responsabilidades do header

### Marca

- ação de início;
- aponta para `/`;
- mantém identidade visual oficial;
- não compete com o avatar.

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

O painel aberto pelo avatar reúne, nessa hierarquia semântica:

1. identidade / estado de conta;
2. `Conta e acesso`, quando aplicável;
3. Aparência;
4. **Explorar**;
5. **Ferramentas**, apenas quando há capabilities efetivas;
6. login ou logout.

Links de navegação continuam links comuns dentro de `nav`. Não usar `role="menu"`/`menuitem`: trata-se de navegação de site, não de menu de aplicação.

O painel permanece ancorado ao avatar, limitado à viewport e com scroll interno em altura curta.

## Destinos públicos

A ordem canônica de **Explorar** é estável entre desktop e mobile:

| Rótulo | Rota |
| --- | --- |
| Sessões | `/sessoes` |
| Lembra | `/lembra` |
| Lores | `/lore` |
| Mundo | `/mundo` |
| Personagens | `/personagens` |
| NPCs | `/npcs` |
| Lugares | `/lugares` |
| Facções | `/faccoes` |
| Quests | `/quests` |
| Músicas | `/musicas` |
| Diários | `/diario` |

Uma rota inexistente ou apenas planejada não entra em Explorar. A lista muda somente quando a superfície correspondente existe e a decisão de produto é atualizada aqui.

A navegação pública deve ficar utilizável **antes** de terminar a projeção privada de Auth e também quando Auth estiver temporariamente indisponível.

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
- abertura/fechamento normal usam o token local do painel (~2000 ms);
- fechamento remove interação imediatamente (`aria-hidden`/`inert`/pointer disabled) e desmonta ao término;
- abrir/fechar durante transição deve ser reversível sem painel duplicado;
- navegação interna não espera a animação terminar;
- Escape fecha e devolve foco ao avatar;
- pathname change fecha sem bloquear navegação;
- reduced motion elimina a transição longa.

## Densidade e responsividade

O painel preserva o glyph icon-first (~34 px desktop; ~32 px em largura estreita quando necessário) e ganha densidade reduzindo gap, padding e altura das células.

Contrato visual:

- ícone acima do label;
- labels visíveis em até duas linhas;
- células menores que a antiga baseline de 96 px;
- `Editar sessões`, `Transcrições` e `Permissões` não podem truncar;
- 390 px tenta 3 colunas;
- <=360 px pode usar 2;
- largura não cresce proporcionalmente em 2K/4K;
- viewport curta usa scroll interno no painel, não overflow do body.

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
- o avatar deixar de abrir Explorar;
- ferramenta sem capability aparecer;
- Explorar desaparecer enquanto Auth está pending/unavailable;
- dismiss/avatar toggle/Escape/pathname quebrarem;
- closing continuar interativo/focável;
- reduced motion mantiver a transição longa;
- 320/390/zoom 200% produzirem overflow;
- labels críticos truncarem;
- o painel crescer sem limite em viewports grandes.

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
