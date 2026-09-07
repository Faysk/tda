# Edit — slice server-side de transcrição

> Status: leitura autorizada implementada com revision; mutation canônica preparada; persistence atômica pendente; bypass temporário de UI separado
> Owner: Edit / aplicação + dados
> Última revisão: 2026-09-07

## Objetivo

Entregar a primeira fronteira server-side do Edit para transcrição sem expor o banco como CRUD e sem permitir que a arquitetura definitiva normalize write concorrente sem proteção transacional adequada.

Este slice implementa a leitura autorizada e define o contrato da mutation canônica. A persistência **canônica** de escrita permanece bloqueada até existir o boundary atômico que aplique optimistic concurrency e auditoria old/new na mesma transação.

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
- desde a PR #34, o payload autorizado inclui `revision` validada como inteiro seguro não negativo, permitindo que o caller envie um `expectedRevision` real à mutation canônica futura.

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

Não existe ainda adaptador de persistence **canônico** para essa mutation.

## Estado físico atual

A PR #33 aplicou e versionou `20260907084234_add_transcript_segment_revision`, adicionando `public.transcript_segments.revision bigint not null default 0`. A validação pós-migration preservou 30.857 segmentos, sem revision nula e com intervalo inicial `0..0`.

A PR #34 passou a selecionar e expor essa revision no boundary de leitura autorizado. Assim, as duas pré-condições abaixo já estão concluídas:

1. suporte físico mínimo de optimistic concurrency no segmento;
2. leitura autorizada da revision real pelo código canônico.

O bloqueio restante é a segunda metade da issue #32: update condicionado por `revision = expectedRevision`, incremento monotônico e gravação em `audit_log` dentro do mesmo transaction boundary, com grants/RPC revisados quando aplicável.

Antes de habilitar a mutation canônica ainda é obrigatório:

1. implementar o boundary SQL/RPC ou equivalente transacional estreito;
2. resolver segmento + sessão + campaign sem vazar outra campaign;
3. diferenciar `not_found` de `conflict` conforme o contrato aprovado;
4. incrementar `revision` exatamente uma vez por update bem-sucedido;
5. gravar old/new em `audit_log` na mesma transação e zero eventos em conflito;
6. revisar `SECURITY INVOKER`/`search_path`/grants caso uma função SQL seja usada;
7. validar duas escritas concorrentes com a mesma revision;
8. ligar Server Action/Route Handler autenticado à mutation canônica;
9. remover o adapter unsafe apenas em etapa própria após a troca final.

## Exceção temporária para construir a UI

Por decisão explícita de produto, a UX do Edit não ficará parada aguardando os itens acima.

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

Cobertura existente/esperada:

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
- conflito de revision é um resultado explícito do boundary;
- duas escritas com o mesmo `expectedRevision` resultam em exatamente um `updated` e um `conflict` quando a persistence canônica for implementada.

## Próxima etapa

Duas linhas podem avançar em paralelo:

1. **produto/UX:** validar o workbench real pelo bypass temporário, recuperar paridade e ajustar fluxo;
2. **segurança/dados:** concluir a issue #32 com persistence atômica revision + audit.

Quando a segunda estiver pronta, a primeira troca apenas o adapter de acesso/write e remove `TDA_EDIT_UNSAFE` em etapa própria.
