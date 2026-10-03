# Identidade, Auth e autorização

> Status: arquitetura aprovada + convergência em andamento
> Owner: identity/access
> Última revisão: 2026-10-03

## Objetivo

Definir uma única regra canônica para autenticação, resolução de identidade e autorização no reboot, sem confundir pessoa, provider, profile, personagem, membership legado, role técnica, capability, scope ou knowledge narrativo.

A pergunta de autorização nova é:

```text
esta identidade resolvida possui capability ACTION no scope aplicável ao recurso?
```

Não é:

```text
role == "master"
```

## Modelo mental

```text
provider OAuth
  -> auth.users
  -> profiles.auth_user_id
  -> role_assignments(profile, scope)
  -> role_definitions
  -> role_permissions
  -> permission_catalog(action)
  -> boundary server/RPC/RLS
  -> dado/ação permitidos
```

`campaign_members` permanece em paralelo somente por compatibilidade com consumidores legados enquanto a convergência não termina.

## Separação obrigatória de conceitos

### Auth user

Identidade autenticada do Supabase Auth. Prova login; não prova membership, role, capability nem vínculo narrativo.

### Profile

`profiles` é a identidade humana interna. O vínculo canônico de login é `profiles.auth_user_id -> auth.users.id`.

### Character entity

PC/NPC/mundo pertencem ao domínio `entities`. Um profile pode se relacionar a personagem por `profile_characters`; Auth nunca é identidade de personagem.

### Participant

Aparição em sessão. Pode resolver profile e entity de forma independente.

### Authorization

Decisão técnica de acesso. É capability + scope + ownership do recurso + boundary server/database.

### Knowledge / audience

Decisão narrativa sobre quem sabe ou pode ver determinado conteúdo. Não é inferida de Auth/RBAC. Um usuário tecnicamente autorizado ainda pode não pertencer à audiência narrativa de um fato, e o inverso também não concede permissão técnica.

## Providers

A fotografia auditada do banco contém identities históricas de `google` e `discord`. Isso demonstra uso anterior, não configuração atual garantida em todos os ambientes.

Em 2026-09-07, o ambiente canônico foi verificado read-only pelo endpoint GoTrue `/auth/v1/settings`, usando a publishable key do projeto, e retornou `external.discord=true`. Portanto **Discord está confirmado como provider habilitado neste ambiente**. Essa evidência não confirma Google e não deve ser generalizada automaticamente para outro ambiente.

Regra do reboot:

- Supabase Auth é o boundary de autenticação;
- provider não carrega autorização própria;
- botões de login só podem ser renderizados para providers cuja configuração do ambiente tenha sido verificada deliberadamente;
- email, Discord handle, nome ou provider não substituem `auth.users.id` + `profiles.id`;
- nenhuma chave secreta/service role chega ao browser.

## Matriz de estados da aplicação

| Estado | Sessão Auth | Profile resolvido | Grants ativos | Capabilities | Acesso privado |
| --- | --- | --- | --- | --- | --- |
| `anonymous` | não | não | não | `[]` | não |
| `authenticated_unlinked` | sim | não | não | `[]` | não |
| `authenticated_linked_no_grants` | sim | sim | não | `[]` | não |
| `authenticated_linked` | sim | sim | sim, quando aplicáveis | somente efetivas no contexto | apenas se capability + scope + recurso permitirem |

### Regras da matriz

- login bem-sucedido não eleva automaticamente para `viewer`;
- profile resolvido sem grants continua não autorizado;
- `eligible`, `ended` e `revoked` não contam como grant ativo;
- ausência de profile nunca cai para membership por email/nome/Discord como fallback silencioso;
- capabilities enviadas à UI servem para apresentação; write sensível é revalidado no servidor/RPC.

## Conta e contexto multi-campaign

`/conta` é uma superfície de identidade e explicação de acesso; ela não é autoridade de autorização. O servidor resolve a identidade verificada, carrega o contexto de grants e descobre apenas campanhas que possuem capability efetiva para a conta. A seleção enviada pelo browser é somente intenção e precisa voltar a ser validada no servidor antes da projeção de permissões.

Regras da superfície:

- nenhum cálculo de acesso da Conta fica implicitamente preso à campanha histórica `yuhara-main`;
- com zero campanhas autorizadas, a UI mostra estado vazio honesto; com uma, o contexto pode ser selecionado automaticamente; com N, a escolha é explícita pelo `CampaignPicker` compartilhado;
- grants `project/tda` e grants específicos de `campaign/<slug>` continuam distintos e essa origem é apresentada em linguagem humana;
- uma campanha privada, revogada, expirada, futura, desconhecida ou fora do discovery autorizado não pode ser enumerada por uma query forjada;
- indisponibilidade de dependência é diferente de “nenhuma permissão” e deve permanecer fail closed;
- nome humano da campanha lidera a composição; technical slug e capabilities ficam em disclosure secundário;
- login, logout e preferência de aparência permanecem globais e independentes do contexto escolhido.

O picker client-side apenas atualiza o parâmetro `campanha` da URL. Ele não recebe grants brutos, não concede capability e não substitui `authorizeCampaignCapability()` nem a reautorização de cada ação sensível.

## RBAC físico existente

### `permission_catalog`

Catálogo de actions/capabilities. O campo `plane` (`technical | narrative | mixed`) classifica a ação; não concede acesso.

### `role_definitions`

Agrupadores administráveis de capabilities. Código novo não deve espalhar branches por slug de role.

### `role_permissions`

Relação many-to-many entre role e capability.

### `role_assignments`

Grant de role a profile com scope explícito:

```text
project | campaign | session | resource | integration
```

Status físicos observados:

```text
active | eligible | ended | revoked
```

Um assignment concede capability somente quando:

```text
status = active
AND starts_at <= now()
AND (ends_at IS NULL OR ends_at > now())
AND role possui a action solicitada
AND o scope é aplicável ao recurso solicitado
```

## Scope canônico

A notação `project/tda` e `campaign/yuhara-main` é apenas um atalho documental para o par `scope_type + scope_id`. **A barra não faz parte de `scope_id`.**

### Projeto

Representação física canônica:

```text
scope_type = "project"
scope_id   = "tda"
```

`scope_type="project", scope_id="dnd-scribe"` é compatibilidade histórica e não deve entrar em resolver novo.

A fotografia read-only de 2026-09-07 confirmou assignments ativos com `scope_id="tda"`; não existe contrato físico `scope_id="project/tda"`.

### Campanha

O scope físico usa o **technical slug** da campaign, não seu nome público nem public route key.

Boundary legado/default atual:

```text
scope_type = "campaign"
scope_id   = "yuhara-main"
```

`yuhara-main` permanece válido por compatibilidade mesmo quando a apresentação pública for **Crônicas da Mesa**. Novas campaigns recebem seus próprios technical slugs; alias/rename público não reescreve assignments.

### Resolução de project capability

Contrato conceitual:

```text
has_project_capability(action, project = "tda")
```

Considera apenas assignments ativos de `scope_type="project", scope_id="tda"` cuja role contém exatamente a capability solicitada.

### Resolução de campaign capability

Contrato conceitual:

```text
has_campaign_capability(campaign_slug, action)
```

Pode ser satisfeito por:

1. assignment ativo em `scope_type="campaign", scope_id={campaign_slug}` cuja role possua a action;
2. assignment ativo em `scope_type="project", scope_id="tda"` cuja role possua **a mesma action**.

Não existe regra "platform owner pode tudo". Grant global só vale para capabilities realmente presentes na role.

### Multi-campaign discovery e project grants

ADR-0020 fixa a semântica que #1134 deve implementar e testar:

- discovery pública expõe somente projection pública de campaigns elegíveis;
- discovery Edit devolve somente campaigns que o actor pode descobrir no contexto operacional;
- slug/UUID fornecido pelo browser é intenção, nunca autoridade;
- combinação forjada de slug A com UUID/recurso B falha fechada;
- campaign privada não vira oracle por diferença de erro;
- archived campaign preserva grants históricos, mas mutation normal é negada salvo capability administrativa explícita.

Um assignment ativo em `scope_type="project", scope_id="tda"` continua semanticamente global por capability e pode cobrir campaigns criadas futuramente **somente para actions realmente presentes na role**. Isso não equivale a membership universal, não concede discovery irrestrita e não elimina a prova de ownership do recurso.

