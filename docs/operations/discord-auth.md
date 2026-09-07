# Login Discord: configuração e verificação

> Status: runtime integrado; configuração production publicada; OAuth real pendente
> Owner: identity/access
> Última revisão: 2026-09-07
> Fonte de verdade: `src/features/auth/`, contrato [identity-access](../domains/identity-access.md) e [deployments](deployments.md)

## Estado vigente

A **Production #004** publicou a configuração mínima de Auth no target Production sem alterar o código de aplicação: source `0120e38d28c51f3e90aa7336dfa8e7910df074f4`, deployment `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD`, READY em `2026-09-07T19:21:22.439Z`.

O Dashboard Vercel confirmou a ausência prévia da configuração necessária e a posterior adição **Production-only** de:

- `SUPABASE_PUBLISHABLE_KEY`;
- `TDA_AUTH_ORIGIN=https://dnd.faysk.dev`.

Nenhuma rotação, grant, alteração de Preview, migration ou escrita de banco fez parte dessa operação. Os demais valores/configurações existentes não são inferidos nem duplicados aqui.

Smokes comprovados após a publicação:

- `/entrar` responde `200` e renderiza **Entrar com Discord** habilitado;
- `/api/auth/me` responde `200` para visitante anônimo com `state=anonymous`, scope `campaign/yuhara-main` e `capabilities=[]`;
- o início do fluxo registrou `POST /auth/discord` -> `303` para Supabase -> `302` para `discord.com`.

**Isso não é prova de login completo.** Continuam pendentes: consentimento real no Discord, retorno ao `/auth/callback`, troca real de código, sessão autenticada, resolução de `profiles`, grants/capabilities reais, logout/expiração no fluxo real e validação de uma conta autorizada. Catraca permanece em andamento.

O recibo operacional local informado para o release é `D:/Projects/tda/.local/production004-auth.md`. Ele permanece fora do Git; este runbook registra apenas os fatos necessários sem copiar secrets.

## Fluxo

`/entrar` consulta o provider habilitado no GoTrue. O único botão de entrada envia POST para `/auth/discord`, validando Origin contra `TDA_AUTH_ORIGIN`. Supabase inicia OAuth Discord com PKCE. O retorno em `/auth/callback` exige cookie HttpOnly de tentativa com nonce, válido por dez minutos, além do verificador PKCE do SDK. A tentativa é consumida no callback; cancelamento, código ausente/expirado e repetição retornam mensagens fixas em português, sem refletir erros externos. Quando GoTrue devolve erro no fragmento da URL, o componente mínimo de entrada traduz apenas a categoria de erro para a mensagem fixa e remove o fragmento.

O destino fica no cookie da tentativa, é revalidado e aceita somente caminho interno; esquemas externos, barras invertidas, caracteres de controle, separadores codificados e rotas de Auth/API são rejeitados. Host e x-forwarded-host não definem redirects. Cookies usam namespace `tda-discord-session`, HttpOnly, SameSite=Lax, Path=/ e Secure em HTTPS. O browser não recebe SDK Auth nem tokens por JSON/localStorage.

Proxy renova a sessão e propaga cookies para request/render e response; o boundary de dados revalida `getUser()` no servidor. Cookies sozinhos e `getSession()` não autorizam. `/auth/logout` aceita somente POST da origem configurada, solicita signOut local do Supabase e remove todos os chunks de cookies TDA. Se o serviço falhar, a remoção local continua, mas a revogação remota não é declarada concluída. Tokens já emitidos podem continuar válidos até expirar; as operações do TDA sempre verificam a sessão no servidor.

## Configuração por ambiente

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | Projeto existente `dmrqnbdvbkfqzctcerbx` |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publishable do projeto, nunca secret/service_role; presente no target Production desde Production #004 |
| `TDA_AUTH_ORIGIN` | Origem exata sem barra final; em Production #004: `https://dnd.faysk.dev` |
| `SUPABASE_SECRET_KEY` | Resolver server-only existente; nunca entregue ao cliente Auth |
| `TDA_READ_EDIT_DATA=true` | Permite ao resolver existente consultar profile e grants no servidor |
| `TDA_EDIT_UNSAFE=false` | Padrão; integração definitiva do adapter continua pendente |

Não configurar Client Secret do Discord no Next: ele pertence exclusivamente ao provider no Supabase. Não rotacionar credenciais nem remover callbacks existentes apenas para testar o fluxo.

