# Edit — slice server-side de transcrição

> Status: leitura contínua e correção privada por revisions imutáveis implementadas; boundary legado por segmento preservado para compatibilidade
> Owner: Edit / aplicação + dados
> Última revisão: 2026-09-28

## Objetivo

Entregar a primeira fronteira server-side do Edit para transcrição sem expor o banco como CRUD e sem aceitar lost update ou auditoria parcial.

A leitura autorizada e o contrato da mutation canônica já existem. A PR #33 aplicou a coluna física de concorrência otimista e a PR #34 passou a entregar `revision` no boundary autorizado. Este slice prepara a menor persistence SQL necessária para `update + revision + audit` na mesma transação. A candidata foi validada em PostgreSQL isolado no SHA exato `f44a74c653d416a614bb3468ffc112d741bc4893`, mas permanece desligada até aplicação produtiva controlada e integração pelo Edit/Auth.

Durante a construção da UI existe uma exceção deliberada e isolada em [modo temporário sem autenticação](edit-unsafe-development.md). Ela não altera os contratos descritos abaixo.

## Limite do conceito `revision`

A `revision` descrita neste documento é **exclusivamente a versão concorrente de uma linha de `transcript_segments`**. Ela existe para optimistic concurrency e evita lost update de um segmento.

ADR-0016 e [Transcrição — runs locais, revisão, comparação e publicação versionada](transcript-review-publication.md) introduzem um conceito diferente: **published revision da transcrição completa da sessão**.

Não reutilizar o mesmo campo/número para os dois significados:

```text
transcript_segments.revision
  = concorrência de edição da linha

published transcript revision
  = versão editorial completa da sessão
```

O slice futuro de publicação deve compor esses contratos sem reescrever a evidência histórica desta página.

## Leitura autorizada

Fluxo implementado:

```text
auth user verificado pelo caller
  -> profile por auth_user_id
  -> role assignments ativos
  -> role permissions
  -> campaign.transcript.read no scope correto
  -> sessão filtrada pela campaign
  -> página estreita de transcript_segments
```

Regras:

- ausência de auth é `unauthenticated`;
- auth sem profile resolvido é `profile_unresolved`;
- capability ausente ou no scope errado é `forbidden`;
- sessão fora da campaign autorizada não tem existência revelada e resulta em `not_found`;
- `project/tda` pode cobrir campaigns do projeto;
- grants inativos, futuros ou expirados não autorizam;
- leitura de transcript não concede edição;
- consulta usa paginação por cursor `(start_ms, id)` e limite máximo de 200 segmentos;
- payload seleciona apenas campos necessários ao trabalho editorial e lineage útil;
- desde a PR #34, o payload autorizado inclui `revision` validada como inteiro seguro não negativo, permitindo enviar `expectedRevision` real à mutation canônica.

A conexão do Edit é server-only. O caminho autenticado pode habilitar leitura com `TDA_READ_EDIT_DATA=true`; durante o bypass transitório, `TDA_EDIT_UNSAFE=true` também habilita o mesmo client server-side sem exportá-lo ao browser.

## Mutation boundary canônico

O contrato de aplicação exige:

- auth/profile resolvido;
- `campaign.content.edit` no scope correto;
- segment UUID e campaign válidos;
- `expectedRevision` inteiro não negativo;
- texto, speaker e review status validados pelo domínio;
- `needs_review`, `text_chars` e `text_words` calculados no servidor;
- persistence deve devolver explicitamente `updated`, `conflict`, `not_found` ou `dependency_unavailable`.

O `actorProfileId` entregue à persistence é derivado do contexto já autenticado/autorizado; o client não escolhe arbitrariamente o ator.

## Estado físico atual

A PR #33 aplicou e versionou `20260907084234_add_transcript_segment_revision`, adicionando `public.transcript_segments.revision bigint not null default 0`. A validação pós-migration preservou 30.857 segmentos, sem revision nula e com intervalo inicial `0..0`.

A PR #34 passou a selecionar e expor essa revision no boundary de leitura autorizado. Assim, as duas pré-condições abaixo já estão concluídas:

