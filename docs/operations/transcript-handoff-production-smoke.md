# Transcript handoff — smoke editorial de Production

> Status: vigente
> Owner: transcripts / processing / operations
> Última revisão: 2026-09-28
> Issue de aceite: [#430](https://github.com/Faysk/tda/issues/430)

Este runbook executa o primeiro aceite real do handoff privado de uma revisão local aprovada para Sessões do Edit. Ele usa o mesmo boundary do produto, uma identidade autenticada real, o Companion local e um review real já existente. Nenhum usuário, sessão, run, review ou transcript é fabricado para o teste.

O objetivo é provar em uma única execução:

- commit do handoff privado;
- receipt/readback da mesma operation;
- replay idempotente sem nova revision;
- CAS negativo `stale_current`;
- restore ou unpublish do current anterior;
- replay idempotente dessa mudança;
- restauração final da revision recém-aceita;
- evidence output somente metadata-only.

## Pré-condições

- Production saudável em `https://dnd.faysk.dev`;
- `TDA_TRANSCRIPT_PUBLICATION_ENABLED=true`;
- migration de current-pointer CAS já aplicada;
- Companion compatível rodando na máquina do operador;
- login normal no TDA com `campaign.transcript.publish`;
- run local real com `publication-target` válido;
- review real salvo e explicitamente `approved_local`;
- nenhum handoff unresolved desse mesmo review deve ser abandonado só para iniciar o smoke.

O teste não lê transcript pelo banco e não imprime texto, speakers, payload JSON, cookies ou tokens.

## Storage state autenticado

O Playwright precisa de um `storageState` criado localmente a partir de um login normal no TDA. Esse arquivo contém credenciais de sessão e:

- nunca entra no Git;
- nunca é anexado em issue/artifact;
- nunca deve ser enviado ao chat;
- deve ficar em diretório local ignorado.

Se a sessão estiver expirada, faça login normalmente e exporte um storage state novo.

## Identidade do run

Na aba **Resultados** do Processamento, abra **Integridade e IDs** e copie somente:

- `sourceId` no formato `craig-<sha256>`;
- `runId`.

Não copie transcript, draft ou arquivos do data root.

## Executar

```bash
pnpm smoke:transcript-handoff:production -- \
  --storage-state <caminho-local>/tda-production-storage-state.json \
  --source-id <craig-source-id> \
  --run-id <run-id> \
  --confirm-production
```

Use `--headed` somente quando quiser acompanhar visualmente.

O comando é fixado em `https://dnd.faysk.dev`. Ele falha antes do handoff se:

- a sessão Web não estiver autenticada;
- o Companion não expuser o Results esperado;
- source/run não forem únicos;
- o review não estiver `approved_local`;
- **Preparar sessão** estiver indisponível;
- o produto negar capability/target/preflight.

## Sequência executada

1. abre `/edit/processamento` com a sessão real;
2. seleciona o run exato por `sourceId + runId`;
3. abre o review real e exige `approved_local`;
4. usa **Preparar sessão** + confirmação normal do produto;
5. captura em memória somente para replay o request original; ele nunca é impresso ou persistido;
6. valida o receipt retornado;
7. reapresenta byte-identicamente a mesma operation e exige o mesmo receipt/revision;
8. lê o current autorizado metadata-only;
9. envia uma mudança de current com expectativa deliberadamente stale e exige `409 stale_current`;
10. volta temporariamente ao current que existia antes do handoff:
    - se era `null`, isso exerce **unpublish**;
    - se havia uma revision anterior, isso exerce **restore**;
11. repete a mesma operation e exige o mesmo event;
12. restaura a revision recém-criada pelo handoff;
13. repete essa restore e exige o mesmo event;
14. confirma que o current final voltou à revision recém-aceita.

O teste deixa Production no estado editorial desejado: a revision criada pelo handoff permanece current.

## Boundary de restore/unpublish

O smoke usa `POST /api/transcript-publications/current/set`.

Esse endpoint:

- exige same-origin;
- exige identidade Web verificada;
- autoriza `campaign.transcript.publish` antes de resolver o target;
- exige campaign/session real já vinculada;
- exige `expectedActorProfileId` lido do current autorizado;
- usa exclusivamente o RPC server-only `set_current_transcript_revision_atomic`;
- preserva expected-current CAS;
- valida o event retornado contra campaign/session/operation/revision;
- não aceita transcript ou segmentos;
- não concede EXECUTE dos RPCs ao browser.

Ele não é um bypass de service-role: o browser continua chamando somente o boundary autenticado do produto.

## Receipt compartilhável

O stdout final contém apenas metadata operacional semelhante a:

```json
{
  "receiptId": "<uuid>",
  "revisionId": "<uuid>",
  "revisionNumber": 2,
  "previousRevisionId": "<uuid-ou-null>",
  "publishReplayVerified": true,
  "staleCurrentNegativeVerified": true,
  "rollbackAction": "restore",
  "rollbackEventId": "<uuid>",
  "rollbackReplayVerified": true,
  "restoreEventId": "<uuid>",
  "restoreReplayVerified": true,
  "finalCurrentRevisionId": "<uuid>",
  "finalStateRestored": true
}
```

Esse receipt pode ser registrado em #430. Não anexar storage state, network dump ou request body.

## Read-back final no banco

Depois do harness, a verificação operacional deve consultar somente metadata não sensível:

- receipt existe para a mesma `operation_id`;
- revision existe e é o current final da sessão;
- replay não criou segunda revision;
- evento stale não foi criado;
- rollback + restore produziram apenas os events esperados;
- nenhum transcript/segments é copiado para a issue.

A quantidade total de rows pode mudar por outros fluxos privados; usar IDs do receipt, não inferir sucesso apenas por contagem global.

## Falha e recuperação

### Antes do primeiro receipt

Nenhuma conclusão deve ser presumida. Reabrir o mesmo review deixa o recovery normal do produto consultar a operation pendente.

### Depois do handoff, antes do rollback

A nova revision já pode ser current. Não criar uma operation nova por adivinhação; conferir current/receipt.

### Depois do rollback e antes da restauração final

O harness imprime um warning em falhas capturáveis. O current pode estar temporariamente na revision anterior ou `null`. Reexecutar somente depois de conferir metadata canônica; a próxima execução deve respeitar o CAS real observado.

Crash abrupto do processo não pode ser transformado em suposição de rollback. Receipt/event/current são as autoridades.

## Fechamento de #430

#430 pode fechar quando o receipt do harness e o read-back metadata-only confirmarem:

- handoff humano/autenticado real;
- replay do mesmo publish;
- negativo `stale_current`;
- restore/unpublish;
- replay da current mutation;
- current final correto;
- nenhuma evidência compartilhada contendo transcript/segredo.
