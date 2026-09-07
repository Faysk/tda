# Edit — slice server-side de transcrição

> Status: leitura autorizada implementada com revision; persistence atômica candidata preparada e ainda não aplicada; bypass temporário de UI separado
> Owner: Edit / aplicação + dados
> Última revisão: 2026-09-07

## Objetivo

Entregar a primeira fronteira server-side do Edit para transcrição sem expor o banco como CRUD e sem aceitar lost update ou auditoria parcial.

A leitura autorizada e o contrato da mutation canônica já existem. A PR #33 aplicou a coluna física de concorrência otimista e a PR #34 passou a entregar `revision` no boundary autorizado. Este slice prepara a menor persistence SQL necessária para `update + revision + audit` na mesma transação; ela permanece desligada até ser validada em banco isolado, aplicada pelo fluxo operacional aprovado e integrada pelo Edit/Auth.

Durante a construção da UI existe uma exceção deliberada e isolada em [modo temporário sem autenticação](edit-unsafe-development.md). Ela não altera os contratos descritos abaixo.

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

## Teste transacional preparado

`supabase/tests/edit_transcript_segment_atomic.sql` usa apenas campaigns/sessões/perfis/segmentos sintéticos e termina em `ROLLBACK`.

Ele exige execução **somente em banco local/isolado** e cobre:

1. grants: `anon/authenticated` sem `EXECUTE`, `service_role` com `EXECUTE`;
2. duas escritas com `expectedRevision=0`: a primeira retorna `updated/revision=1`, a segunda `conflict`;
3. exatamente um evento de audit para o par `updated + conflict`;
4. campaign cruzada retorna `not_found` e não cria audit;
5. speaker inalterado preserva `character_name` no segmento e no audit;
6. falha artificial no insert de `audit_log` desfaz o update/revision e deixa zero audit para a tentativa.

Este teste não deve ser executado contra transcrições ou dados reais de produção.

## Estado de aplicação

A migration `20260907115300_edit_transcript_segment_atomic` **não foi aplicada ao Supabase de produção nesta preparação**.

Motivo operacional: nesta conversa está disponível apenas execução SQL direta; o contrato da ferramenta determina usar o fluxo de migration para DDL, e não há aqui CLI/banco isolado nem ação `apply_migration` exposta. Portanto o SQL e o teste ficam prontos para o coordenador executar primeiro em ambiente isolado e depois, se aprovados, aplicar conforme o database runbook.

Antes da aplicação produtiva:

1. aplicar a migration candidata em banco local/isolado;
2. executar `supabase/tests/edit_transcript_segment_atomic.sql` e exigir sucesso completo;
3. revisar SQL/grants resultantes;
4. confirmar rollback lógico: desligar o adapter canônico e manter a função inerte/removível se ainda sem consumidores;
5. aplicar migration no projeto canônico pelo fluxo oficial;
6. validar função, grants e migration history remotamente;
7. executar advisors de segurança/performance;
8. registrar a aplicação em `docs/database/verification-log.md`;
9. integrar repository/adapter do Edit à mutation canônica;
10. rodar CI/testes do SHA exato antes de qualquer integração.

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

Depois que o coordenador validar/aplicar o SQL transacional, Auth/Edit devem:

1. implementar o `persist` da mutation canônica chamando o boundary server-only;
2. manter `actorProfileId` vindo exclusivamente do contexto autorizado;
3. validar conflito real ponta a ponta com a revision já entregue pela leitura;
4. trocar a UI para a mutation canônica;
5. remover `TDA_EDIT_UNSAFE` e `unsafe-mutation.ts` em recorte próprio, sem misturar essa remoção com a migration de banco.
