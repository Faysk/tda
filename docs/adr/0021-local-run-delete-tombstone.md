# ADR-0021 — Exclusão local confirmada usa tombstone e cleanup, não lixeira restaurável

> Status: accepted
> Data: 2026-10-05
> Owner: Edit / processing / transcripts
> Última revisão: 2026-10-05
> Decisores: proprietário / maintainers TDA
> Supersede: ADR-0016 §10 (somente semântica de exclusão local)
> Superseded por: —

## Contexto

ADR-0016 aprovou originalmente uma lixeira local simples, com retenção padrão de 7 dias. A implementação que amadureceu depois seguiu outro contrato: a UI oferece **Excluir resultado local**, o Companion grava um tombstone/receipt durável antes de remover os bytes e usa uma quarantine transacional apenas para tornar cleanup/recovery seguro.

A quarantine interna `.delete-trash/<operation_id>` não é uma lixeira de produto: ela não possui listagem, retenção de 7 dias nem ação **Restaurar** para o usuário. Manter a promessa antiga na documentação cria uma expectativa falsa de undo para uma operação destrutiva.

Publicação cloud é um lifecycle separado. Excluir um run local não remove automaticamente published revisions e não deve ser confundido com **Remover publicação**.

## Drivers

- alinhar documentação, UI e backend com a semântica realmente implementada;
- não prometer recuperação que o produto não oferece;
- preservar crash safety e idempotência do delete;
- manter publicação cloud independente da limpeza local;
- exigir confirmação proporcional antes de destruição irreversível para o usuário;
- não transformar quarantine transacional em storage de retenção sem contrato próprio.

## Opções consideradas

### A. Implementar a lixeira de 7 dias aprovada em ADR-0016

Exigiria índice/listagem, retenção/expiry, restore, restart recovery, dependency checks e UX própria.

**Vantagem:** undo amigável.

**Custo:** cria um lifecycle adicional que não existe no produto atual e não é necessário para alinhar a documentação nesta rodada.

### B. Formalizar o delete local atual

O usuário confirma uma ação destrutiva; o Companion grava tombstone autoritativo, faz cleanup crash-safe e nunca apresenta a quarantine como item restaurável.

**Vantagem:** corresponde ao produto atual e mantém guarantees já testadas.

**Custo:** depois da confirmação não existe undo local oferecido pelo TDA.

## Decisão

Adotar **Opção B**.

Para runs locais concluídos:

1. a UI deve chamar a operação de exclusão local de forma explícita e pedir confirmação clara;
2. antes do cleanup físico, o Companion grava `tda_local_run_delete_receipt_v1`;
3. o tombstone é autoritativo para visibilidade do run;
4. run/review podem passar por `.delete-trash/<operation_id>` somente como quarantine transacional;
5. startup/recovery pode concluir cleanup interrompido a partir do tombstone validado;
6. a quarantine não possui retenção contratual e não oferece restore;
7. nenhum texto de produto ou documentação pode prometer **Trash por 7 dias** ou **Restaurar** para esse delete;
8. source, outros runs e conteúdo cloud permanecem fora do alcance salvo ação separada e explícita;
9. publish/unpublish/delete cloud continuam operações independentes;
10. uma futura lixeira restaurável exige nova decisão que substitua este ADR e contratos/testes próprios.

## Consequências

### Positivas

- UI, backend e documentação passam a descrever a mesma operação;
- crash durante cleanup não ressuscita silenciosamente um run tombstoned;
- quarantine interna continua pequena e puramente operacional;
- não há falsa sensação de segurança por um restore inexistente.

### Negativas / trade-offs

- exclusão confirmada não tem undo local de produto;
- proteção contra erro humano depende de copy/confirmation antes do commit;
- archive continua sendo uma capacidade separada quando/onde implementada.

## Compatibilidade e histórico

ADR-0016 permanece vigente para runs imutáveis, revisão derivada, publicação versionada, restore de **published revisions**, unpublish e demais decisões. Somente sua seção **Lixeira local simples** é substituída por este ADR.

Referências históricas a Trash de 7 dias podem permanecer em notas de implementação se forem rotuladas como decisão anterior/superseded, nunca como comportamento corrente.

## Validação

O contrato está respeitado quando:

- a UI expõe **Excluir resultado local** com confirmação explícita;
- o tombstone é persistido antes do cleanup destrutivo;
- restart após interrupção conclui cleanup sem reapresentar o run;
- `.delete-trash` não é apresentada como lixeira restaurável;
- nenhuma documentação corrente promete retenção de 7 dias;
- publicação cloud não é alterada por delete local;
- dependências que tornam o delete inseguro continuam bloqueando a operação.

## Referências

- ADR-0016;
- `docs/features/transcript-review-publication.md`;
- `local-companion/tda_companion/transcription_runs.py`;
- `src/features/edit/processing/local-review.tsx`;
- #1538.
