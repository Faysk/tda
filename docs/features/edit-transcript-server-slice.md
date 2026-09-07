# Edit — slice server-side de transcrição

> Status: leitura autorizada implementada; mutation canônica preparada; bypass temporário de UI separado
> Owner: Edit / aplicação + dados
> Última revisão: 2026-09-07

## Objetivo

Entregar a primeira fronteira server-side do Edit para transcrição sem expor o banco como CRUD e sem permitir que a arquitetura definitiva normalize write concorrente sem proteção física adequada.

Este slice implementa a leitura autorizada e define o contrato da mutation canônica. A persistência **canônica** de escrita permanece bloqueada até o schema possuir revision/version apropriada e a política de auditoria transacional estar definida.

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
- payload seleciona apenas campos necessários ao trabalho editorial e lineage útil.

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

## Bloqueio físico atual

A inspeção do schema real em 2026-09-07 confirmou que `public.transcript_segments` não possui coluna de revision/version para edição. Habilitar o caminho canônico sem isso permitiria lost update entre clientes diferentes e quebraria o contrato de concorrência aprovado.

Antes de habilitar a mutation canônica:

1. desenhar mudança mínima de schema para optimistic concurrency;
2. mapear compatibilidade com consumidores legados;
3. definir auditoria old/new dentro de uma unidade transacional confiável;
4. versionar migration;
5. revisar grants/RLS/RPC se aplicável;
6. aplicar de forma controlada conforme o database runbook;
7. validar conflito real com duas revisions concorrentes;
8. ligar Server Action/Route Handler autenticado à mutation canônica.

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

A dívida fica concentrada em `src/features/edit/transcript/unsafe-mutation.ts` e deve ser removida, não promovida, quando o caminho canônico estiver pronto.

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
- recurso cross-campaign tratado como não encontrado;
- mutation prepara invariantes server-side;
- conflito de revision é um resultado explícito do boundary.

## Próxima etapa

Duas linhas podem avançar em paralelo:

1. **produto/UX:** validar o workbench real pelo bypass temporário, recuperar paridade e ajustar fluxo;
2. **segurança/dados:** implementar revision + auditoria + persistence canônica.

Quando a segunda estiver pronta, a primeira troca apenas o adapter de acesso/write e remove `TDA_EDIT_UNSAFE`.
