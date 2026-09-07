# Edit — consulta de permissões

> Status: implementação candidata, somente leitura
> Owner: identity/access + Edit
> Última revisão: 2026-09-07
> Fonte de verdade: `src/features/edit/permissions/`, `src/features/edit/access/policy.ts` e contrato de identidade

## Entrega e limites

Implementado na branch `codex/permissions-admin-read`: tela pt-BR desktop/mobile em `/edit/{campaignSlug}/permissions`, acessível por **Minha conta → Consultar permissões**. API `GET /api/edit/{campaignSlug}/permissions` usa o mesmo boundary. Ainda não publicado; não altera dados, grants, RLS, DDL ou Auth/config. Não é diretório global nem fluxo de claim.

O usuário autorizado consulta pessoas com atribuições na campanha pedida ou herdadas do projeto TDA. Busca por nome, profile ID, função ou action ocorre apenas sobre o DTO já autorizado. A tela distingue atribuições ativas, elegíveis, encerradas, revogadas e fora da validade. Resultado vazio é diferente de falta de acesso ou indisponibilidade.

**Conceder/revogar não está implementado.** Nenhum botão, Server Action ou endpoint aceita write; POST/PATCH/DELETE na API retornam 405. `campaign.permissions.manage` não é uma política de delegação completa.

## Contrato confirmado antes da implementação

Cofrinho (dados) e Crachá (identidade) confirmaram em 2026-09-07 a reutilização do resolvedor server-only e da capability física `campaign.permissions.manage`, `plane=technical`. A leitura direta de `permission_catalog` e do schema pelo autor também confirmou nomes/colunas; nenhuma pessoa privada foi copiada para fixtures.

| Fonte física | Uso nesta consulta |
| --- | --- |
| `profiles` | `id`, `display_name`; presença de `auth_user_id` e `discord_id` convertida em booleanos |
| `role_assignments` | identidade da atribuição/role/profile, scope, status e janela temporal |
| `role_definitions` | `id`, `slug`, `name` |
| `role_permissions` | relação `role_id` → `permission_action`, com FK ao catálogo físico |
| `permission_catalog` | fonte das actions; nenhuma action nova ou concessão é criada |
| `campaigns` | valida existência pelo `slug`; devolve nome e slug somente após autorização |

Não há RPC capability/diretório administrativo/grant/revoke canônica para esse consumer. `access_directory` é onboarding legado com autorização por membership/role e dívida de isolamento; **não é utilizado**. O client privilegiado `editDataClient()` fica server-only. Não alegar autorização nativa por RLS: a proteção desta leitura é o servidor, conforme [Identidade e acesso](../domains/identity-access.md) e [Segurança do banco](../database/security.md).

## Fluxo de autorização

1. Rota recebe somente campaign slug; identidade vem de `getVerifiedServerIdentity()` com `auth.getUser()`.
2. Core valida formato do slug, resolve `loadEditAccessContext` e confere a identidade devolvida.
3. `authorizeCampaignCapability(context, EDIT_CAPABILITIES.permissionsManage, campaignSlug)` autoriza **uma vez antes** de qualquer consulta ao diretório.
4. Repository consulta somente atribuições `campaign + {slug}` ou `project + tda`; resolve exclusivamente os profiles/roles referenciados.
5. Projection explícita retorna dados mínimos; erro de qualquer dependência descarta todo o resultado. API responde `private, no-store`; página é dinâmica e herda noindex do Edit.

Aceita a action exata em atribuição ativa, com `starts_at <= now` e `ends_at > now` ou nulo. `project + tda` cobre a operação porque a mesma action está presente. Nega `project/dnd-scribe`, `scope_id=project/tda`, outra campanha, session/resource/integration, assignment inativo ou outra action — inclusive `project.rbac.manage` e `campaign.access.manage`. Nome de role, provider, login e `user_metadata` nunca autorizam.

O objeto `EDIT_CAPABILITIES` ganha somente `permissionsManage` neste recorte. O algoritmo permanece único; `isEffectiveCampaignGrant` extrai o predicado temporal/de scope já existente para a apresentação da validade. Não amplia o tipo para `string` nem infere permissões por prefixo.

## DTO e explicação de origem

- Pessoa: `id`, `displayName`, `authLinked`, `discordLinked`.
- Função atribuída: ID, slug/nome, scope, status/validade, `active` e `actions` físicas catalogadas.
- `verifiedEditAccess`: somente operações explicitamente presentes em `EDIT_CAPABILITIES`, verificadas pelo mesmo `authorizeCampaignCapability`. Cada action preserva as origens com assignment ID, role slug/nome e scope; duas origens não são reduzidas a uma autorização opaca.
- Campanha e horário da consulta.

**Direta** descreve atribuição na própria campanha; **herdada** descreve atribuição `project + tda`. Todas as actions vêm de roles: não existe grant direto por action nesse schema. Histórico inativo continua visível, mas não concede acesso verificado.

`roles.actions` não significa acesso efetivo genérico: por exemplo `project.jobs.run` permanece visível no catálogo da função técnica, sem ser declarado acesso à campanha. Não inferir eficácia de `plane`, prefixo `campaign.*`, `project.*` ou `narrative.*`. Um futuro consumer precisa aprovar sua action/ownership antes de entrar no conjunto explícito.

