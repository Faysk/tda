# Multi-campaign — contrato, rotas e rollout

> Status: arquitetura aprovada
> Owner: architecture / sessions / identity-access
> Última revisão: 2026-09-30
> Fonte de verdade: [ADR-0020](../adr/0020-first-class-campaigns.md), documentos donos de cada domínio e epic #1122

## Objetivo

Definir o contrato transversal para evoluir o TDA de uma campaign principal implícita para múltiplas campaigns first-class sem quebrar a campanha existente, RBAC, links, processamento, World, lore, mídia ou publicação.

Este documento coordena **identidade, routing, boundaries e rollout**. Ele não substitui os documentos donos de schema, segurança, processamento, World, lore ou mídia.

## Estado e terminologia

O estado legado/default continua sendo a campaign técnica `yuhara-main`. Ela deve ser apresentada editorialmente como **Crônicas da Mesa** quando a nova camada pública estiver ativa.

A segunda campaign planejada usa o nome editorial **Antes que seja tarde**. Criá-la significa apenas criar identidade/metadata de campaign. Não inferir sessions, entities, canon, memberships ou vínculo de lore D.

Termos:

| Termo | Autoridade | Pode mudar? | Uso |
| --- | --- | --- | --- |
| campaign UUID | relacional | não | FKs, ownership, joins |
| technical slug | compatibilidade/técnico | excepcionalmente; evitar | RBAC legado, integrações e consumers existentes |
| name | apresentação | sim | UI pública/privada |
| public route key | navegação pública | sim, com alias | URLs canônicas |
| lifecycle | operação | sim por transição | `active | archived` |
| visibility/discovery | audience/autorização | sim | decide quem pode descobrir metadata |

A implementação física de `public route key` pertence a #1123. O contrato recomendado é `public_slug` + aliases históricos versionados. Alias não substitui UUID nem technical slug.

## Invariantes de identidade

1. `campaigns.id` é a autoridade relacional.
2. `campaigns.slug` não é renomeado só porque `name` mudou.
3. public route key pode mudar somente por operação explícita com alias/redirect.
4. source/session/entity identifiers podem colidir entre campaigns quando o domínio permitir.
5. qualquer lookup de identidade ambígua inclui campaign.
6. cache key, idempotency key e receipt de operação campaign-owned carregam campaign identity.
7. uma campaign archived continua resolvível para leitura histórica autorizada; mutações normais falham fechado.

## Matriz canônica de rotas

A coluna **contexto** descreve a campanha necessária para a operação, não se a página mostra o nome da campaign.

| Rota | Audience | Contexto | Projection/capability | Canonical / compatibilidade |
| --- | --- | --- | --- | --- |
| `/` | pública | agregado | somente projeções públicas elegíveis | canônica |
| `/campanhas` | pública | agregado | diretório público mínimo | canônica |
| `/campanhas/sessoes` | pública | agregado | sessions publicadas de campaigns públicas/ativas | canônica |
| `/campanhas/[campaign]/sessoes` | pública | obrigatório | archive público da campaign resolvida | canônica |
| `/campanhas/[campaign]/sessoes/[sourceSessionId]` | pública | obrigatório | detalhe publicado campaign-qualified | canônica |
| `/sessoes` | pública | agregado | nenhuma leitura adicional | compatibilidade → `/campanhas/sessoes` |
| `/sessoes/[sourceSessionId]` | pública | legado | lookup **somente** no boundary legado conhecido; nunca global | compatibilidade → URL canônica |
| `/mundo` | pública | agregado/seleção | hubs públicos elegíveis | canônica como entrypoint |
| `/campanhas/[campaign]/mundo` | pública | obrigatório | World projection pública da campaign | canônica campaign-scoped |
| `/lore` | pública | global curado | catálogo editorial | canônica |
| `/lore/[slug]` | pública | opcional | lore própria; vínculo de campaign é metadata editorial | canônica; URL não muda por vínculo |
| `/lembra` | autenticada | global | biblioteca compartilhada | canônica; classificação campaign é opcional |
| `/transcricoes` | privada | seleção explícita | nenhuma leitura campaign-owned antes da seleção | compatibilidade/entrypoint |
| `/edit/[campaign]/sessoes` | privada | obrigatório | `campaign.transcript.read` + ownership | canônica |
| `/edit/[campaign]/processamento` | privada | obrigatório | `campaign.local.process` | canônica |
| `/edit/[campaign]/transcricoes` | privada | obrigatório | capability de leitura/revisão aplicável | canônica |
| `/edit/[campaign]/revisao` | privada | obrigatório | `narrative.review.read`/actions específicas | canônica |
| `/edit/[campaign]/permissions` | privada | obrigatório | `campaign.permissions.manage` | canônica |
| `/edit/[campaign]/mundo` | privada | obrigatório | World edit capabilities | canônica |
| `/edit/sessoes`, `/edit/processamento`, `/edit/revisao`, `/edit/yuhara-main/permissions` | privada | compatibilidade | resolver seleção/autorização e redirecionar; não assumir default depois da ativação multi-campaign | compatibilidade temporária |

