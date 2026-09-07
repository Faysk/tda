# Identidade, Auth e autorização

> Status: arquitetura aprovada + convergência em andamento
> Owner: identity/access
> Última revisão: 2026-09-07

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

Campanha principal atual:

```text
scope_type = "campaign"
scope_id   = "yuhara-main"
```

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

## Contexto mínimo devolvido ao web

Contrato conceitual:

```ts
type AuthorizationContext = {
  state:
    | "anonymous"
    | "authenticated_unlinked"
    | "authenticated_linked_no_grants"
    | "authenticated_linked";
  profile?: {
    id: string;
    displayName: string;
  };
  scope?: {
    type: "project" | "campaign";
    id: string;
  };
  capabilities: string[];
};
```

Regras:

- não devolver role assignments crus para habilitar UI;
- não devolver email, Discord IDs, metadata ou claims no contexto básico;
- capabilities são apenas as efetivas no contexto solicitado;
- endpoint de claim/diretório possui contrato próprio;
- toda mutation revalida capability e ownership do recurso.

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

`submit_profile_claim(...)` valida existência/vínculo do target, mas o contrato observado não prova que o profile é elegível para a campaign solicitada. `access_directory(...)` também possui caminho que pode considerar profile global não vinculado.

Na fotografia de 2026-09-07 não havia profile não vinculado disponível para explorar essa combinação, porém a fraqueza é estrutural e precisa ser corrigida **antes de abrir o fluxo oficial de claim**.

Correção necessária pelo dono do banco:

- elegibilidade explícita no contexto da campaign; ou
- convite/estado próprio equivalente;
- teste negativo cross-campaign.

Não aceitar `auth_user_id IS NULL` como prova suficiente de elegibilidade.

### Finding AUTH-002 — review autorizado por role legado

`review_profile_claim(...)` ainda depende de `owner/master`. A convergência deve reautorizar pela capability apropriada, hoje modelada como `campaign.access.manage`, sem inferir poder por nome da role.

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
| capability correta em `campaign/yuhara-main` | permitido somente para recurso da campanha |
| mesma capability em campaign errada | negado |
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
