# Feature — Busca semântica com fontes

> Status: em desenho
> Owner: search/narrative-memory
> Última revisão: 2026-09-06

## Valor

Permitir perguntas como:

- quando Astel ameaçou determinado NPC?
- quando Dandelion tocou determinada música?
- quem sabia determinado segredo?
- quando uma entidade apareceu pela primeira vez?

A resposta deve vir com **fontes**, não como memória opaca de LLM.

## Corpus possível

Separar índices/authority:

- publicações aprovadas;
- canon entries;
- entities summaries;
- transcript/evidence privada autorizada;
- historical documents revisados;
- futuramente relations/knowledge.

Não misturar tudo num índice sem metadata de audience/status/source.

## Contrato de resultado

Cada hit deve preservar:

- source type/id;
- campaign;
- session/entity quando aplicável;
- trecho seguro;
- authority (`evidence`, `candidate`, `canon`, `publication`);
- visibility/audience;
- score/ranking metadata quando útil.

## Embeddings

Embedding é índice derivado. Não muda o conteúdo nem o status de canon.

Model/version e source hash devem permitir reindexar sem perder a fonte.

## Security

Authorization deve ocorrer no retrieval boundary. Não recuperar secret/master data para o LLM e tentar pedir ao modelo para não mencionar.

Direção:

```text
user capability/audience
 -> filtered candidate corpus
 -> vector/text retrieval
 -> rerank
 -> answer com citations
```

## Hybrid search

Avaliar combinação de:

- lexical/full text;
- entity/alias resolution;
- temporal filters;
- vector similarity;
- structured filters (session/type/canon/audience).

Não assumir que vector-only será melhor para nomes próprios e termos da campanha.

## LLM answer

Se houver geração:

- instruir diferenciação canon/evidence/interpretation;
- citar sources;
- admitir ausência/ambiguidade;
- não preencher lacunas como fato;
- respeitar audience.

## Custos

`ai_usage_ledger` já prevê `embedding` e `rerank`. Registrar custo/model/run e evitar reembedding de source inalterada.

## Critérios antes de schema

- escolher corpus inicial;
- volume real;
- provider/local model;
- vector storage (Supabase/pgvector ou alternativa) somente após verificar suporte/custo atual;
- estratégia de chunking;
- authorization filters;
- evaluation set com perguntas reais.

## Critérios de aceite

- resposta inclui fontes navegáveis;
- pergunta sem evidência retorna "não encontrado"/incerteza;
- secret não aparece para usuário sem permission;
- canon e hipótese são rotulados;
- busca de nomes/aliases funciona;
- avaliação real demonstra ganho sobre busca textual simples.

## Não fazer agora

- indexar transcript privado em serviço externo sem revisão de privacidade;
- criar vector DB separado por moda;
- deixar LLM responder sem source;
- tratar embedding score como confiança factual.
