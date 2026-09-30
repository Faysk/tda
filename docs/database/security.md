# Segurança do banco: Auth, RLS, RBAC, RPCs e grants

> Status: implementado + transição em andamento
> Owner: segurança/dados
> Última revisão: 2026-09-30
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

### Boundary multi-campaign (#1123)

O registry de campanhas separa deliberadamente identidade relacional, técnica e pública:

- `campaigns.id` é a autoridade relacional e o boundary preferido para autorização;
- `campaigns.slug` permanece como identidade técnica/compatibilidade para helpers e consumidores legados;
- `campaigns.public_slug` é somente identidade pública/rota e **não concede nem seleciona autorização**;
- `campaigns.name` é apresentação editorial e nunca participa de uma decisão de acesso.

Registrar uma nova campanha não concede membership, role assignment ou capability a ninguém. Em particular, o bootstrap de `antes-que-seja-tarde` da #1123 cria apenas a raiz da campanha; acesso à campanha deve ser concedido explicitamente por um fluxo de autorização próprio.

A #1123 não muda silenciosamente a semântica das RPCs legadas que recebem `campaign_slug`. Elas continuam usando o slug técnico de compatibilidade. A evolução desses endpoints deve resolver a campanha e validar membership/capability no boundary apropriado, com testes negativos cross-campaign, antes de ampliar a superfície da segunda campanha.

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

A inspeção revalidada em 2026-09-10 confirmou **8 funções `SECURITY DEFINER` em `public`**:

- `access_directory(campaign_slug text)`;
- `current_profile_id()`;
- `has_campaign_role(target_campaign_id uuid, allowed_roles text[])`;
- `has_campaign_role_slug(campaign_slug text, allowed_roles text[])`;
- `review_profile_claim(...)`;
- `review_table_note(...)`;
- `submit_profile_claim(...)`;
- `table_notes_directory(...)`.

Estado de grants observado nas oito:

- `anon`: sem `EXECUTE`;
- `authenticated`: com `EXECUTE`;
- `service_role`: com `EXECUTE`;
- owner: `postgres`.

Todas as definições observadas fixam `search_path` em `pg_catalog, public`.

O warning do advisor **não significa automaticamente vulnerabilidade**, porque várias dessas RPCs são endpoints autenticados deliberados. Porém `SECURITY DEFINER` executa com privilégios do owner e precisa ser tratado como boundary de segurança.

O inventário função a função, incluindo classificação, autorização interna, risco e decisão atual de grant, está em [`rpc-inventory.md`](rpc-inventory.md).

### Classificação atual

Helpers internos candidatos a perder `EXECUTE` direto de `authenticated` depois da prova final de consumidores:

- `current_profile_id()`;
- `has_campaign_role(...)`;
- `has_campaign_role_slug(...)`.

Endpoints autenticados/administrativos mantidos durante a transição:

- `access_directory(...)`;
- `submit_profile_claim(...)`;
- `review_profile_claim(...)`;
- `table_notes_directory(...)`;
- `review_table_note(...)`.

### Atenção especial: `access_directory`

O caminho não-admin mascara dados Discord e retorna apenas profiles ainda não ligados a Auth, mas não exige explicitamente membership prévia na campanha solicitada. Com uma única campanha conhecida isso não criou um vazamento cross-campaign observado; o registry multi-campanha da #1123 torna essa dívida explícita, mas **não concede acesso à segunda campanha nem altera o contrato da RPC**.

Antes de expor onboarding/diretório para uma segunda campanha ou Edit público, o contrato precisa decidir se a consulta exige convite/membership/capability ou se diretório autenticado por slug técnico é comportamento intencional. Essa decisão deve incluir teste negativo em que um usuário autorizado apenas na campanha A tenta consultar a campanha B.

Não alterar essa semântica silenciosamente: é regra de produto/autorização e precisa de teste negativo.

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

- cobrir os cinco endpoints intencionais com testes positivos/negativos;
- decidir contrato multi-campaign de `access_directory`;
- comprovar ausência de consumidores externos dos três helpers;
- quando seguro, versionar migration que revogue `EXECUTE` direto de `authenticated` dos helpers;
- rodar advisors e smoke tests depois da mudança;
- convergir autorização nova para capabilities/RBAC.

Não revogar em massa sem mapear consumidores.

## Durabilidade server-only do World

A migration candidata `20260919170000_world_edit_durable_recovery` separa o lock temporário da persistência do trabalho editorial:

- `world_edit_leases` continua responsável por exclusividade e expiração curta;
- `world_edit_drafts` guarda checkpoints privados por campaign/profile/token com RLS habilitado e nenhuma policy/grant de browser;
- `anon` e `authenticated` não leem nem escrevem checkpoints;
- `service_role` recebe somente `SELECT/INSERT/UPDATE` no arquivo durável, sem `DELETE`;
- troca de holder não transfere o conteúdo privado do editor anterior;
- recovery automático exige o mesmo editor e revisions compatíveis;
- checkpoint stale é preservado, mas não é aplicado sobre um estado publicado diferente;
- release comum não equivale a descarte;
- discard explícito possui RPC própria e mantém tombstone;
- receipt positivo de publicação é persistido no mesmo commit canônico antes de consumir o lease, permitindo reconciliar perda da resposta HTTP sem confiar no cliente.

Esse boundary não amplia capabilities: autoria factual continua exigindo `campaign.content.edit` e a sessão exclusiva continua exigindo `campaign.world.layout.edit`.

## `SECURITY INVOKER` server-only do Edit

O arquivo local `20260907115300_edit_transcript_segment_atomic` descreve `public.edit_transcript_segment_atomic(...)`. Em 2026-09-08 a função física foi confirmada no Supabase canônico sob migration history remoto `20260908064257 edit_transcript_segment_atomic`.

A definição física observada corresponde ao contrato local quanto a assinatura/corpo, `SECURITY INVOKER`, `search_path`, comentário e grants efetivos. Existe drift de **ID de migration**, registrado em `migrations.md`; equivalência funcional não autoriza reescrever migration history.

Decisões de segurança observadas/esperadas:

- `SECURITY INVOKER`, não eleva para owner;
- `search_path = pg_catalog, public`;
- `PUBLIC`, `anon` e `authenticated` sem `EXECUTE`;
- `service_role` com `EXECUTE`;
- chamada exclusivamente server-side;
- usuário/profile/capability `campaign.content.edit` resolvidos antes da persistence;
- actor vem do contexto autorizado da aplicação, não de escolha livre do browser;
- `segment -> session -> campaign` é revalidado dentro da função;
- recurso de outra campaign retorna `not_found`;
- update otimista e `audit_log` são atômicos;
- nenhuma das 8 funções `SECURITY DEFINER` legadas é alterada por esse boundary.

### Por que `SECURITY INVOKER`

`anon` e `authenticated` não possuem os grants diretos necessários ao write, enquanto `service_role` possui o privilégio server-side. A função pode herdar o privilégio do caller sem elevação para owner.

O uso de `service_role` continua sendo boundary poderoso: a aplicação não pode oferecer a função como CRUD genérico nem confiar no segredo server-side como substituto de autorização.

### Concorrência e audience

O SQL:

- bloqueia a linha do segmento antes da decisão de revision;
- exige igualdade com `expectedRevision`;
- incrementa revision exatamente em 1 apenas no update válido;
- não cria audit em conflito;
- não revela a existência de segmento cross-campaign;
- preserva `character_name` quando o speaker não muda e invalida essa identidade quando o speaker textual muda.