1. suporte físico mínimo de optimistic concurrency no segmento;
2. leitura autorizada da revision real pelo código canônico.

Revalidação read-only do Supabase `dmrqnbdvbkfqzctcerbx` nesta preparação confirmou também:

- migration head remoto: `20260907084234_add_transcript_segment_revision`;
- `audit_log` já possui `campaign_id`, `session_id`, `actor_id`, `action`, `table_name`, `record_id`, `old_value`, `new_value` e `created_at`;
- `audit_log.actor_id` referencia `profiles(id)`;
- `transcript_segments.session_id` referencia `sessions(id)`;
- `anon` e `authenticated` não possuem grants diretos observados sobre `transcript_segments`/`audit_log`;
- `service_role` possui os privilégios necessários para um boundary server-only.

Não é necessária outra coluna de revision nem uma segunda tabela de auditoria.

## Persistence SQL candidata

A migration candidata `20260907115300_edit_transcript_segment_atomic` cria `public.edit_transcript_segment_atomic(...)` com estas propriedades:

- `SECURITY INVOKER`;
- `search_path = pg_catalog, public`;
- `EXECUTE` revogado de `PUBLIC`, `anon` e `authenticated`;
- `EXECUTE` concedido apenas a `service_role`;
- actor recebido somente do boundary autorizado da aplicação;
- lookup físico `segment -> session -> campaign` e filtro pelo `campaignSlug` recebido;
- segmento de outra campaign retorna `not_found`, sem revelar sua existência;
- linha do segmento bloqueada com `FOR UPDATE`;
- `revision` precisa coincidir com `expectedRevision`;
- update bem-sucedido incrementa `revision` exatamente em 1;
- conflito não grava update nem audit;
- `character_name` é preservado quando o speaker textual não muda e é invalidado (`NULL`) quando há mudança real de speaker, mantendo a regra já usada no adapter temporário;
- `audit_log` recebe `old_value`/`new_value` somente do estado editorial afetado, incluindo a transição de revision;
- update e audit acontecem na mesma chamada/transação PostgreSQL; falha do insert de audit aborta também o update.

A função não reimplementa capability/RBAC: essa decisão permanece no boundary canônico de Auth/Edit antes da persistence. O SQL reduz a superfície por grants e revalida ownership físico do recurso.

### Action de auditoria

A action candidata é estável e específica:

```text
transcript_segment.update
```

`audit_log` estava vazio na revalidação, portanto não havia convenção histórica ativa a preservar para esse tipo de write.

## Validação transacional isolada — concluída

A candidata foi validada no SHA exato `f44a74c653d416a614bb3468ffc112d741bc4893` em PostgreSQL 16.14 real, dentro de cluster descartável novo em WSL Ubuntu 24.04, acessível apenas por socket Unix privado e sem TCP/conexão remota. Nenhum dado ou serviço de produção foi usado.

O schema de teste foi mínimo e sintético, com cinco tabelas necessárias, FKs/RLS/roles/grants declarados. Foram aplicadas a migration de `revision` e a migration candidata originais.

### Teste SQL versionado

`supabase/tests/edit_transcript_segment_atomic.sql` foi executado integralmente e passou, terminando em `ROLLBACK`.

Esse teste cobre semântica transacional em sequência, mas **não prova sozinho concorrência real entre conexões**. Ele confirmou:

- `anon` e `authenticated` sem `EXECUTE` e `service_role` com `EXECUTE`;
- primeira escrita `updated/revision=1` e segunda escrita sequencial na mesma revision como `conflict`;
- exatamente um evento de audit;
- campaign cruzada como `not_found` sem audit;
- speaker inalterado preservando identidade e troca de speaker limpando `character_name`;
- falha artificial do insert em `audit_log` desfazendo update/revision.

### Concorrência real em duas conexões

Um runner separado abriu duas conexões PostgreSQL independentes como `service_role` e repetiu o cenário três vezes sob `READ COMMITTED`:

1. ambas enviaram `expectedRevision=0` para o mesmo segmento;
2. conexão A segurou o lock;
3. conexão B foi observada em `Lock/transactionid`, com A aparecendo em `pg_blocking_pids(B)`;
4. após a liberação, A retornou `updated/1`;
5. B reavaliou o estado e retornou `conflict/NULL`;
6. revision final permaneceu `1`;
7. existiu exatamente um audit, com old revision `0` e new revision `1`.

Resultado: **PASS 3/3**, sem deadlock e sem segundo update/audit.

### Atomicidade e identidade

Também passaram:

- chamada direta como `anon`, `authenticated` e role sem acesso: negada;
- `SECURITY INVOKER` e `search_path` conferidos;
- cross-campaign: `not_found` sem audit;
- identidade preservada quando o speaker não muda e `character_name` limpo quando muda;
- falha de trigger no audit como `service_role`: linha inteira idêntica antes/depois;
- FK de ator inválido: falha do audit e linha inteira idêntica antes/depois.

Uma falha inicial do runner era apenas fixture incompleta — faltava um `SELECT` para a asserção do audit. A fixture foi corrigida fora da branch e o rerun completo terminou com exit 0; nenhum bug SQL foi encontrado e a migration/PR não foram alteradas durante a validação.

### Limites desta evidência

A validação isolada **não equivale a aplicação/aprovação de produção**. Ela não cobriu:

- dump/schema completo do Supabase;
- Auth/PostgREST real;
- advisors do projeto canônico;
- migration history remoto pós-aplicação;
- níveis de isolamento além de `READ COMMITTED`.

Esses itens permanecem como validação operacional da aplicação produtiva, não como motivo para criar outro RPC/migration concorrente.

## Estado de aplicação

A migration `20260907115300_edit_transcript_segment_atomic` **não foi aplicada ao Supabase de produção**.

A validação SQL isolada está concluída sem bug reproduzido. O próximo gate de banco é a aplicação controlada pelo database runbook no projeto canônico, seguida de verificação remota; até esse gate ser autorizado/executado, a função candidata permanece apenas na branch/PR.

Antes da aplicação produtiva ainda é obrigatório:

1. reconciliar a branch com a `main` vigente se necessário e exigir CI terminal do SHA exato que será integrado/aplicado;
2. seguir o database runbook e aplicar a migration pelo fluxo oficial no projeto `dmrqnbdvbkfqzctcerbx`;
3. validar função, grants e migration history remotamente;
4. executar advisors de segurança/performance;
5. registrar a aplicação em `docs/database/verification-log.md`;
6. integrar repository/adapter do Edit à mutation canônica em recorte próprio;
7. remover o caminho unsafe somente depois da troca canônica estar validada.

## Exceção temporária para construir a UI

Por decisão explícita de produto, a UX do Edit não ficou parada aguardando os itens acima.

Quando `TDA_EDIT_UNSAFE=true`:

```text
UI -> Server Action -> unsafe-mutation.ts -> Supabase
```

Esse adapter:

- continua server-only;
- valida campaign/sessão/segmento;
- usa `prepareTranscriptEdit`;
- mantém invariantes de texto/speaker/status;
- grava no banco real;
- **não promete concorrência nem auditoria por ator**.

A dívida fica concentrada em `src/features/edit/transcript/unsafe-mutation.ts` e deve ser removida, não promovida, quando o caminho canônico estiver pronto. O default versionado continua `TDA_EDIT_UNSAFE=false`.

## Testes do boundary canônico

Cobertura existente/esperada no conjunto Auth/Edit + DB:

- profile ausente;
- capability correta;
- capability cross-campaign;
- grant expirado/futuro/inativo;
- read não implica write;
- auth ausente;
- input inválido;
- leitura autorizada;
- revision retornada na leitura autorizada;
- recurso cross-campaign tratado como não encontrado;
- mutation prepara invariantes server-side;
- conflito de revision é resultado explícito;
- audit é atômico com o update;
- identidade estruturada não é apagada quando o speaker não muda.

## Próxima etapa

Depois da aplicação controlada e verificação remota do SQL transacional, Auth/Edit devem:

