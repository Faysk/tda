# Diretório e gestão de campanhas

> Status: preparado em código; ativação depende do registry/authorization multi-campaign aplicado
> Owner: campaigns / public navigation / Edit
> Última revisão: 2026-09-30
> Issues: #1122, #1124

## Objetivo

Definir a superfície pública `/campanhas` e o boundary administrativo `/edit/campanhas` sem transformar descoberta pública em autorização de Edit nem usar nome humano como identidade técnica.

Este documento é dono da UX e dos contratos do diretório/registry. Identidade física, lifecycle e aliases continuam definidos por [ADR-0020](../adr/0020-first-class-campaigns.md) e pelo [contrato multi-campaign](../architecture/multi-campaign.md). Segurança/discovery continuam no domínio de [Identidade e autorização](../domains/identity-access.md).

## Estado de rollout

A aplicação contém as superfícies e boundaries server-side, mas os candidates de #1123/#1134 continuam em `supabase/candidates/` até promoção deliberada.

Consequências:

- o código **não** presume que Production já possui `public_slug`, `lifecycle` ou `visibility`;
- ausência do schema esperado produz estado de dependência indisponível, nunca fallback para enumerar rows privadas;
- nenhuma mutation remota é executada por existir a UI;
- o rollout do banco continua separado pelo runbook de Production.

## Público — `/campanhas`

A projection pública contém somente:

- `routeKey`;
- `name`;
- `description`.

Filtros obrigatórios:

- `lifecycle = active`;
- `visibility = public`;
- `public_slug` resolvido.

Não entram UUID, technical slug, metadata operacional, grants, memberships ou contagens que exijam consulta privada.

### Estados

- zero campaigns: empty state editorial;
- uma ou mais campaigns: cards compactos;
- descrição ausente: fallback neutro, sem inventar narrativa;
- dependency failure: estado explícito, sem lista parcial;
- archived/private: indistinguível de ausência no diretório.

Cada card aponta para o archive campaign-qualified em `/campanhas/[routeKey]/sessoes`.

## Route key e aliases

`public_slug` é a URL canônica. Alias histórico é resolvido server-side e redireciona para a rota atual.

Technical slug:

- não aparece como título;
- continua identidade de compatibilidade/RBAC;
- não muda em edição editorial.

Public route key:

- aceita somente ASCII minúsculo, números e hífens;
- é normalizado antes de validar;
- colisão com canonical/alias falha fechada;
- rename depende do recorder de alias definido no candidate de registry.

## Edit — `/edit/campanhas`

A página exige exatamente `project.campaigns.manage` em `project/tda`.

Campaign-scoped grants não são promovidos para essa capability.

Operações:

### Criar

Entrada:

- nome;
- technical slug;
- public route key;
- descrição opcional;
- visibilidade inicial.

A criação registra somente identidade/metadata de campaign com:

- UUID estável gerado no servidor;
- lifecycle `active`;
- `metadata.content_state = identity_only`;
- nenhum session/entity/member/canon criado por conveniência.

### Editar

Campos mutáveis:

- nome;
- descrição;
- public route key;
- visibilidade.

Technical slug não é alterado pela aplicação.

A mutation usa optimistic concurrency por `updated_at`. Stale form retorna conflito em vez de sobrescrever silenciosamente outra edição.

### Arquivar / reativar

Arquivar:

- altera lifecycle para `archived`;
- registra `archived_at`;
- preserva row, UUID, aliases e referências históricas.

Reativar limpa `archived_at` e restaura lifecycle `active`.

## Autorização

A seleção de uma rota, UUID, hidden input ou form value expressa intenção; não concede acesso.

Em toda mutation:

1. Auth é verificado no servidor;
2. profile é resolvido;
3. grants ativos são carregados;
4. exige-se `project.campaigns.manage` em `project/tda`;
5. somente então o repository usa a conexão server-side.

Não existe secret/service key no browser.

## Concorrência e falhas

- create collision → `conflict`;
- stale update/archive/reactivate → `conflict`;
- target ausente → `not_found`;
- schema/provider indisponível → `dependency_unavailable`;
- validação inválida → nenhuma tentativa de write.

Após sucesso, `/campanhas` e `/edit/campanhas` são revalidados.

## Sessões

#1124 só precisa garantir que um card de campaign abra uma superfície campaign-qualified válida.

A rota `/campanhas/[routeKey]/sessoes` já resolve canonical/alias e consulta sessões publicadas pelo **technical slug resolvido no servidor**.

A evolução completa do arquivo agregado, canonical detail, aliases de `/sessoes`, campaign metadata em cards e paginação continua pertencendo a #1125.

## Testes

### Unit

- Unicode/NFC para nome;
- slug/route key canônico;
- capability project-only;
- grants expirados/campaign-scoped negados;
- media/session projection campaign-qualified.

### Browser E2E

Fixtures sintéticas, sem conteúdo real:

- duas campaigns públicas;
- nome longo;
- descrição ausente;
- clique para archive A/B;
- campaign B sem sessions não recebe sessions de A;
- 320 px sem overflow;
- teclado;
- 200% zoom.

### DB / rollout

Os contracts de #1123/#1134 permanecem responsáveis por:

- constraints/aliases/lifecycle;
- discovery pública/Edit;
- capability `project.campaigns.manage`;
- cross-campaign negatives;
- scratch PostgreSQL antes de qualquer promoção.

## Não objetivos

- editar grants nesta tela;
- criar sessions/entities automaticamente;
- mover session entre campaigns;
- inferir lore/canon;
- publicar segunda campaign antes do rollout do registry;
- substituir #1125/#1128/#1136.

## Rollback

Antes da ativação do schema multi-campaign:

- remover/desabilitar as superfícies novas não altera dados existentes.

Depois da ativação:

- rollback de UI não remove campaigns nem aliases;
- archived é usado para desativar operação sem hard delete;
- public route alias permanece resolvível;
- correção de schema é forward-only conforme runbook.


## 2026-10-01 — delivery candidate

The pre-registry compatibility path now exposes only the known historical campaign when the database specifically reports missing registry columns. Permission errors, timeouts and other schema failures remain unavailable. Registry activation is prepared in the three current-timestamp migrations documented in [migrations](../database/migrations.md); live completion is recorded separately.

Directory cards can consume an optional verified cover projection (URL, dimensions), resolved internally from the campaign UUID and immutable technical key. IDs, grants and operational metadata are not returned in the public projection. The promotion registry starts empty until real artwork passes preparation/read-back, public delivery and visual review.

The public directory and campaign archive reserve clearance for the floating brand at every breakpoint. Chrome/Windows mobile inspection found the earlier 38–40px top padding overlapping the introductory label; a browser geometry regression gate now checks both introductions at 320, 390 and 1366px.