1. Confirmar que a aplicação Discord existente aponta para `https://dmrqnbdvbkfqzctcerbx.supabase.co/auth/v1/callback` antes de qualquer alteração remota.
2. Confirmar Discord habilitado no Supabase. **Verificado read-only em 2026-09-07** por `/auth/v1/settings`: `external.discord=true`. Não foram lidos tokens de usuários nem alteradas configurações.
3. Na allowlist de redirects do Supabase, confirmar deliberadamente `https://dnd.faysk.dev/auth/callback?flow=*` conforme a sintaxe suportada. O redirect inicial da Production #004 chegar a `discord.com` não substitui a prova do retorno real ao callback.
4. Manter variáveis privadas somente no ambiente apropriado, nunca no chat ou Git. Production #004 adicionou somente as duas entradas explicitamente registradas acima; Preview não foi alterado.
5. Executar OAuth com uma pessoa autorizada, testar consentimento, callback, recarregamento, logout e expiração; verificar conta sem profile/sem grants e conta com permissões. Não abrir/registrar transcrições reais para provar apenas login.

## Integração com Edit

API server-only em `src/features/auth/server.ts`:

- `getVerifiedServerIdentity()` -> `{ok:true,authUserId}` ou `unauthenticated | dependency_unavailable`;
- `authorizeCampaignCapabilityServer({action,campaignSlug})` -> `{ok:true,authUserId,profileId}` ou `unauthenticated | profile_unresolved | forbidden | dependency_unavailable`;
- `requireCapability()` -> guard de página; não deve substituir guard de operação;
- `/api/auth/me` -> estado, scope e capabilities efetivas de Edit; não envia email, IDs Discord, grants crus ou metadata.

O resolver reutiliza `loadEditAccessContext`. Não duplica RBAC nem chama helpers de role legado. `scope_type=project, scope_id=tda` é a representação física de `project/tda`; assignment ativo, intervalo temporal e action exata continuam obrigatórios. `user_metadata` editável é ignorado.

Páginas `/edit` e `/edit/sessoes/[id]` exigem `campaign.transcript.read`; a Server Action exige `campaign.content.edit` antes do adapter. Login não cria profile, assignment, claim, membership nem permissão. Conteúdo publicado permanece no boundary público existente.

**Limite importante:** RLS/grants de produção não mudaram na Production #004. O resolver e as consultas administrativas atuais usam o cliente privilegiado server-only e guards explícitos; isso não equivale a um resolver de capabilities nativo de RLS. O contrato de capabilities e o código da migration atômica do Edit já estão versionados/integrados na linha de código, mas a presença da migration no Git **não prova aplicação remota da RPC**. A troca do adapter, revision/conflict/audit, aplicação controlada da migration e retirada de `TDA_EDIT_UNSAFE` pertencem à integração do Edit.

## Evidências e gates

### Evidência de implementação anterior

A implementação de Auth foi validada antes da integração com ensaios sintéticos de callback/nonce/replay/cancelamento, redirects hostis, CSRF de login/logout, remoção de cookies na falha de revogação, sessão inválida, refresh propagado, metadata forjada, profile/grants e scope cruzado. Build, testes e navegador sintético passaram naquele candidato.

Essa evidência validou o código, não o OAuth externo real.

### Evidência operacional — Production #004

- deployment `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD` confirmado `READY` e `production`;
- `/entrar` habilitado em production;
- `/api/auth/me` preserva visitante anônimo sem capabilities;
- início do redirect OAuth chega a Supabase e Discord;
- configuração registrada somente em Production;
- nenhuma migration/grant/DB/Preview/rotação executada.

### Gate restante para declarar login funcional

Só declarar Catraca/login Discord funcional após observar no fluxo real, com conta autorizada:

1. consentimento no Discord;
2. retorno ao callback esperado;
3. troca de código/sessão válida;
4. `/api/auth/me` refletindo estado autenticado coerente;
5. profile/capabilities corretos para conta com e sem grants;
6. logout e expiração/reload;
7. ausência de regressão de autorização no Edit.

Até isso ocorrer, **Production #004 = configuração Auth operacional + início de fluxo validado; login completo pendente**.

Rollback desta configuração/release é a **Production #003** (`dpl_GHJgH7VdNrJd9izpYScog48UjSsE`).

## Fontes atuais e legado

- [Supabase Discord OAuth](https://supabase.com/docs/guides/auth/social-login/auth-discord).
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- Next.js: documentação instalada em `node_modules/next/dist/docs`, guias de Auth, cookies, route handlers e proxy.
- `Faysk/dnd-scribe`: `apps/web/components/auth/login-buttons.tsx`, `apps/web/lib/supabase/server.ts`, `apps/web/app/auth/callback/route.ts`. Revalidados PKCE, cookies SSR e retorno interno; Google e arquitetura monolítica não foram transportados.
