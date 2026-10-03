# Diretório e gestão de campanhas

> Status: registry first-class ativo; diretório público em operação
> Owner: campaigns / public navigation / Edit
> Última revisão: 2026-10-03
> Issues: #1122, #1124, #1281, #1322

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

#1322 define esta superfície como **gerenciador humano de campanhas**, não como
um registry técnico exposto ao operador. A primeira área útil prioriza:

- título curto `Campanhas`;
- ação `Nova campanha`;
- lista compacta com capa/fallback, nome, descrição, lifecycle e visibilidade;
- edição somente da campaign escolhida.

UUID, technical slug e metadata operacional ficam em progressive disclosure.
Nenhum desses valores concede autoridade.

### Criar

Campos comuns:

- nome;
- visibilidade inicial;
- descrição opcional;
- public route key.

A chave técnica fica em `Detalhes avançados`. Quando o operador não fornece
uma chave separada, a criação usa deterministicamente a **rota pública inicial**
como technical slug. Depois da criação a chave técnica permanece estável e não
acompanha rename editorial ou mudança posterior de public route key.

A criação registra somente identidade/metadata de campaign com:

- UUID estável gerado no servidor;
- lifecycle `active`;
- `metadata.content_state = identity_only`;
- nenhum session/entity/member/canon criado por conveniência.

### Editar

Cada campaign abre seu editor contextualmente; os formulários das demais ficam
recolhidos.

Campos mutáveis:

- nome;
- descrição;
- public route key;
- visibilidade.

Technical slug e UUID são somente leitura no disclosure avançado. A mutation
continua usando optimistic concurrency por `updated_at`; stale form retorna
conflito em vez de sobrescrever silenciosamente outra edição.

Feedback de create/update/archive/reactivate, validation, collision, stale write
e dependency failure fica junto da operação correspondente. Um erro de edição
reabre apenas o editor da campaign atingida.

### Capa

Na lista, a capa é apenas thumbnail/fallback. Upload, replace e remove continuam
no `CampaignCoverEditor` dentro do editor contextual.

Antes do seletor de arquivo, a UI declara a visibilidade **persistida** atual:

- campaign pública: uma capa promovida/verificada pode aparecer em superfícies públicas;
- campaign privada: upload não torna a campaign pública e continua sujeito ao
  pipeline de promoção/read-back.

Alterar o select de visibilidade só produz efeito após `Salvar alterações`.

### Arquivar / reativar

Lifecycle fica em `Mais ações`, separado da ação primária de salvar.

Arquivar:

- altera lifecycle para `archived`;
- registra `archived_at`;
- preserva row, UUID, aliases e referências históricas;
- não equivale a delete.

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

- zero, uma e várias campaigns no manager;
- nomes aprovados Destino Sem Fim / Passos Retomados na fixture principal;
- nome longo e descrição ausente;
- ação Nova campanha e primeiro item ainda na primeira viewport;
- create/edit contextuais por disclosure, inclusive teclado;
- technical slug/UUID ocultos na leitura comum e disponíveis sob detalhes avançados;
- feedback de conflict/validation localizado na operação e disclosure correto reaberto;
- labels Pública/Privada e Ativa/Arquivada;
- campaign B sem sessions não recebe sessions de A;
- 320×800, 390×844 e viewport equivalente a 200% sem overflow.

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

## Recovery of tools discovery — #1326 (2026-10-03)

The registry management reader requires `campaigns.updated_at` as an optimistic concurrency token. A legacy schema without it breaks both management and the navigation projection even when direct processing/transcript routes work. `20261003011729_restore_campaign_registry_revision` adds the database-owned token without changing campaign identity or authorization. Before publication, replay the registry/authorization scratch suites; after application, confirm the exact management SELECT, authorized launcher destinations and stale edit rejection. Preserve additive schema on application rollback.

Successful campaign create/update/lifecycle actions invalidate the root layout because the global launcher also projects registry names and destinations. Refreshing only the directory leaves the persistent navigation stale after a rename. No additional poller or service is introduced.
