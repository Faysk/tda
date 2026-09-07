# Login Discord: configuração e verificação

> Status: implementado no candidato; OAuth real e publicação pendentes
> Owner: identity/access
> Última revisão: 2026-09-07
> Fonte de verdade: `src/features/auth/`, contrato [identity-access](../domains/identity-access.md)

## Fluxo

`/entrar` consulta o provider habilitado no GoTrue. O único botão de entrada envia POST para `/auth/discord`, validando Origin contra `TDA_AUTH_ORIGIN`. Supabase inicia OAuth Discord com PKCE. O retorno em `/auth/callback` exige cookie HttpOnly de tentativa com nonce, válido por dez minutos, além do verificador PKCE do SDK. A tentativa é consumida no callback; cancelamento, código ausente/expirado e repetição retornam mensagens fixas em português, sem refletir erros externos. Quando GoTrue devolve erro no fragmento da URL, o componente mínimo de entrada traduz apenas a categoria de erro para a mensagem fixa e remove o fragmento.

O destino fica no cookie da tentativa, é revalidado e aceita somente caminho interno; esquemas externos, barras invertidas, caracteres de controle, separadores codificados e rotas de Auth/API são rejeitados. Host e x-forwarded-host não definem redirects. Cookies usam namespace `tda-discord-session`, HttpOnly, SameSite=Lax, Path=/ e Secure em HTTPS. O browser não recebe SDK Auth nem tokens por JSON/localStorage.

Proxy renova a sessão e propaga cookies para request/render e response; o boundary de dados revalida `getUser()` no servidor. Cookies sozinhos e `getSession()` não autorizam. `/auth/logout` aceita somente POST da origem configurada, solicita signOut local do Supabase e remove todos os chunks de cookies TDA. Se o serviço falhar, a remoção local continua, mas a revogação remota não é declarada concluída. Tokens já emitidos podem continuar válidos até expirar; as operações do TDA sempre verificam a sessão no servidor.

## Configuração por ambiente

| Variável | Uso |
| --- | --- |
| `SUPABASE_URL` | Projeto existente `dmrqnbdvbkfqzctcerbx` |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publishable do projeto, nunca secret/service_role |
| `TDA_AUTH_ORIGIN` | Origem exata sem barra final; HTTPS, ou localhost/127.0.0.1 para ensaio local |
| `SUPABASE_SECRET_KEY` | Resolver server-only existente; nunca entregue ao cliente Auth |
| `TDA_READ_EDIT_DATA=true` | Permite ao resolver existente consultar profile e grants no servidor |
| `TDA_EDIT_UNSAFE=false` | Padrão; integração definitiva do adapter continua pendente |

Não configurar Client Secret do Discord no Next: ele pertence exclusivamente ao provider no Supabase. Não rotacionar credenciais nem remover callbacks existentes para testar este candidato.

1. Confirmar que a aplicação Discord existente aponta para `https://dmrqnbdvbkfqzctcerbx.supabase.co/auth/v1/callback`.
2. Confirmar Discord habilitado no Supabase. **Verificado read-only em 2026-09-07** por `/auth/v1/settings`: `external.discord=true`. Não foram lidos tokens de usuários nem alteradas configurações.
3. Na allowlist de redirects do Supabase, confirmar a origem de ensaio deliberada com `/auth/callback` e os query parameters de fluxo. Exemplo local: `http://localhost:3000/auth/callback?flow=*`, conforme a sintaxe de glob da documentação Supabase. Produção futura: `https://dnd.faysk.dev/auth/callback?flow=*`. Restringir host e path; não usar wildcard geral de domínio.
4. Preencher as variáveis no ambiente local privado ou no ambiente de hosting autorizado, nunca no chat ou Git. Publicação e alterações remotas de configuração não fazem parte desta rodada.
5. Executar OAuth com uma pessoa autorizada, testar callback, recarregamento, logout e expiração; verificar conta sem profile/sem grants e conta com permissões. Não abrir/registrar transcrições reais para provar apenas login.

## Integração com Edit

API server-only em `src/features/auth/server.ts`:

- `getVerifiedServerIdentity()` -> `{ok:true,authUserId}` ou `unauthenticated | dependency_unavailable`;
- `authorizeCampaignCapabilityServer({action,campaignSlug})` -> `{ok:true,authUserId,profileId}` ou `unauthenticated | profile_unresolved | forbidden | dependency_unavailable`;
- `requireCapability()` -> guard de página; não deve substituir guard de operação;
- `/api/auth/me` -> estado, scope e capabilities efetivas de Edit; não envia email, IDs Discord, grants crus ou metadata.

O resolver reutiliza `loadEditAccessContext`, já existente na main. Não duplica RBAC nem chama helpers de role legado. `scope_type=project, scope_id=tda` é a representação física de `project/tda`; comparar `scope_id=project/tda` era um bug corrigido com regressão. Assignment ativo, intervalo temporal e action exata continuam obrigatórios. `user_metadata` editável é ignorado.

Páginas `/edit` e `/edit/sessoes/[id]` exigem `campaign.transcript.read`; a Server Action exige `campaign.content.edit` antes do adapter. Login não cria profile, assignment, claim, membership nem permissão. Sem configuração/dependência, o acesso é negado. Conteúdo publicado permanece no boundary público existente.

**Limite importante:** RLS/grants de produção não mudaram. O resolver e as consultas administrativas atuais usam o cliente privilegiado server-only e guards explícitos; isso não equivale a um resolver de capabilities nativo de RLS. A PR #43 define a convergência e a PR #44 contém persistence atômica candidata; nenhuma dessas PRs foi integrada por esta tarefa e a RPC #44 não está presumida disponível. A troca do adapter, revision/conflict/audit e retirada de `TDA_EDIT_UNSAFE` pertencem à integração do Edit. Este candidato protege a entrada existente, mas não declara essa convergência concluída.

## Evidências e gates

Validação local final do candidato: `pnpm check` (99 testes unitários), `pnpm build` e `pnpm test:e2e` (39 casos em 1920×1080, 2560×1440 e 390×844) passaram após o hardening dos cookies. Inspeção visual adicional em navegador local confirmou entrada, cancelamento e conta indisponível.

A revisão automática rejeitou iniciar `pnpm start --port 3102` com as variáveis de configuração pública do Supabase e origem local. Motivo informado: **“blocked by policy”**, sem detalhamento adicional. A rejeição não foi contornada; a inspeção visual usou servidor sem conexão externa. Para OAuth real falta um ambiente de ensaio autorizado com configuração privada e redirect confirmado; a pessoa então abre `/entrar`, seleciona **Entrar com Discord**, conclui login/consentimento e retorna ao TDA. Esta evidência não confirma a allowlist remota de callbacks; o endpoint público de settings confirma somente habilitação do provider. Não alterar callbacks ativos para resolver essa pendência sem avaliação específica.

- Ensaios sintéticos: callback/nonce/replay/cancelamento, redirects hostis, CSRF de login/logout, remoção de cookies na falha de revogação, sessão inválida, refresh propagado, metadata forjada, profile/grants e scope cruzado.
- Navegador: entrada, cancelamento, conta indisponível e negação administrativa com flag legada ligada; desktop e mobile. Não usa dados privados.
- OAuth real **não executado** nesta evidência; habilitação do provider não prova callbacks, consentimento, troca real de código, vínculo de profile nem acesso real.
- Nenhuma migration, escrita de usuário/dado, deploy, DNS ou merge nesta rodada.

## Fontes atuais e legado

- [Supabase Discord OAuth](https://supabase.com/docs/guides/auth/social-login/auth-discord).
- [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
- [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- Next.js: documentação instalada em `node_modules/next/dist/docs`, guias de Auth, cookies, route handlers e proxy.
- `Faysk/dnd-scribe`: `apps/web/components/auth/login-buttons.tsx`, `apps/web/lib/supabase/server.ts`, `apps/web/app/auth/callback/route.ts`. Revalidados PKCE, cookies SSR e retorno interno; Google e arquitetura monolítica não foram transportados.
