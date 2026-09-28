# Edit — administração de permissões

> Status: console governada de atribuição/revogação de funções  
> Owner: identity/access + Edit  
> Última revisão: 2026-09-28  
> Fonte de verdade: `src/features/edit/permissions/`, `src/features/edit/access/policy.ts` e `public.manage_campaign_role_assignments`

## Contrato vigente

A superfície `/edit/{campaignSlug}/permissions` administra **assignments de roles existentes no escopo da campanha**. Ela não cria uma ACL paralela por tela e não transforma o cliente em autoridade.

O modelo continua:

```text
profile
  -> role assignment
  -> role definition
  -> role permissions
  -> capability server-side
  -> rota / launcher / mutation
```

A UI usa nomes humanos de ferramentas e ações. Slugs, IDs e códigos de capability ficam em disclosure técnico.

## Authority

Leitura e escrita exigem:

1. identidade verificada por `auth.getUser()`;
2. profile resolvido server-side;
3. `campaign.permissions.manage` efetivo para a campaign pedida, via `authorizeCampaignCapability()`;
4. target, role, scope e estado revalidados no servidor no momento da mutation.

Campos enviados pelo browser nunca substituem a identidade do actor. Conhecer a URL, esconder/mostrar botão ou forjar metadata não concede autoridade.

Assignments `project + tda` aparecem como **herdados e somente leitura** na console de campaign. O primeiro corte não cria ou revoga grants project-level.

## Delegação

A mutation de campaign aplica least privilege:

- roles que contêm `project.*` não podem ser concedidas por esta console;
- para delegar uma capability sensível, o actor também precisa possuir essa capability efetivamente;
- actions sensíveis atuais: `campaign.permissions.manage`, `campaign.sessions.publish`, `campaign.transcript.publish` e `narrative.canon.approve`;
- grant/revoke sensível requer confirmação explícita;
- self-revoke requer confirmação explícita;
- revogar o último assignment efetivo que mantém `campaign.permissions.manage` é bloqueado;
- não existe inferência por nome de role, email, provider ou metadata;
- o catálogo de roles é lido do banco; roles custom futuras permanecem separadas da edição de catálogo.

## Concorrência, transação e idempotência

Cada pessoa possui uma revisão em `campaign_permission_revisions`.

Fluxo:

```text
read directory + revision
-> preview local
-> POST com expectedRevision + operationId
-> revalidação de actor/target/delegação
-> lock da revisão do target
-> compare-and-swap
-> grant/revoke + audit na mesma transação
-> revision + 1
-> read-back server-side
-> resposta ao browser
```

Stale CAS retorna `conflict`; não existe blind retry.

`operationId` permite reconhecer replay de uma operação já auditada. Se a resposta do commit for perdida e o read-back não puder confirmar, a API retorna estado reconciliável em vez de disparar uma segunda mutation automaticamente.

## Grant e revoke

### Grant

- target precisa existir e pertencer à campaign, ou já possuir histórico de assignment direto na campaign;
- role precisa existir;
- scope criado é sempre `campaign + {slug}`;
- duplicate assignment aberto falha;
- `assigned_by`, reason e metadata de origem são registrados.

### Revoke

- apenas assignment direto da campaign pode ser revogado nesta console;
- o row não é apagado;
- `status` passa para `revoked`, `ends_at` é preenchido e `revoked_by`/reason são preservados;
- inherited/project assignment continua intacto.

## Auditoria

Grant/revoke grava `audit_log` na mesma transação da alteração.

Metadata segura registrada:

- actor profile;
- target profile;
- role;
- campaign scope;
- before/after;
- operation id;
- timestamp;
- reason opcional;
- source `permissions-console`.

Tokens, payloads Auth e metadata privada de identidade não entram na auditoria.

A UI expõe histórico recente em linguagem humana.

## Read model e UI

A primeira camada mostra:

- total de pessoas, funções e admins;
- busca;
- filtro por função;
- filtro por acesso;
- tabela/lista estruturada;
- acesso resultante derivado das capabilities;
- ação `Gerenciar`.

O drawer de gerenciamento mostra:

- estado de conta;
- roles diretas editáveis;
- roles herdadas read-only;
- preview do acesso resultante antes de aplicar;
- motivo opcional;
- confirmação apenas quando o risco exige.

Em mobile a tabela vira lista sem overflow horizontal. IDs técnicos e slugs ficam em disclosure.

## Segurança do banco

A tabela `campaign_permission_revisions` possui RLS habilitado e grants somente para `service_role`.

A RPC `manage_campaign_role_assignments` é `SECURITY INVOKER`, fixa `search_path = ''`, revoga `EXECUTE` de `PUBLIC`, `anon` e `authenticated` e permite execução apenas por `service_role`.

O browser nunca chama PostgREST privilegiado diretamente; a API Next server-side usa o client secreto existente depois do boundary de identidade/capability.

## Relação com navegação e sessões abertas

O launcher e as rotas continuam usando o mesmo `loadEditAccessContext()` + `authorizeCampaignCapability()`.

Por isso:

- um novo assignment aparece no próximo refresh/revalidation;
- uma URL direta continua protegida server-side;
- revogar uma capability não depende de esconder um botão;
- uma mutation posterior reavalia a authority no servidor e falha fechado quando o grant já não é efetivo.

## Falhas

| Razão | Semântica |
| --- | --- |
| `unauthenticated` | sessão não verificada |
| `profile_unresolved` | identidade sem profile |
| `forbidden` | actor sem manage efetivo |
| `validation` | request malformado |
| `target_not_in_campaign` | target fora do escopo administrável |
| `delegation_forbidden` | role ultrapassa teto do actor ou contém authority project-level |
| `confirmation_required` | operação sensível/self-revoke sem confirmação |
| `duplicate` | assignment aberto já existe |
| `assignment_not_active` | revoke stale ou assignment já mudou |
| `last_admin` | revogação removeria recuperação administrativa |
| `conflict` | expected revision stale |
| `reconciliation_required` | commit pode ter ocorrido, mas read-back não confirmou |
| `dependency_unavailable` | dependência falhou; sem retry cego |

Nenhum erro SQL/secret é devolvido ao cliente.

## Testes

Fixtures são sintéticas; nenhum profile privado real é copiado.

Cobertura esperada:

- anonymous/sem manage/cross-campaign/expired;
- grant, duplicate, revoke;
- stale CAS / dois admins;
- self-revoke;
- last-admin safeguard;
- project-level denied;
- confirmação de capability crítica;
- audit + read-back;
- busca/filtros;
- preview;
- desktop, mobile, 200% zoom, teclado, light/dark;
- ausência de overflow horizontal.

A migration deve passar `check-migrations`, CI e Production CD antes de considerar a feature publicada. Merge isolado não prova aplicação remota.
