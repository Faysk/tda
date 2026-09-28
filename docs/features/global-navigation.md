# Navegação global do TDA

> Status: arquitetura aprovada; implementação incremental em andamento
> Owner: navigation / frontend / identity-access
> Última revisão: 2026-09-28
> Fonte de verdade: este documento, epic #879 e guards/capabilities da `main`

## Objetivo

Definir uma única arquitetura de informação para o shell global do TDA, sem manter header textual, `/edit` e `/conta` como três menus concorrentes.

O contrato é:

```text
marca TDA -> início
launcher  -> destinos do produto
avatar    -> conta, autenticação e aparência
```

A marca continua apontando para `/`. O launcher não repete uma entrada `Início`.

## Estado de entrega

Este documento separa **decisão aprovada** de **implementação/publicação**.

Baseline revalidada desta revisão: `main@08ea4cf0c31e48e827c9da829cfe77dfc15392c1`.

| Slice | Estado nesta baseline | Evidência |
| --- | --- | --- |
| projeção privada de identidade + capabilities | integrada à `main` | #881 / PR #886 |
| launcher global | integrada à `main` | #880 / PR #890 |
| avatar/painel de conta | pendente de integração; depende do launcher | #882 |
| retirada dos hubs `/edit` e `/conta` | pendente de integração | #883 |
| gate responsivo/teclado/visual completo | pendente | #884 |
| contrato documental | este documento | #885 |

O launcher de #880 já está integrado na `main`. Enquanto #882/#883 não estiverem integradas, o runtime continua com `ThemeToggle` separado e os hubs `/edit`/`/conta` atuais. Isso é **estado transitório de implementação**, não o contrato final do produto.

Merge em `main` também não prova publicação por si só; produção continua dependendo do pipeline e dos receipts operacionais vigentes.

## Responsabilidades do header

### Marca

- ação de início;
- aponta para `/`;
- mantém identidade visual oficial;
- não compete com launcher ou avatar.

### Launcher

É o ponto único para navegar pelo produto.

O trigger é um botão próprio, separado do avatar, com alvo mínimo de 44×44 e nome acessível claro. O painel usa links normais dentro de um `nav`; não usar `role="menu"`/`menuitem`, porque a interação é navegação de site e não menu de aplicação.

### Avatar

É o ponto único para identidade, autenticação, estado de acesso e aparência.

O avatar **não concede autoridade**. Ele apenas apresenta a identidade já sanitizada e ações de conta. Guards server-side continuam sendo a autoridade para cada rota e mutation.

## Destinos públicos

A ordem canônica do launcher é estável entre desktop e mobile:

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

Uma rota inexistente ou apenas planejada não entra no launcher. A lista muda somente quando a superfície correspondente realmente existe e a decisão de produto for atualizada aqui.

## Ferramentas autorizadas

Ferramentas aparecem em grupo separado dos destinos públicos e somente quando a projeção privada informa a capability necessária.

| Ferramenta | Destino | Capability principal para exibição |
| --- | --- | --- |
| Transcrições | `/transcricoes` | `campaign.transcript.read` |
| Editar sessões | `/edit/sessoes` | `campaign.transcript.read` |
| Processar | `/edit/processamento` | `campaign.local.process` |
| Editar mundo | `/edit/mundo` | `campaign.world.layout.edit` |
| Revisão | `/edit/revisao` | `narrative.review.read` |
| Permissões | `/edit/yuhara-main/permissions` | `campaign.permissions.manage` |

Essa tabela controla **apresentação/navegação**, não segurança. Uma ferramenta escondida continua protegida pelo guard server-side da rota; conhecer ou digitar a URL nunca substitui capability + scope.

Capabilities adicionais usadas dentro de uma ferramenta, como publicação, revisão de escrita ou gestão de atividade, continuam sendo verificadas no boundary específico e não precisam virar entradas separadas do launcher.

## Projeção privada de navegação

O shell público não chama `currentAccess()` no root layout para decidir se pode renderizar.

O contrato integrado em #881 reutiliza `GET /api/auth/me` como projeção mínima:

- `anonymous`: retorna estado/scope, sem `identity` e sem `capabilities`;
- estados autenticados: podem retornar `identity { displayName, avatarUrl }` sanitizada e apenas capabilities efetivas;
- `unavailable`: é distinto de logout/anônimo e responde sem uma projeção privada stale;
- resposta é `private, no-store` e varia por cookie;
- auth user id, profile id, grants crus, role internals e metadata integral não fazem parte do contrato.

A navegação pública aparece imediatamente e continua utilizável se esse endpoint falhar. Identidade e ferramentas privadas hidratam progressivamente no cliente; não há polling de autorização como requisito do shell.

### Avatar

Somente a URL de avatar já sanitizada pelo boundary de Auth pode ser usada pela UI.

Estados esperados:

- anônimo: silhueta/fallback genérico;
- autenticado com avatar: imagem sanitizada;
- autenticado sem avatar ou com falha de imagem: iniciais seguras ou fallback genérico;
- dependency unavailable: fallback visual + estado recuperável, sem fingir logout.

Imagem de avatar é apresentação, nunca prova de identidade ou permissão.

