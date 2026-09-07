# ADR-0008 — autorização orientada a capabilities e scope

> Status: accepted
> Data: 2026-09-07
> Owner: identity/access + arquitetura + segurança

## Contexto

O TDA herda dois modelos de acesso que coexistem:

- `campaign_members`, com labels históricas como `owner/master/player`;
- RBAC extensível com `permission_catalog`, `role_definitions`, `role_permissions` e `role_assignments` por scope.

Novas superfícies como Edit, administração, publicação e futuras integrações precisam de autorização composável sem perpetuar checks por nome de role.

Também existe uma separação de domínio que não pode ser perdida: autenticação identifica uma pessoa, autorização decide ações técnicas e knowledge/audience decide visibilidade narrativa.

## Decisão

O reboot adota **capability + scope** como contrato canônico de autorização para código novo.

A decisão é avaliada nesta ordem:

```text
sessão Auth válida
  -> profile resolvido
  -> assignment ativo e temporalmente válido
  -> role contém exatamente a capability pedida
  -> scope é aplicável ao recurso
  -> ownership/campaign do recurso é validado
  -> audience/visibility é aplicada quando pertinente
```

### Estados explícitos

O web diferencia:

- `anonymous`;
- `authenticated_unlinked`;
- `authenticated_linked_no_grants`;
- `authenticated_linked`.

Login ou profile sem grants não concede acesso implícito.

### Scope de projeto

A notação documental `project/tda` representa o par físico:

```text
scope_type = "project"
scope_id   = "tda"
```

A barra não faz parte de `scope_id`. `scope_type="project", scope_id="dnd-scribe"` permanece somente como compatibilidade durante a retirada de consumidores históricos.

### Scope de campanha

Uma capability de campaign pode ser satisfeita por assignment ativo na própria campaign ou por assignment em `scope_type="project", scope_id="tda"` **somente quando a role global contém exatamente a mesma capability**.

Não existe regra implícita de que uma role global específica possa tudo.

### Session/resource/integration

Não haverá herança genérica por `scope_id text`. Cada tipo de recurso precisa provar sua cadeia de ownership antes de aceitar grants ascendentes.

### Browser e servidor

O browser pode receber somente contexto mínimo e capabilities efetivas para UX. Toda operação sensível é revalidada no servidor/RPC/database boundary.

Chave secret/service role não é configuração de browser.

A `main` já contém `loadEditAccessContext` + `authorizeCampaignCapability` como boundary server-only transitório. Esse caminho pode ser reutilizado por guards administrativos sem duplicar RBAC, desde que permaneça fail-closed e use a representação física correta de scope. Ele **não** equivale a RLS capability nativa: as queries privilegiadas continuam confinadas ao servidor.

Um resolver RPC/database canônico continua sendo convergência posterior, serializada pelo dono do banco, e não precisa ser inventado dentro do slice de login.

### Membership legado

`campaign_members` não é removido nesta decisão. Continua apenas enquanto RPCs/consumidores históricos precisarem dele. Fluxos de transição que escrevem membership e RBAC precisam manter consistência explícita e idempotente.

## Provider verificado

Em 2026-09-07, o ambiente canônico confirmou read-only via GoTrue `/auth/v1/settings` que `external.discord=true` usando a publishable key do projeto. Isso autoriza o slice de login Discord neste ambiente sem inferir habilitação por identities históricas.

A evidência não confirma Google nem autoriza extrapolar a configuração para outros ambientes.

## Consequências

### Positivas

- composição de roles pode mudar sem reescrever consumidores;
- authorization rules ficam testáveis por action + scope;
- multi-campaign não depende de labels globais de role;
- UI e backend compartilham vocabulário sem tratar UI escondida como segurança;
- Auth deixa de ser confundido com knowledge narrativo;
- o login pode reutilizar o resolver server-only já existente em vez de criar um segundo RBAC na aplicação.

### Custos

- RPCs legadas precisam migrar gradualmente;
- durante a transição existem dois modelos que precisam permanecer coerentes;
- resolvers de session/resource/integration exigem ownership explícito antes de generalização;
- testes negativos e cross-campaign tornam-se obrigatórios;
- enquanto a resolução usar client privilegiado server-side, o boundary da aplicação continua responsável por não vazar RBAC bruto nem confundir isso com enforcement RLS.

## Alternativas rejeitadas

### Continuar usando `owner/master/player` em código novo

Rejeitada porque acopla produto ao nome da role e dificulta composição futura.

### Tratar `platform_owner` como superusuário universal

Rejeitada porque viola least privilege e transforma role em exceção implícita impossível de auditar por capability.

### Expor `role_assignments` diretamente ao browser

Rejeitada porque amplia superfície de dados e faz a UI depender do schema físico do RBAC.

### Criar herança genérica automática entre todos os scopes

Rejeitada nesta fase porque session/resource/integration ainda precisam demonstrar ownership real; inferir hierarquia apenas por strings criaria grants acidentais.

### Duplicar o resolver RBAC no slice de login

Rejeitada porque `loadEditAccessContext` e `authorizeCampaignCapability` já fornecem um boundary transitório server-only reutilizável. A convergência posterior deve reduzir/centralizar privilégio, não criar implementações paralelas.

## Requisitos de implementação

Antes de uma superfície Auth oficial depender desta decisão:

- provider ativo precisa ser verificado no ambiente;
- server resolve sessão e profile sem confiar em identidade fornecida pela UI;
- assignment conta somente quando ativo e dentro da janela temporal;
- `scope_type="project"` usa `scope_id="tda"`, nunca `scope_id="project/tda"`;
- cross-campaign é negado sem vazar existência de recurso;
- profile sem grants continua negado;
- o resolver server-only existente pode ser reutilizado como etapa transitória sem afirmar enforcement RLS nativo;
- mudanças futuras de RPC/grants são serializadas pelo dono do banco;
- `SECURITY DEFINER` e grants seguem o inventário canônico em `docs/database/security.md` e `docs/database/rpc-inventory.md`.

## Relação com Edit

ADR-0007 define o Edit Workbench como server-first e capability-oriented. Esta ADR define a semântica geral que o Auth deve entregar antes de retirar `TDA_EDIT_UNSAFE`.

A transição do Edit exige, além do Auth, optimistic concurrency e auditoria atômica concluídas pelo fluxo de banco. O resolver RPC/database futuro é convergência posterior; o guard server-only já existente pode sustentar a transição desde que os testes negativos/cross-campaign estejam verdes.

Nenhuma afirmação desta ADR implica aplicação de migration/PR de banco ainda não integrada.

## Documentos donos

- contrato de identidade/Auth: [`../domains/identity-access.md`](../domains/identity-access.md)
- segurança física/RPCs: [`../database/security.md`](../database/security.md)
- Edit: [`0007-edit-workbench.md`](0007-edit-workbench.md)
