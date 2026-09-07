# Edit — modo temporário sem autenticação

> Status: compatibilidade temporária de desenvolvimento
> Owner: Edit / aplicação + segurança
> Última revisão: 2026-09-07

## Decisão

Durante a construção inicial do Edit, o proprietário autorizou explicitamente usar a área administrativa antes da conclusão de Auth/profile/capabilities para acelerar validação de UX e paridade funcional.

Isso **não substitui** a arquitetura definitiva. É um bypass concentrado, visível e removível.

## Ativação

```text
TDA_EDIT_UNSAFE=true
```

O default versionado é `false`.

Quando a flag está ativa, qualquer visitante que alcance `/edit` naquele ambiente deve ser tratado como possuidor do poder administrativo exposto. A flag não identifica usuário e não é autorização real.

## Boundary temporário

```text
browser
  -> /edit
  -> Server Component / Server Action
  -> requireUnsafeEdit()
  -> server-side editDataClient()
  -> query/mutation escopada
  -> Supabase
```

Mesmo no bypass:

- `SUPABASE_SECRET_KEY` permanece server-only;
- browser não recebe client privilegiado;
- a campaign é verificada antes do write;
- segmento é atualizado por `session_id + segment UUID`;
- texto/speaker/status passam pelo domínio `prepareTranscriptEdit`;
- `text_chars`, `text_words` e `needs_review` são derivados no servidor;
- a UI exibe banner explícito de modo sem autenticação.

## Relação com o server slice canônico

O boundary canônico existente em `query.ts`/`mutation.ts` continua intacto:

- Auth;
- profile;
- capability + scope;
- `expectedRevision`;
- resultado explícito de conflito.

O bypass **não relaxa esse contrato**. Para permitir uso imediato sem esperar migration de revision/audit, o write temporário vive isolado em:

```text
src/features/edit/transcript/unsafe-mutation.ts
```

Quando revision + auditoria + Auth estiverem prontos, a UI deve trocar sua Server Action para a mutation canônica e apagar o adapter unsafe.

## Primeiro workbench funcional

Rotas:

```text
/edit
/edit/sessoes/[sourceSessionId]
```

Capacidades atuais:

- listar sessões reais de `yuhara-main`;
- resolver `source_session_id` para UUID canônico;
- ler transcript pela repository canônica com cursor `(start_ms, id)`;
- lotes de 120 segmentos;
- filtro local do lote por speaker/texto;
- editar speaker;
- editar texto;
- alterar `pending | approved | needs_review | discarded`;
- salvar por botão ou `Ctrl/Cmd + Enter`;
- feedback `alterado | salvando | salvo | erro`;
- write real no Supabase quando a flag estiver ativa.

## Riscos aceitos nesta fase

- não há identidade do ator no bypass;
- não há capability por usuário;
- não há optimistic concurrency física no adapter unsafe;
- dois editores simultâneos podem produzir lost update;
- mudança não possui ainda audit old/new atribuível a um profile.

Esses riscos são aceitos **somente como dívida transitória para acelerar construção e teste funcional**. Eles não devem migrar silenciosamente para o caminho autenticado final.

## Critério de remoção

Remover o bypass quando:

1. Auth resolve usuário e profile;
2. `campaign.transcript.read` e `campaign.content.edit` funcionam no servidor;
3. revision/version física protege mutation concorrente;
4. audit old/new registra ator de forma confiável;
5. a UI usa a mutation canônica;
6. smoke/testes positivos e negativos cobrem cross-campaign e capability.

Na remoção, apagar `TDA_EDIT_UNSAFE`, `unsafe-access.ts`, `unsafe-mutation.ts` e o banner da interface. O histórico da decisão permanece no Git.