1. implementar o `persist` da mutation canônica chamando o boundary server-only;
2. manter `actorProfileId` vindo exclusivamente do contexto autorizado;
3. validar conflito real ponta a ponta com a revision já entregue pela leitura;
4. trocar a UI para a mutation canônica;
5. remover `TDA_EDIT_UNSAFE` e `unsafe-mutation.ts` em recorte próprio, sem misturar essa remoção com a migration de banco.


## Leitura editorial contínua da sessão (#790)

A workspace privada `/edit/sessoes/[id]` passa a tratar a **current transcript revision** como fonte autoritativa quando `sessions.current_transcript_revision_id` existe. A leitura resolve o ponteiro uma vez e busca exatamente aquela revision imutável; se o ponteiro estiver inválido ou a revision não puder ser validada, a UI falha fechada e **não** mistura nem faz fallback silencioso para `transcript_segments`.

Sessões históricas sem `current_transcript_revision_id` continuam legíveis por compatibilidade, mas a origem é apresentada explicitamente como `transcript_segments` legado. Esse fallback só existe quando nenhum handoff moderno foi ativado.

A experiência normal é read-first:

- timeline global ordenada por `start -> end -> track_number -> segment_id`;
- overlaps e empates permanecem como falas independentes;
- timestamp suporta sessões acima de uma hora e preserva milissegundos no contrato/export;
- a tela não expõe paginação por lote; o DOM cresce progressivamente conforme o scroll;
- busca por texto/speaker e jump por timestamp operam sobre o snapshot completo;
- edição de fala não é misturada ao estado normal desta workspace.

O download Markdown usa o mesmo boundary privado e a mesma capability `campaign.transcript.read`. Cada request captura uma única revision/snapshot e gera o arquivo somente a partir dela, com `Content-Type: text/markdown; charset=utf-8`, `Content-Disposition: attachment` e `Cache-Control: private, no-store`. Falhas de autorização por capability/scope são colapsadas para `not_found` onde necessário para evitar disclosure cross-campaign; conteúdo da transcript não vira asset público nem entra em rota pública.

A exportação preserva Unicode no corpo, sanitiza apenas o nome do arquivo e não inclui por padrão paths locais, hardware, tokens, operation ids ou lineage técnico irrelevante.


## Correção inline da current transcript revision (#898)

A workspace canônica `/edit/sessoes/[id]` continua **read-first**, mas editores com `campaign.content.edit` podem entrar explicitamente em modo de correção. Este fluxo não reutiliza a mutation legada de `transcript_segments`: uma sessão que já possui `current_transcript_revision_id` é editada como snapshot completo versionado.

Contrato do save:

```text
current revision R3 (imutável)
  -> browser envia somente deltas {trackNumber, segmentId, speaker, text}
  -> server reautoriza campaign.content.edit
  -> RPC bloqueia a sessão e exige expectedCurrent = R3
  -> timing/provenance são lidos de R3 no banco
  -> nova revision R4 (imutável, parent=R3)
  -> sessions.current_transcript_revision_id = R4 na mesma transação
  -> audit metadata-only
```

Consequências deliberadas:

- timestamp/start/end não são editáveis neste slice;
- run bruto, revisão pai e publicação pública nunca são mutados;
- duas abas não usam last-write-wins: a segunda recebe `stale_current` e mantém sua working copy;
- retry da mesma `operationId + delta` é idempotente e devolve a revision já criada;
- alteração sem diferença efetiva retorna `no_change` e não fabrica histórico;
- o draft editorial existente detecta automaticamente drift porque sua `base_transcript_revision_id` deixa de coincidir com o current pointer;
- a UI monta controles somente para a fala ativa; o restante da timeline continua texto normal, inclusive em sessões longas;
- busca opera sobre a working copy e save é explícito; não há autosave em blur;
- o download Markdown continua privado/no-store e resolve a current revision autoritativa no servidor.

Persistência versionada: `supabase/migrations/20260928023000_transcript_revision_web_edits.sql`. O contrato SQL sintético em `supabase/tests/transcript_revision_web_edits.sql` cobre autorização, imutabilidade, timing read-only, replay, stale current, no-op, rollback atômico e ausência de texto no audit. O contrato TypeScript cobre Unicode, limites e working deltas de 7.500 segmentos.
