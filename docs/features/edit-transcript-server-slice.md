# Edit — slice server-side de transcrição

> Status: implementação inicial em PR
> Owner: Edit / aplicação + dados
> Última revisão: 2026-09-07

## Objetivo

Entregar a primeira fronteira server-side do Edit para transcrição sem expor o banco como CRUD e sem permitir write concorrente sem proteção física adequada.

Este slice implementa a leitura autorizada e define o contrato da mutation. A persistência de escrita permanece deliberadamente bloqueada até o schema possuir revision/version apropriada e a política de auditoria transacional estar definida.

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

A conexão do Edit é server-only e exige `TDA_READ_EDIT_DATA=true`; o segredo Supabase continua fora do browser.

## Mutation boundary

O contrato de aplicação exige:

- auth/profile resolvido;
- `campaign.content.edit` no scope correto;
- segment UUID e campaign válidos;
- `expectedRevision` inteiro não negativo;
- texto, speaker e review status validados pelo domínio;
- `needs_review`, `text_chars` e `text_words` calculados no servidor;
- persistence deve devolver explicitamente `updated`, `conflict`, `not_found` ou `dependency_unavailable`.

Não existe adaptador de persistence de mutation neste slice.

## Bloqueio físico atual

A inspeção do schema real em 2026-09-07 confirmou que `public.transcript_segments` não possui coluna de revision/version para edição. Implementar update agora criaria risco de lost update entre clientes diferentes.

Antes de habilitar writes:

1. desenhar mudança mínima de schema para optimistic concurrency;
2. mapear compatibilidade com consumidores legados;
3. definir auditoria old/new dentro de uma unidade transacional confiável;
4. versionar migration;
5. revisar grants/RLS/RPC se aplicável;
6. aplicar de forma controlada conforme o database runbook;
7. validar conflito real com duas revisions concorrentes;
8. somente então ligar Server Action/Route Handler e UI de autosave.

## Testes deste slice

Cobertura esperada:

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

A próxima etapa recomendada é a migration de concorrência + auditoria mínima de transcript, sem adicionar UI ainda. O objetivo é tornar o adaptador de mutation seguro antes de qualquer autosave ser conectado ao browser.