Implementação candidata de #1134:

- **discovery pública** não usa RBAC e expõe apenas `active/public` por projection mínima;
- **discovery Edit** usa a capability exata `campaign.edit.access`; possuir outra action não transforma o ator em descobridor por acidente;
- um `campaign.edit.access` de `project/tda` cobre todas as campaigns, inclusive archived para navegação histórica; `project/dnd-scribe` não cobre nenhuma;
- criação/administração de registry usa `project.campaigns.manage`, inicialmente ligada a `platform_owner`;
- onboarding sem vínculo não enumera profiles globais: até existir invite/elegibility explícito, `access_directory` exige `campaign.read` ou `campaign.access.manage`;
- `missing`, sibling e archived retornam negação opaca no boundary de access/onboarding.

### Session / resource / integration

Não existe herança genérica aprovada. Cada resolver precisa provar a cadeia real de ownership antes de aceitar grant de campaign/project.

## Resolver server-side transitório já existente

A `main` já possui um boundary server-only estreito usado pelo Edit:

- `loadEditAccessContext(authUserId)` resolve `profiles.auth_user_id` e carrega assignments ativos/temporalmente válidos mais `role_permissions` usando o client privilegiado do servidor;
- `authorizeCampaignCapability(...)` aplica capability exata, validade temporal e cobertura de campaign/project;
- nenhum `has_campaign_role*` legado é necessário nesse caminho;
- as tabelas RBAC não são expostas diretamente ao browser.

Esse boundary pode ser **reutilizado transitoriamente** por guards administrativos enquanto o resolver RPC/database canônico ainda não existe. Reutilizar não significa afirmar RLS capability nativa: a leitura privilegiada continua protegida pelo servidor e o banco de produção permanece sem nova policy/RPC por causa deste contrato.

A implementação desse resolver deve usar a representação física `scopeType="project"` + `scopeId="tda"`. O valor composto `project/tda` não é um `scope_id` válido.

A convergência futura para resolver RPC/database continua desejável para reduzir privilégio e centralizar autorização, mas não exige duplicar RBAC no login nem bloquear o guard server-only já existente.

## Projeção mínima devolvida ao web

A apresentação global não recebe o contexto interno de autorização. A `main` integra em #881 / PR #886 uma projeção mínima em `GET /api/auth/me`, usada por navegação/conta sem tornar o root layout público dependente de cookies/banco.

Desde #1136 / PR #1239, a projeção multi-campaign usa `scope: { type: "project", id: "tda" }` como envelope global e separa os contextos autorizados em `campaigns`. Capabilities de ferramentas pertencem a cada item de campaign; o campo top-level `capabilities` permanece vazio nos estados autenticados por compatibilidade do parser e não representa autorização global.

O estado operacional `unavailable` é deliberadamente fail-closed e possui este wire contract mínimo:

```json
{
  "state": "unavailable",
  "scope": { "type": "project", "id": "tda" },
  "campaignsState": "unavailable",
  "campaigns": []
}
```

Nesse estado a API não devolve `identity` nem `capabilities`. O consumidor tipado `parseNavigationAuthProjection(...)` normaliza o mesmo payload para `identity: null`, `capabilities: []`, `campaignsState: "unavailable"` e `campaigns: []`. Essa diferença entre wire mínimo e projeção normalizada é intencional e deve ser coberta pelos testes de rota e navegador.

A projeção multi-campaign preserva:

- estado de Auth global;
- identidade sanitizada global apenas quando autenticada e disponível;
- campaigns descobríveis/selecionáveis apenas quando autorizadas;
- capabilities calculadas por campaign;
- nenhum raw grant/role/membership no browser.

Regras:

- `anonymous` não recebe `identity` nem `capabilities`;
- `unavailable` continua distinto de logout/anônimo e não devolve projeção privada stale;
- identidade de navegação só deriva de metadata verificada e sanitizada server-side;
- `displayName` é limitado e remove controles de apresentação perigosos;
- `avatarUrl` aceita somente origem/path aprovados do provider; URL arbitrária de metadata não vira imagem confiável;
- ausência/invalidade/falha de avatar é fallback visual, não erro de autenticação;
- auth user id, profile id, raw grants, role internals, email, Discord IDs e metadata integral não fazem parte da resposta;
- capabilities são somente as efetivas no contexto solicitado;
- `Cache-Control: private, no-store` e `Vary: Cookie` impedem uso como conteúdo público cacheável;
- a UI pode esconder/mostrar ferramentas por capability, mas isso é apresentação: toda rota/mutation revalida capability, scope e ownership no servidor;
- o shell público precisa continuar navegável se a projeção privada falhar.

O contrato de composição e destinos que consome essa projeção pertence a [Navegação global do TDA](../features/global-navigation.md).

## Membership legado

`campaign_members` guarda labels simples `owner/master/player/reviewer/viewer` e ainda é usado por RPCs históricas.

Política de convergência:

1. não remover agora;
2. não criar nova feature dependente dele;
3. novo resolver usa RBAC/capability;
4. RPCs legadas migram uma a uma;
5. durante transição, fluxos que ainda precisam de ambos mantêm consistência explícita e idempotente;
6. remoção só ocorre após busca de consumidores + inventário RPC + testes positivos/negativos.

## Profile claim

Usuário autenticado sem profile pode solicitar associação somente dentro de um boundary de elegibilidade definido para a campaign.

### Finding AUTH-001 — target profile sem prova campaign-scoped

O RPC legado `submit_profile_claim(...)` não possui prova de invite/elegibility campaign-scoped suficiente para multi-campaign. `auth_user_id IS NULL` nunca é tratado como evidência de pertença.

O candidate #1134 fecha o bypass antes da ativação multi-campaign:

- `access_directory(...)` deixa de enumerar profiles globais não vinculados;
- `submit_profile_claim(...)` perde `EXECUTE` direto de `authenticated`/browser e permanece apenas server-only;
- o fluxo de claim só pode voltar a ser exposto quando existir invite/elegibility explícito, com teste negativo cross-campaign.

Isso preserva os dados/claims históricos sem transformar uma lacuna de onboarding em oracle entre campaigns.

### Finding AUTH-002 — review autorizado por role legado

`review_profile_claim(...)` legado ainda decide autoridade por `owner/master`. O candidate #1134 não tenta reescrever essa mutation no mesmo passo: ele revoga `EXECUTE` direto de `authenticated` e mantém o RPC server-only.

Antes de reexpor review de claim, o boundary servidor/RPC deve exigir `campaign.access.manage` efetiva para a campaign da claim e preservar as verificações de identidade Discord. Não inferir poder por nome da role.

### Finding AUTH-003 — approval mantém somente membership legado

A aprovação observada garante `campaign_members(player)`, mas precisa manter o RBAC canônico coerente durante a transição. A solução SQL deve ser serializada pelo dono do banco; esta frente não grava migration paralela.

## `profile_characters`

A policy observada de SELECT para `authenticated` é ampla. Antes de qualquer client direto depender dela, confirmar consumidores e decidir se catálogo global autenticado é realmente intencional ou se deve ficar campaign/capability scoped.

Não alterar policy apenas para "limpar" warning.

## RPCs de identidade e acesso

O inventário canônico de `SECURITY DEFINER`, grants e decisões de exposição pertence a [`../database/security.md`](../database/security.md) e [`../database/rpc-inventory.md`](../database/rpc-inventory.md).

Esta frente não duplica esse inventário. Para Auth, os blockers relevantes são:

- corrigir AUTH-001 antes do claim oficial;
- migrar autorização de review para capability;
- preservar coerência RBAC + membership enquanto o legado existir;
- testar manipulação direta de RPC e cross-campaign.

Não existe hoje RPC canônico `has_project_capability`, `has_campaign_capability` ou `authorization_context`; o resolver server-only do Edit é o boundary transitório aprovado até essa convergência.

## Boundary web mínimo

O primeiro Auth web oficial deve ser pequeno:

### Browser

