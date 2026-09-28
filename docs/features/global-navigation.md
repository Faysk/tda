# Navegação global do TDA

> Status: contrato canônico do painel global unificado; QA automatizado ativo
> Owner: navigation / frontend / identity-access
> Última revisão: 2026-09-28
> Fonte de verdade: este documento, decisão #963, motion #964 e guards/capabilities da `main`

## Objetivo

Definir uma única arquitetura de informação para o shell global do TDA, sem manter launcher, avatar, `/edit` e `/conta` como menus concorrentes.

O contrato vigente desde a decisão de 2026-09-28 é:

```text
marca TDA -> início
avatar    -> navegação + conta + aparência + ferramentas
```

A marca continua apontando para `/`. O avatar é o **único trigger global à direita** do header e abre uma única superfície de disclosure. Não existe trigger 3×3 separado.

## Relação com o contrato histórico

#879/#882/#885 continuam sendo histórico válido das entregas anteriores. A decisão #963 as **supersede somente na divisão visual/interativa entre launcher e avatar**.

Continuam preservados:

- destinos e ordem pública definidos pelo trabalho anterior;
- projeção sanitizada de Auth/capabilities de #881;
- `/edit` como entrypoint de compatibilidade;
- `/conta` como superfície de identidade/acesso;
- guards server-side como autoridade;
- matching de rota e `aria-current="page"`;
- requisitos de teclado, responsividade, contraste e reduced motion.

#964 adiciona a animação reversível do painel único sem alterar essa arquitetura de informação nem autorização.

## Responsabilidades do header

### Marca

- ação de início;
- aponta para `/`;
- mantém identidade visual oficial;
- não compete com o avatar.

### Avatar / painel global

É o único ponto de entrada global para:

1. identidade/conta;
2. aparência;
3. Explorar;
4. Ferramentas autorizadas;
5. login/logout.

O trigger é um `button` com alvo mínimo de 44×44, `aria-expanded` e `aria-controls` apontando para a superfície única.

O painel usa links normais dentro de `nav`; não usar `role="menu"`/`menuitem`, porque a interação é navegação de site e não menu de aplicação.

O avatar **não concede autoridade**. Ele apenas apresenta identidade já sanitizada e ações disponíveis. Guards server-side continuam sendo a autoridade para cada rota e mutation.

## Destinos públicos

A ordem canônica em **Explorar** é estável entre desktop e mobile:

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

Uma rota inexistente ou apenas planejada não entra no painel. A lista muda somente quando a superfície correspondente realmente existe e a decisão de produto for atualizada aqui.

## Ferramentas autorizadas

Ferramentas aparecem em grupo separado de **Explorar** e somente quando a projeção privada informa a capability necessária.

| Ferramenta | Destino | Capability principal para exibição |
| --- | --- | --- |
| Transcrições | `/transcricoes` | `campaign.transcript.read` |
| Editar sessões | `/edit/sessoes` | `campaign.transcript.read` |
| Processar | `/edit/processamento` | `campaign.local.process` |
| Editar mundo | `/edit/mundo` | `campaign.world.layout.edit` |
| Revisão | `/edit/revisao` | `narrative.review.read` |
| Permissões | `/edit/yuhara-main/permissions` | `campaign.permissions.manage` |

Essa tabela controla **apresentação/navegação**, não segurança. Uma ferramenta escondida continua protegida pelo guard server-side da rota; conhecer ou digitar a URL nunca substitui capability + scope.

Capabilities adicionais usadas dentro de uma ferramenta, como publicação, revisão de escrita ou gestão de atividade, continuam sendo verificadas no boundary específico e não precisam virar entradas separadas do painel global.

## Projeção privada de navegação

O shell público não chama `currentAccess()` no root layout para decidir se pode renderizar.

O contrato integrado em #881 reutiliza `GET /api/auth/me` como projeção mínima:

- `anonymous`: retorna estado/scope, sem `identity` e sem `capabilities`;
- estados autenticados: podem retornar `identity { displayName, avatarUrl }` sanitizada e apenas capabilities efetivas;
- `unavailable`: é distinto de logout/anônimo e responde sem uma projeção privada stale;
- resposta é `private, no-store` e varia por cookie;
- auth user id, profile id, grants crus, role internals e metadata integral não fazem parte do contrato.

**Explorar aparece imediatamente**, inclusive enquanto a projeção privada está pendente ou indisponível. Identidade e Ferramentas hidratam progressivamente; falha de Auth não remove a navegação pública.

### Estados do avatar

- anônimo: silhueta/fallback genérico + ação Entrar com Discord;
- autenticado com avatar: imagem sanitizada;
- autenticado sem avatar ou com falha de imagem: iniciais seguras/fallback;
- linked sem grants: identidade/conta, aparência e Explorar, sem Ferramentas;
- capability parcial: somente as ferramentas autorizadas;
- capability ampla: conjunto completo autorizado;
- dependency unavailable: fallback visual + estado recuperável, sem fingir logout nem expor Ferramentas privadas.