### Regras para redirects e aliases

- redirect de URL pública canônica usa 308 quando a identidade editorial é conhecida e estável;
- uma alias antiga resolve uma única campaign; colisão é erro de configuração;
- `/sessoes/[sourceSessionId]` não pode fazer busca global por source ID;
- durante a janela de compatibilidade, esse path pode resolver apenas a campaign legado explicitamente configurada e redirecionar;
- depois que links legados forem inventariados/migrados, a compatibilidade pode ser removida em entrega própria;
- rota privada sem campaign, quando existem múltiplas opções válidas, mostra/resolve seleção; não escolhe a primeira por ordem de banco.

## Data boundary por domínio

### Sessions e transcripts

- `sessions.campaign_id` é o boundary primário;
- participant pertence à session e herda a campaign;
- recording parts, transcript revisions, editorial drafts, publications e receipts não podem apontar para session de campaign diferente;
- `source_session_id` é campaign-qualified;
- estatísticas agregadas nunca fazem join global por source ID.

### Entities, canon e relations

- entity pertence a exatamente uma campaign quando é narrativa campaign-owned;
- entity slug pode repetir em campaigns distintas se a constraint física permitir;
- profile é global humano; `profile_characters` resolve campaign via entity;
- canon candidate/entry, mention e relation não atravessam campaign silenciosamente;
- relation source/target pertencem à mesma campaign da relation;
- projection pública filtra audience **antes** do browser.

### World Explorer

- workspace, draft, lease, layout, publication e media binding carregam campaign;
- abrir A e B em paralelo produz contextos independentes;
- lease/revision de A não bloqueia B;
- publish de A nunca invalida cache/draft de B por key global.

### Publicações

Publication pertence ao subject publicado e herda sua campaign quando o subject é campaign-owned.

Publicar session não publica transcript/canon automaticamente e publicar uma campaign não existe como atalho para publicar todos os seus recursos.

### Media

Mídia campaign-owned usa namespace/binding derivado de identidade imutável da campaign, não de nome ou public route key renomeável.

A forma física final é definida por #1135. O requisito deste contrato é:

- nenhuma key nova depende somente de `name`;
- rename de URL pública não move bytes;
- binding no banco prova campaign ownership;
- public/private/preview continuam boundaries separados.

### Lembra — exceção global

Lembra permanece biblioteca compartilhada.

Uma referência pode ganhar classificação opcional de campaign para organização/filtro, mas:

- ausência de campaign continua válida;
- classification não concede/nem retira autorização;
- mover classificação não move o objeto entre security boundaries;
- queries de Lembra não assumem campaign corrente por trás do usuário.

### Lore standalone — vínculo independente

Lore pode ser:

- vinculada a uma campaign;
- vinculada a outra dimensão editorial futura;
- ou não vinculada.

A URL `/lore/[slug]` continua estável. Associar D a **Antes que seja tarde** é uma decisão editorial separada da criação da campaign e não cria entity/canon/session automaticamente.

## Discovery e autorização

### Discovery pública

A resposta pública de campaign é uma projection mínima. Campos privados, grants, members, metadata operacional e contagens sensíveis não entram.

Campaign private não pode ser enumerada por slug/UUID, diferença de status ou timing deliberadamente observável.