Não saem do servidor: auth user ID, Discord ID/handle, email, avatar remoto, claims, metadata, reason, assigned/revoked by ou linhas completas. `Discord registrado` prova apenas presença de identificador no profile; não prova provider OAuth atual. Conta sem vínculo continua sem possibilidade de login no perfil, mesmo se existir uma função atribuída.

## Catálogo compartilhável com processamento

Os consumers reutilizam o mesmo RBAC, mas cada operação pede uma action exata:

| Consumer | Action/escopo confirmado |
| --- | --- |
| Esta consulta | `campaign.permissions.manage`, campanha ou projeto TDA com a mesma action |
| Processamento local | `campaign.local.process`, contrato do consumer local |
| Download/áudio/importações | existem `campaign.companion.download`, `campaign.audio.read`, `campaign.upload.manage`; existência não define automaticamente todos os writes |
| Jobs cloud | `project.jobs.read`, `project.jobs.run`; exigem consumer de projeto próprio |
| Monitor cloud | `project.monitor.read`; não derivado da conta Windows |

O usuário do Windows não é profile/cloud role. Sync de bundle tem contrato separado com o dono de ingestão e Cofrinho; esta PR não o autoriza por analogia a `local.process` ou `upload.manage`. [Processamento](../domains/processing.md) continua dono do fluxo.

## Limites operacionais e apoio

Leitura limitada a **500 linhas por conjunto** (assignments, profiles, roles ou role_permissions). Cada SELECT pede contagem exata e compara com o total devolvido: truncamento, limite excedido, referência desaparecida ou falha gera indisponibilidade, nunca inventário parcial apresentado como completo. Antes de superar esse limite, implementar paginação/snapshot próprio com o dono do banco.

A leitura ocorre em várias consultas, sem snapshot transacional. Uma mudança concorrente pode exigir atualizar a página; não é auditoria histórica nem prova transacional de que uma permissão não mudou depois do guard. Concessão/revogação futura precisará de boundary atômico separado.

| Resultado | HTTP / ação operacional |
| --- | --- |
| `unauthenticated` | 401; entrar novamente por Discord |
| `profile_unresolved` | 403; conferir vínculo canônico com responsável, sem fallback por email |
| `forbidden` | 403; conferir action, scope e validade com gestor autorizado |
| `validation` | 400; corrigir URL, nenhum acesso ao banco |
| `not_found` | 404 após autorização; conferir slug |
| `dependency_unavailable` | 503; conferir Auth, flags/chaves server, saúde PostgREST, contagens <=500 e integridade das referências, nessa ordem |

Nenhum erro SQL, chave ou detalhe privado é devolvido na resposta. Não habilitar flag insegura nem criar grant como tentativa de corrigir um 503.

## Gap de delegação

Antes de implementar write, fechar: roles/planes delegáveis, target campaign/project, possibilidade de delegar a própria capability, prevenção de autoelevação, proteção do último gestor, revoke/expire/regrant, actor verificado, idempotência/concorrência, auditoria old/new mínima na mesma transação e rollback em falha. `assigned_by`, `revoked_by` e `reason` existentes são infraestrutura, não autorização suficiente. SQL candidato deve ser coordenado com Cofrinho; esta entrega não cria migration.

## Validação e checklist de ativação

Testes unitários exercitam core, wrapper de identidade, scope/tempo, projection mínima, catálogo versus eficácia, origem múltipla e falhas/truncamento do repository. A suíte `playwright.permissions.config.ts` executa a **build real** com Auth/PostgREST HTTP sintéticos locais, sem mock do guard da aplicação, em desktop 1440 e mobile 390. Ela cobre anônimo, reader, técnico, outra campanha, revogado, sem profile, indisponibilidade, gestor direto/projeto, API direta, write 405, busca e ausência de overflow. Serviço de teste fica em `tools/testing`, nunca no app; a suíte integra `pnpm test:e2e` e o CI existente.

- [ ] CI terminal do SHA candidato: `pnpm check`, `pnpm build`, `pnpm test:e2e`.
- [ ] Integrar preservando CTA de processamento e demais entradas explícitas adicionadas por outros consumers; não substituir o objeto de capabilities inteiro.
- [ ] Configuração Auth validada por Catraca conforme [runbook Discord](../operations/discord-auth.md); identidade de teste autorizada de forma deliberada, sem auto-grant.
- [ ] `TDA_READ_EDIT_DATA=true`, URL e secret server-side válidos; sem necessidade de `TDA_EDIT_UNSAFE`.
- [ ] Publicação deliberada por responsável, fora desta implementação.
- [ ] Smoke real com gestor autorizado e usuário sem permission, repetindo campanha cruzada e ausência de campos privados; registrar evidência sem capturar dados pessoais.
- [ ] Manter aviso **somente leitura**; não anunciar grant/revoke nem OAuth real como verificados apenas pelo CI sintético.

Node 24.20.0 existente foi utilizado localmente, sem instalação global. Next 16.3.4/React 19.2.8 foram reconsultados no registry e documentação Next instalada lida; nenhuma dependência nova é necessária. O lockfile existente permanece fixado; atualização do SDK Supabase é independente desta feature e não foi feita implicitamente.