Imagem de avatar é apresentação, nunca prova de identidade ou permissão.

## `/edit` continua sendo entrypoint de compatibilidade

`/edit` não volta a ser hub de aplicações.

Contrato de redirect:

1. anônimo → `/entrar?next=%2Fedit`;
2. auth/acesso indisponível → `/conta?acesso=indisponivel`;
3. linked com capabilities → primeira ferramenta autorizada pela prioridade explícita;
4. unlinked ou sem grants úteis → `/conta?acesso=negado`.

Deep links continuam válidos e mantêm seus próprios guards server-side.

## `/conta` continua sendo conta e acesso

`/conta` permanece como destino semântico para identidade, vínculo, permissões efetivas e estados de acesso.

Ela não repete o painel de ferramentas. O painel global aponta para `/conta` por **Conta e acesso** quando o objetivo é explicar vínculo/permissão.

## Aparência

O `ThemeToggle` vive dentro do painel global:

- preferência do sistema vale antes de existir escolha salva;
- depois persistir `light` ou `dark`;
- não introduzir opção `Sistema` sem nova decisão de produto.

Mover o controle não altera o contrato de tema nem os tokens do Design System.

## Interação e motion

Existe uma única máquina de estado visual para o painel do avatar.

Contrato:

- click/tap no avatar abre;
- segundo click/tap no avatar fecha;
- Enter/Space alternam o disclosure;
- click fora fecha;
- Escape fecha e devolve foco ao avatar;
- mudança de pathname fecha;
- conteúdo em fechamento deixa de ser interativo/focável;
- a navegação interna não espera a animação terminar;
- `prefers-reduced-motion` remove a transição longa.

#964 define a transição reversível de aproximadamente 2 s como exceção deliberada de produto. Ela não muda o contrato semântico deste documento.

## Responsividade, densidade e acessibilidade

Matriz mínima do gate:

- 320×800;
- 390×844;
- 768×1024;
- 1366×768;
- 1920×1080;
- 2560×1440;
- equivalente de layout a zoom 200%;
- temas claro/escuro;
- `prefers-reduced-motion`.

Requisitos:

- sem overflow horizontal;
- target do avatar >=44×44;
- painel quase full-width com gutters em mobile;
- 390 px tenta 3 colunas; <=360 px pode usar 2;
- glyphs permanecem aproximadamente 34 px em desktop;
- labels visíveis e com até 2 linhas quando necessário;
- células mais compactas que o contrato histórico de 96 px;
- painel não cresce proporcionalmente em 2K/4K;
- viewport curta usa scroll interno;
- foco visível;
- `aria-current="page"` na rota atual;
- conteúdo fechado/closing não permanece focável;
- links continuam links comuns, sem ARIA application menu;
- navegação pública não desaparece quando Auth está indisponível.

## Testes e receipts

O gate de browser canônico é `tests/global-navigation.spec.ts`.

Ele deve cobrir:

- ausência do trigger 3×3 e presença de um único avatar global;
- `aria-expanded` + `aria-controls`;
- ordem de Explorar e matching de rota;
- matriz anonymous / authenticated com avatar / authenticated sem avatar / linked sem grants / capability parcial / capability ampla / unavailable;
- ferramenta sem capability ausente;
- navegação pública disponível antes/depois de falha da projeção privada;
- click/avatar toggle/Enter/Space/Escape/outside click/pathname;
- painel closing não interativo;
- reduced motion;
- densidade e containment;
- 320/390/768/1366/1920/2560 + equivalente de layout a 200% sem overflow;
- receipts desktop/mobile em dark/light;
- receipts sintéticos de capability ampla, anonymous e unavailable.

Screenshots/fixtures usam apenas identidades e avatares sintéticos; nunca dados privados reais.

## Não objetivos

- trocar o modelo de RBAC;
- tornar capability client-side autoridade;
- criar novo endpoint concorrente de Auth;
- usar `/edit` ou `/conta` como segundo launcher;
- adicionar novos destinos;
- drag-and-drop/reordenação;
- introduzir uma terceira opção de tema;
- transformar navegação comum em ARIA application menu.

## Referências

- #963 — decisão vigente: painel global único pelo avatar;
- #964 — motion reversível do painel;
- #965 — migração deste contrato e dos gates;
- #879/#882/#885 — histórico entregue, superseded apenas na divisão launcher + avatar;
- #881 / PR #886 — projeção sanitizada de Auth;
- #883 / PR #908 — `/edit` e `/conta` deixam de ser hubs concorrentes;
- #884 — gates de QA;
- #926 — compactação icon-first;
- #947 — fechamento por mudança de pathname;
- [Identidade, Auth e autorização](../domains/identity-access.md);
- [Superfícies públicas](../design-system/public-surfaces.md);
- [Diretriz geral de UX](../design-system/ux-hierarchy.md).
