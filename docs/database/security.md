# Segurança do banco: Auth, RLS, RBAC, RPCs e grants

> Status: implementado + transição em andamento
> Owner: segurança/dados
> Última revisão: 2026-09-06
> Fonte: schema/advisors do Supabase `dmrqnbdvbkfqzctcerbx`

## Modelo mental

Segurança do TDA possui camadas diferentes e elas não devem ser confundidas:

```text
identidade Auth
   ↓
profiles
   ↓
membership / role assignment
   ↓
capabilities + scope
   ↓
RLS/RPC/server boundary
   ↓
dado permitido
```

O fato de o servidor possuir uma chave poderosa **não transforma toda consulta server-side em segura automaticamente**. Cada integração deve selecionar campos e aplicar fronteira de domínio deliberada.

## Auth

`profiles.auth_user_id` pode apontar para `auth.users.id`.

Direção do reboot:

- OAuth/Auth identifica usuário;
- profile resolve identidade humana interna;
- capabilities resolvem ações permitidas;
- conteúdo sensível só é retornado depois da autorização.

Não usar email, Discord handle ou character name como substituto permanente do `auth_user_id/profile_id`.

## Modelo legado: `campaign_members`

Possui roles `owner`, `master`, `player`, `reviewer`, `viewer` e ainda é usado por funções/RPCs legadas.

**Política:** manter compatibilidade durante transição, mas não expandir esse modelo para novas features quando RBAC resolve o caso.

## RBAC extensível

### `permission_catalog`

Capabilities/ações, classificadas por plane `technical | narrative | mixed`.

### `role_definitions`

Agrupamentos nomeados de capabilities.

### `role_permissions`

Mapeia role para capability.

### `role_assignments`

Mapeia profile + role para scope:

- `project`;
- `campaign`;
- `session`;
- `resource`;
- `integration`.

O scope canônico do reboot é `project/tda`. `project/dnd-scribe` permanece temporariamente porque consumidores legados ainda o utilizam.

### Regra da UI/API nova

Perguntar:

```text
usuário possui capability X no scope Y?
```

Evitar:

```text
role_slug == "master"
```

A primeira forma permite alterar composição de roles sem reescrever UI e regras de negócio.

## RLS

Na revisão de 2026-09-06, RLS estava habilitado em todas as 43 tabelas públicas observadas.

Muitas tabelas não possuem policy explícita. O Database Linter reporta `rls_enabled_no_policy`, mas nesse caso o efeito é **deny-by-default** para roles sujeitas ao RLS.

### Regra

Não adicionar uma policy ampla apenas para remover warning/info do linter.

Uma policy nova precisa responder:

1. quem lê/escreve?
2. por qual identity/capability?
3. qual campaign/scope?
4. quais colunas/dados podem chegar ao client?
5. a mesma policy vaza informação por join/RPC?
6. existe superfície server-side mais adequada?

## Fronteira pública atual

O site público usa consultas server-side estreitas para conteúdo publicado da campanha principal. A chave server-side possui poder elevado e **não é tecnicamente read-only**.

Mitigações atuais:

- secret não vai ao browser;
- seleção explícita de campos;
- filtro de campanha/estado publicado;
- catálogo não carrega transcrições completas nem dados de usuário;
- conteúdo Markdown não aceita HTML bruto arbitrário;
- mídia passa por allowlist/contrato de origem.

### Dívida futura

Uma role/view/endpoint tecnicamente read-only e de menor privilégio é desejável antes de ampliar a superfície pública, desde que introduzida com migration revisada e sem quebrar o legado.

## `SECURITY DEFINER`

O advisor de segurança sinalizou funções `SECURITY DEFINER` executáveis por `authenticated`. Entre as funções observadas no alerta estão:

- `access_directory(campaign_slug text)`;
- `current_profile_id()`;
- `has_campaign_role(target_campaign_id uuid, allowed_roles text[])`;
- `has_campaign_role_slug(campaign_slug text, allowed_roles text[])`;
- `review_profile_claim(...)`;
- `review_table_note(...)`;
- `submit_profile_claim(...)`;
- `table_notes_directory(...)`.

O warning **não significa automaticamente vulnerabilidade**, porque algumas RPCs foram desenhadas para serem chamadas por usuários autenticados. Mas `SECURITY DEFINER` executa com privilégios do owner e, portanto, precisa ser tratado como boundary de segurança.

### Checklist para cada RPC

- `search_path` seguro/qualificado;
- validação interna de auth/profile;
- validação de campaign/scope/capability;
- inputs não permitem acessar outro usuário/campanha;
- retorno não contém campos privados desnecessários;
- `EXECUTE` concedido somente a roles que realmente precisam;
- helper interno não exposto por acidente via `/rest/v1/rpc`;
- comportamento coberto por teste negativo, não só happy path.

### Ação antes do Edit público

Criar inventário função a função classificando:

- endpoint público intencional;
- endpoint autenticado intencional;
- helper interno;
- legado a migrar;
- candidato a `SECURITY INVOKER`;
- candidato a `REVOKE EXECUTE`.

Não revogar em massa sem mapear consumidores.

## Secrets e service roles

Nunca versionar:

- Supabase service/secret key;
- JWT secrets;
- OAuth client secrets;
- token R2;
- API keys externas;
- Vercel tokens.

Client/browser recebe apenas identificadores/chaves públicas apropriadas ao SDK quando a arquitetura permitir.

## API externa

`external_api_keys` guarda `key_hash` e `key_prefix`, scopes, expiração/revogação e contadores. O secret completo não deve ser armazenado em claro nem documentado.

Rotação deve criar nova credencial e revogar a anterior de forma explícita.

## Conteúdo narrativo e audience

Visibility existente inclui combinações como:

- `private_master`;
- `private_players`;
- `review_only`;
- `public_campaign`;
- `public_web`.

Outras tabelas legadas possuem vocabulário próprio (`dm_review`, `table_private`, etc.). Antes de construir knowledge/audience avançado, normalizar semântica no domínio, não apenas traduzir strings na UI.

## Segurança de candidatos/outtakes

Outtakes possuem níveis de sensibilidade/aprovação próprios. Conteúdo `private` ou `sensitive` não deve ser exposto porque a session/publication principal é pública.

## Proteção de senha vazada

O advisor também sinalizou **Leaked Password Protection desabilitada** no Auth. Como o fluxo vigente é orientado a OAuth, isso não bloqueia a etapa atual. Se login por senha for habilitado, tratar como requisito de hardening e revisar configuração Auth.

## Auditoria

`audit_log` existe, mas estava vazio na fotografia atual. Portanto:

- não afirmar que todo write já é auditado;
- mapear writes críticos do Edit;
- decidir quais eventos precisam entrar no audit log;
- não depender do log vazio como mecanismo de segurança.

## Testes mínimos para autorização

Para cada nova superfície autenticada, testar pelo menos:

- usuário sem login;
- usuário autenticado sem profile resolvido;
- player sem capability;
- player com capability no campaign correto;
- capability em campaign/scope errado;
- DM/operator autorizado;
- ID de recurso de outra campaign;
- tentativa de acessar conteúdo master/private;
- RPC chamada diretamente com parâmetros manipulados.

## Regra de mudança

Qualquer alteração em policy, grant, function security, role/capability ou secret boundary exige:

- migration;
- atualização deste documento;
- teste de acesso positivo e negativo;
- registro no ADR se alterar a estratégia de segurança.
