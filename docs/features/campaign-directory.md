# Diretório e gestão de campanhas

> Status: registry first-class ativo; diretório público em operação
> Owner: campaigns / public navigation / Edit
> Última revisão: 2026-10-01
> Issues: #1122, #1124, #1281

## Objetivo

Definir a superfície pública `/campanhas` e o boundary administrativo `/edit/campanhas` sem transformar descoberta pública em autorização de Edit nem usar nome humano como identidade técnica.

Este documento é dono da UX e dos contratos do diretório/registry. Identidade física, lifecycle e aliases continuam definidos por [ADR-0020](../adr/0020-first-class-campaigns.md) e pelo [contrato multi-campaign](../architecture/multi-campaign.md). Segurança/discovery continuam no domínio de [Identidade e autorização](../domains/identity-access.md).

## Estado de rollout

#1284 promoveu e aplicou o registry/authorization first-class em Production. O
estado normal do diretório agora é `registryMode=canonical`.

O fallback legado de #1225 permanece apenas como compatibilidade defensiva
durante rollback/recuperação. Ele não conta como readiness first-class e não é
autoridade para Edit.

A projection pública continua fail-closed para erro de banco/schema não
reconhecido e nunca enumera campaign privada/arquivada.

## Público — `/campanhas`

A projection pública de campaign contém somente:

- `routeKey`;
- `name`;
- `description`;
- `coverImage` quando existe binding público verificado.

A página compõe essa projection com **uma única leitura do arquivo público de
sessões** para derivar apresentação editorial sem N consultas por campaign.
Somente campos já aprovados para o arquivo público entram nessa composição.

Filtros obrigatórios:

- `lifecycle = active`;
- `visibility = public`;
- `public_slug` resolvido.

Não entram UUID, technical slug, metadata operacional, grants, memberships ou contagens que exijam consulta privada.

### Estados e apresentação

- zero campaigns: empty state editorial;
- uma ou mais campaigns: cards compactos e comparáveis;
- descrição ausente: fallback neutro, sem inventar narrativa;
- dependency failure do registry: estado explícito, sem lista parcial;
- falha apenas na leitura de sessões: campaigns continuam visíveis, sem inventar
  contagem zero nem artwork derivado;
- archived/private: indistinguível de ausência no diretório.

Artwork segue uma ordem determinística:

1. cover pública verificada da campaign;
2. cover da memória pública mais recente;
3. hero da memória pública mais recente;
4. fallback visual TDA local.

A memória mais recente usa o mesmo ordering determinístico do feed público
(data, campaign e source id). Contagem e “última memória” vêm exclusivamente da
projection pública.

Cada card aponta para o archive campaign-qualified em
`/campanhas/[routeKey]/sessoes`.

Descrições operacionais de seed/import não são apresentação editorial. #1281
limpa o placeholder histórico conhecido no dado e a UI usa copy neutra quando
não existe descrição editorial.

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