### Discovery Edit

Usuário autenticado recebe somente campaigns que pode descobrir no contexto operacional.

Membership simples não é autoridade nova. O resolver continua capability-based.

### Project grants

`scope_type=project, scope_id=tda` é global por definição e pode satisfazer a **mesma capability** em campaigns atuais e futuras.

Isso não significa acesso universal:

- role precisa conter a action;
- discovery pode exigir capability própria;
- resource/session scopes exigem ownership real;
- stale/revoked/expired continua negado.

### Inputs não são autoridade

Slug, UUID, query string, hidden input, cookie ou localStorage selecionam intenção. O servidor resolve a campaign e reautoriza a ação.

Uma combinação forjada “slug A + UUID B” falha fechada; não tenta adivinhar.

## Processamento local e handoff

Campaign é obrigatória antes de uma submissão que possa virar session/handoff cloud.

O contrato de request/idempotency inclui:

- campaign identity;
- source identity;
- operação/perfil;
- parâmetros relevantes.

Regras:

- o mesmo source pode ser processado em A e B somente como intenções distintas e auditáveis;
- run ASR bruto continua imutável;
- trocar campaign na UI não retaggeia run já iniciado;
- uma intenção pending mantém sua campaign original;
- retry/recovery reaplica a mesma campaign identity;
- handoff compara campaign da intenção com campaign da session alvo;
- mismatch bloqueia antes de write cloud;
- criar campaign a partir do fluxo é operação administrativa separada e não “auto-cria” campaign ao processar.

## Canonical, SEO e projections agregadas

- Home agregada inclui campaign name/route key nos cards quando necessário para desambiguar;
- canonical de session específica inclui campaign;
- páginas agregadas têm canonical próprio e não apontam para uma campaign arbitrária;
- alias público antigo redireciona antes de emitir canonical;
- lore standalone mantém seu canonical independente do vínculo de campaign;
- conteúdo private/archived não entra em sitemap/metadata pública sem política explícita.

## Rollout em sete fases

### Fase 1 — schema preparado

Adicionar lifecycle, identidade pública/aliases e constraints necessárias de forma aditiva.

Rollback: código antigo continua funcional; não remover colunas/tabelas novas.

### Fase 2 — app compatível

Resolvers, DTOs e rotas passam a aceitar campaign explícita e aliases mantendo paths legados.

Rollback: desativar uso das rotas novas; preservar schema e dados.

### Fase 3 — backfill legado

Mapear a campaign existente sem reescrever conteúdo narrativo. `yuhara-main` permanece technical slug; nome público passa a **Crônicas da Mesa**.

Rollback: voltar apresentação/feature flag; não apagar identidade/backfill.

### Fase 4 — segunda campaign

Criar **Antes que seja tarde** somente com identidade/metadata autorizada. Nada de session/entity/canon fictício.

Rollback: arquivar/desativar exposição da nova campaign; não deletar row se já houver referências.

### Fase 5 — canonical routes

Promover rotas com campaign e redirects/aliases, atualizar navigation/SEO.

Rollback: manter aliases e redirecionar para paths compatíveis; não quebrar links já emitidos.

### Fase 6 — remover hardcodes

Eliminar `yuhara-main` como default implícito de queries, mutations, caches, processamento e ferramentas.

Rollback: usar feature flag/entrypoint compatível; nunca restaurar lookup global ambíguo.

### Fase 7 — deprecar legado

Só remover aliases/paths/scopes antigos quando inventário de consumers, logs e testes mostrarem ausência de dependência.

Rollback: reativar alias, não renomear UUID/technical slug.

## Gates cross-campaign

Antes de ativar a segunda campaign:

- scratch PostgreSQL com A/B e IDs colidentes;
- negative auth matrix A→B;
- browser E2E de público/Edit;
- processing recovery/idempotency A/B;
- World draft/lease/publish isolation;
- media binding isolation;
- canonical/redirect/alias tests;
- archived/private discovery negatives;
- viewports e keyboard definidos em #1138;
- receipts sanitizados e vinculados ao SHA candidato.

### Gate executável da #1138