- `@supabase/supabase-js` ou integração SSR oficialmente suportada pela versão atual, conforme documentação consultada antes da edição Next;
- `SUPABASE_URL` + chave **publishable** apropriada ao browser;
- neste ambiente, Discord pode ser apresentado porque `external.discord=true` foi verificado read-only;
- sessão/OAuth conforme API oficial;
- nenhum secret server-side em bundle ou resposta de configuração.

### Server

- valida sessão usando mecanismo suportado, sem confiar em profile/role vindo da UI;
- reutiliza `loadEditAccessContext` + `authorizeCampaignCapability` como boundary transitório para guards de campaign, sem duplicar RBAC;
- mantém estados `anonymous`, `unlinked`, `linked_no_grants`, `linked` distintos;
- retorna dados mínimos;
- mutation sensível continua server-first e revalida capability;
- não afirma que essa autorização é aplicada por RLS enquanto continuar sendo resolvida por query privilegiada no servidor.

Evitar refactor de root layout enquanto a frente UX estiver trabalhando em paralelo; Auth deve integrar por componente/boundary pequeno.

## Matriz mínima de testes de autorização

Cada superfície autenticada deve cobrir:

| Caso | Resultado esperado |
| --- | --- |
| sem login | negado / contexto `anonymous` |
| login válido sem profile | `authenticated_unlinked`, capabilities vazias |
| profile sem grants | `authenticated_linked_no_grants`, negado |
| capability correta em campaign A | permitido somente para recurso de A |
| mesma capability em campaign B para recurso de A | negado |
| project grant com a action correta | pode cobrir A/B conforme semantics da action; ownership continua obrigatório |
| slug A + UUID/recurso B forjados | negado sem enumeração |
| assignment `eligible` | negado |
| assignment expirado/revogado | negado |
| `scope_type=project`, `scope_id=tda` com action explicitamente presente | permitido onde o contrato da action admitir projeto global |
| string composta `scope_id=project/tda` | negado; representação física incorreta |
| role global sem a action pedida | negado |
| ID de recurso de outra campaign | `not_found`/negação sem vazamento |
| RPC chamada com parâmetros manipulados | negado |
| conteúdo privado/master sem audience adequada | negado mesmo quando Auth existe |

## Dependência do Edit

O Edit Workbench já existe com bypass temporário e persistence canônica em evolução. A troca para Auth oficial só pode ocorrer quando:

1. contexto server de Auth estiver implementado e testado;
2. o guard reutilizar o resolver server-only existente com `scope_id="tda"` e testes negativos/cross-campaign verdes;
3. mutation canônica de Edit tiver concurrency/audit prontos;
4. authorization continuar fail-closed para profile sem grants, scope errado e recurso de outra campaign;
5. só então `TDA_EDIT_UNSAFE` e o adapter temporário podem ser removidos em recorte próprio.

O futuro resolver RPC/database é convergência posterior e deve ser serializado pelo dono do banco; não é autorização para aplicar #44 nem para alterar RLS nesta frente.

Até lá, esta frente não amplia o bypass nem cria segundo caminho de autorização.

## Critério para encerrar legado de acesso

`campaign_members`/scope histórico só podem ser retirados quando:

- todas as superfícies novas usam capability;
- RPCs antigas foram migradas/substituídas;
- companion/Discord/Ordo consumidores foram verificados;
- testes positivos/negativos cobrem login, profile resolution, scope e cross-campaign;
- nenhum código novo depende de `scope_type="project", scope_id="dnd-scribe"` ou role slug histórico.

## Referências

- [Segurança do banco](../database/security.md)
- [Inventário RPC](../database/rpc-inventory.md)
- [Modelo de dados](../data-model.md)
- [ADR-0008 — autorização orientada a capabilities](../adr/0008-capability-authorization.md)
- [Edit Workbench](../features/edit-workbench.md)
- [Consulta administrativa de permissões — DTO, boundary e ativação](../features/edit-permissions.md)

## Implementação de login Discord

O candidato implementa entrada exclusivamente Discord, sessão SSR e guards administrativos. Consulte o [runbook Discord](../operations/discord-auth.md). Login não concede administração; profile e capabilities continuam obrigatórios. O resolver usa scope_type=project e scope_id=tda para project/tda e exige a action no grant ativo. Falhas operacionais negam acesso.
