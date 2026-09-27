# Publicação editorial versionada de sessões

> Status: implementação integrada com rollout governado por migration/CD
> Owner: sessions / Edit / dados
> Última revisão: 2026-09-27
> Backlog: #793, parent #787

Esta feature separa de forma explícita **transcrição privada**, **draft editorial privado** e **snapshot público da sessão**.

```text
transcript revision cloud
        PRIVATE
          ↓
session editorial draft
        PRIVATE
          ↓ confirmação humana explícita
session editorial publication
        PUBLIC
```

## Conteúdo público

Somente cinco campos editoriais são promovidos:

1. capa;
2. arco;
3. título;
4. descrição curta;
5. resumo completo em Markdown.

A transcrição completa, segmentos, speakers, runtime/ASR, warnings e provenance técnica não entram no read model público nem no receipt.

## Lifecycle

`session_editorial_publications` é append-only do ponto de vista da aplicação. Cada publicação preserva:

- versão monotônica por sessão;
- draft exato de origem;
- transcript revision privado usado como base;
- referência da capa promovida;
- cinco campos editoriais;
- SHA-256 canônico do payload publicado;
- actor e timestamp.

`sessions.current_session_publication_id` aponta para a versão pública atual. Os campos públicos já consumidos por `/sessoes` continuam denormalizados em `sessions` e são trocados na mesma transação do pointer.

Replace cria um novo snapshot. Restore aponta para um snapshot histórico e reaplica exatamente seu conteúdo. Unpublish limpa o pointer e muda o lifecycle para `approved`, sem apagar histórico.

## Optimistic concurrency

A confirmação congela `expectedCurrentPublicationId`.

O commit:

1. bloqueia a session;
2. revalida campaign, actor e `campaign.transcript.publish`;
3. exige que o draft confirmado continue sendo `current_editorial_draft_id`;
4. exige que o transcript base do draft continue sendo a current transcript revision;
5. compara o current publication pointer com o expected;
6. somente então insere snapshot, atualiza `sessions`, grava receipt e audit.

Conflito não faz retry silencioso e não cria evidência parcial.

## Idempotência e resposta ambígua

Cada tentativa possui `operation_id` durável.

- mesma operação + mesmo payload → replay do receipt;
- mesma operação + payload diferente → `operation_conflict`;
- resposta perdida após commit → servidor relê o receipt da mesma operação;
- o cliente conserva o mesmo operation ID somente para retry de resposta inconclusiva.

Receipts e audit armazenam IDs, hashes e metadata operacional. Texto editorial completo e transcript não são copiados para audit/receipt.

## Capa

A publicação aceita:

- asset privado governado de #792; ou
- referência pública legada já allowlisted.

Para asset novo:

```text
R2 private staged
  -> read-back/hash/decode já verificados
  -> PUT imutável no bucket público
  -> GET público + MIME/tamanho/SHA-256
  -> media_assets = verified_public
  -> commit SQL da publicação
```

Falha de promoção/read-back ocorre antes do commit da session. Assim a versão pública anterior permanece autoritativa. Um objeto público content-addressed pode existir sem pointer caso o DB falhe; isso é órfão recuperável, não publicação parcial.

## Authorization

O boundary server-side exige `campaign.transcript.publish`. `campaign.content.edit`, leitura de transcript ou login isolado não autorizam publicação.

As tabelas de snapshot/receipt têm RLS habilitado e nenhuma authority de browser. As RPCs são `SECURITY INVOKER`, revogadas de `PUBLIC`, `anon` e `authenticated`, e executáveis somente por `service_role`. A função revalida actor/profile/capability/scope internamente.

## UI

O draft continua com `Salvar draft` separado de `Publicar no site`.

A confirmação mostra:

- capa pronta;
- arco;
- título;
- contagem da descrição;
- contagem do resumo Markdown;
- versão pública observada;
- draft salvo;
- transcript base;
- aviso explícito de que a transcrição completa continuará privada.

Não existe atalho de teclado para publish.

## Cache e read model público

Após commit a aplicação revalida:

- `/`;
- `/sessoes`;
- `/sessoes/[source_session_id]`.

O repository público continua lendo somente `sessions.status='published'` e os campos públicos existentes. Não há join público com transcript ou draft.

## Testes obrigatórios

O gate sintético PostgreSQL cobre:

- primeiro publish;
- replay idempotente;
- operation conflict;
- stale expected-current sem evidência;
- replace preservando histórico;
- restore;
- unpublish;
- rollback completo quando receipt falha;
- revogação de capability;
- ausência do marker privado de transcript em snapshot/receipt/audit;
- grants fail-closed para browser roles.

Testes TypeScript cobrem identidade de request/receipt e canonicalização da URL pública da capa. Production CD continua responsável por aplicar a migration e provar o read-back do deployment canônico.

## Não objetivos

- publicar transcript ou áudio;
- gerar resumo com IA;
- transformar save em publish;
- expor snapshots/receipts diretamente ao browser;
- apagar versões antigas durante replace/restore/unpublish.