## `/edit` deixa de ser menu

Depois da integração de #883, `/edit` é apenas entrypoint de compatibilidade para bookmarks antigos.

Contrato de redirect:

1. anônimo → `/entrar?next=%2Fedit`;
2. auth/acesso indisponível → `/conta?acesso=indisponivel`;
3. linked com capabilities → primeira ferramenta autorizada pela prioridade explícita abaixo;
4. unlinked ou sem grants úteis → `/conta?acesso=negado`.

Prioridade determinística:

1. `/edit/sessoes`;
2. `/edit/processamento`;
3. `/edit/mundo`;
4. `/edit/revisao`;
5. `/edit/yuhara-main/permissions`.

A ordem não pode depender de `Object.values()`, ordem de objeto ou outro detalhe acidental de implementação.

Deep links continuam válidos e mantêm seus próprios guards server-side.

## `/conta` é conta e acesso

`/conta` permanece como destino semântico para:

- identidade resumida;
- conta autenticada ainda não vinculada;
- linked sem grants;
- acesso negado a uma ferramenta;
- dependência de Auth/acesso indisponível;
- consulta deliberada ao estado da conta.

Ela não repete cards de Transcrições/Edit/Permissões/Processamento. Ferramentas pertencem ao launcher.

Copy de links deve usar **Conta e acesso** quando o objetivo for explicar vínculo/permissão, em vez de tratar `/conta` como um menu de aplicações.

## Aparência

Após #882:

- o `ThemeToggle` deixa de ocupar espaço isolado no header;
- o controle de aparência vive dentro do painel de conta;
- a regra existente permanece binária: preferência do sistema apenas antes de existir escolha salva; depois persistir `light` ou `dark`;
- não introduzir opção `Sistema` sem nova decisão de produto.

Mover o controle não altera o contrato de tema nem os tokens do Design System.

## Estado atual e matching de rota

- link da rota atual usa `aria-current="page"`;
- subrotas pertencem ao destino raiz correspondente;
- launcher e avatar têm estados abertos independentes;
- fechar por Escape devolve foco ao trigger que abriu o painel;
- light-dismiss/click fora fecha quando aplicável;
- conteúdo fechado não permanece focável.

## Responsividade e acessibilidade

Matriz mínima do contrato:

- 320×800;
- 390×844;
- 768×1024;
- 1366×768;
- 1920×1080;
- 2560×1440;
- zoom 200%;
- temas claro/escuro;
- `prefers-reduced-motion`.

Requisitos:

- sem overflow horizontal;
- trigger com alvo mínimo de 44×44;
- ícone **e rótulo** visíveis dentro do launcher;
- não depender de tooltip/hover para explicar destino;
- foco visível com tokens do TDA;
- ordem estável entre breakpoints;
- mobile pode reorganizar a composição e usar painel/sheet amplo; não é um popover desktop espremido;
- painel com scroll interno quando necessário;
- Escape, Enter, Space, Tab, toque e ponteiro preservam semântica previsível;
- navegação pública não desaparece quando Auth está indisponível.

## Ícones e linguagem visual

- preferir SVGs locais simples e consistentes;
- não adicionar pacote de ícones apenas para o launcher;
- dourado é acento de foco/estado atual, não borda em todos os itens;
- launcher é navegação compacta; não transformar cada destino em card pesado;
- identidade visual continua vindo dos tokens, tipografia, ritmo e composição do TDA.

## Testes e gates

O rollout completo deve cobrir:

- modelo de destinos e matching de subrotas;
- combinações de capabilities com fixture sanitizada;
- anonymous/authenticated/unavailable;
- desktop/mobile;
- click/toque/Enter/Space;
- Escape + retorno de foco;
- outside click;
- `aria-current`;
- ferramenta sem capability ausente;
- deep link sem capability negado pelo servidor;
- 320px e zoom 200% sem overflow;
- dark/light e reduced motion;
- regressão de skip-link, header e footer;
- prova de que falha de `/api/auth/me` não remove destinos públicos.

Screenshots/receipts de teste usam identidades e avatares sintéticos, nunca dados privados reais.

## Não objetivos

- trocar o modelo de RBAC;
- tornar capability client-side autoridade;
- criar novo endpoint concorrente de Auth;
- usar `/edit` ou `/conta` como segundo launcher;
- drag-and-drop/reordenação do launcher;
- introduzir uma terceira opção de tema;
- transformar navegação comum em ARIA application menu.

## Referências

- #879 — epic da navegação global;
- #880 — launcher;
- #881 / PR #886 — projeção sanitizada de Auth;
- #882 — avatar/painel de conta;
- #883 — retirada dos hubs;
- #884 — gates de QA;
- #885 — contrato documental;
- #115 — pesquisa histórica que levantou avatar Discord no header, papel de `/conta` e organização do Edit;
- PR #269 — implementação histórica relevante para a evolução do shell/navegação;
- PR #579 — implementação histórica relevante para a evolução do shell/navegação;
- [Identidade, Auth e autorização](../domains/identity-access.md);
- [Superfícies públicas](../design-system/public-surfaces.md);
- [Diretriz geral de UX](../design-system/ux-hierarchy.md).