O workflow `.github/workflows/campaign-isolation.yml` é o gate transversal executável. Ele nunca consulta conteúdo narrativo privado nem aplica mutações em Production.

Em PR e em `main`, o workflow:

- fixa e verifica o SHA exato do checkout antes de cada suíte;
- roda contratos TypeScript de identidade/campaign, PostgreSQL descartável, browser E2E A/B e Companion scratch sem modelos pesados;
- usa fixtures sintéticos com `source_session_id` colidente entre A/B para provar que rotas, canonical e agregação não confundem campanhas;
- cobre 320×800, 390×844, 1366×768, 1920×1080, 2560×1440 e equivalente de 200% de zoom;
- produz `campaign-isolation-receipt.json` sem conteúdo de transcript/canon, registrando SHA, resultados das suítes e blockers de readiness.

A execução manual `workflow_dispatch` recebe `source_sha` e, por padrão, `require_ready=true`. Nesse modo o scanner `tools/ci/campaign-isolation-readiness.mjs` falha fechado enquanto qualquer consumer conhecido ainda depender de campaign global/legada. Remover um blocker exige remover o hardcode no domínio dono; não é permitido silenciar a regra no gate para liberar rollout.

O receipt de PR/main pode existir com `activationReady=false`: isso significa **infraestrutura do gate saudável, rollout ainda bloqueado**. Só um receipt do SHA candidato com todas as suítes `success` e `activationReady=true` satisfaz o gate de ativação da segunda campaign.

## Ownership das issues filhas

| Issue | Documento dono |
| --- | --- |
| #1123 registry/schema | [Modelo de dados](../data-model.md) + docs de banco |
| #1134 security/discovery | [Identidade e autorização](../domains/identity-access.md) + [database/security](../database/security.md) |
| #1124 directory | [Diretório e gestão de campanhas](../features/campaign-directory.md) |
| #1125 public sessions | [Campanhas e sessões](../domains/sessions.md) |
| #1127 Home | este contrato + owner da Home |
| #1128 processing | [Processamento local](../features/local-processing.md) |
| #1129 Edit sessions/move | [Campanhas e sessões](../domains/sessions.md) |
| #1130 World | [World Explorer](../features/world-explorer.md) |
| #1131 lore | [Lores independentes](../features/independent-lores.md) |
| #1132 Lembra | [Lembra](../features/lembra.md) |
| #1133 transcripts/stats | [Revisão/publicação](../features/transcript-review-publication.md) |
| #1135 media | [Media Pipeline](../integrations/r2/media-pipeline.md) |
| #1136 navigation | [Navegação global](../features/global-navigation.md) |
| #1138 transversal gate | este contrato + documentos donos dos testes específicos |

## Não objetivos

- aplicar migration remota;
- criar campanha por inferência;
- mover sessões nesta issue;
- alterar conteúdo narrativo;
- publicar D no catálogo;
- criar novo provider;
- remover compatibilidade antes de evidência.

## Referências

- [ADR-0020](../adr/0020-first-class-campaigns.md)
- [Campanhas e sessões](../domains/sessions.md)
- [Identidade e autorização](../domains/identity-access.md)
- [Modelo de dados](../data-model.md)
- [Navegação global](../features/global-navigation.md)
- [Processamento local](../features/local-processing.md)
- [World Explorer](../features/world-explorer.md)
- [Lores independentes](../features/independent-lores.md)
- [Lembra](../features/lembra.md)
- [Media Pipeline](../integrations/r2/media-pipeline.md)
- #1122
- #1137

## Implementação Sessions/Edit — #1129 (2026-10-01)

Sessions/Edit adotou o mesmo boundary explícito de campanha do World: selector/entrypoint em `/edit/sessoes`, rota canônica em `/edit/[technical_slug]/sessoes` e detalhe qualificado por campanha. Nenhum `source_session_id` é tratado como global.

Server Actions de transcript/draft/publication/cover resolvem ou recebem a identidade real da sessão no servidor antes de autorizar; não usam `yuhara-main` como autoridade implícita. A troca de campanha é uma mutation de domínio separada, auditável, idempotente e fail-closed conforme `docs/domains/sessions.md`.
