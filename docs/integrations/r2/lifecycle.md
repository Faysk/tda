# R2 — lifecycle e estados

> Status: vigente
> Owner: integrations/media
> Última revisão: 2026-09-11

## Fluxo

Fonte/original -> classificar identidade, audience e role -> validar bytes/MIME/hash/dimensões -> escolher placement/key -> preservar provenance -> upload aditivo -> read-back autenticado -> se público, GET HTTPS anônimo e decode/hash -> promover evidência runtime -> promover referência de domínio quando necessário -> validar consumidores -> observar -> manter rollback -> retirar fisicamente só em operação separada.

## Estados

**Integridade:** `local-verified`, `not-uploaded`, `r2-readback-verified`, `collision` ou `failed`.

**Entrega pública:** `not-verified`, `verified-public` ou `unavailable`.

**Consumo:** `not-referenced`, `runtime-eligible`, `active-reference` ou `retired`.

Um objeto pode estar `verified-public` e ainda não ser referência ativa. Evidência `verified-public` prova o instante registrado; operação crítica que dependa de disponibilidade atual deve fazer nova verificação e registrar a data.

## Retenção e GC

Substituição cria nova key/hash e preserva a versão anterior para rollback. Retcon retira primeiro a referência do produto; delete físico é posterior.

Delete só é elegível quando o objeto não é referência/fallback ativo, não é necessário para rollback/auditoria, não é master com retenção requerida, não está em homologação ativa e houve autorização explícita. Não existe TTL universal aprovado; não inventar nem automatizar GC antes dessa decisão.
