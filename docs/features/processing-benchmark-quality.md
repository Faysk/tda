# Benchmark ASR — referência humana e métricas objetivas

> Status: implementado pela #1416 sobre o bundle canônico da #1413
> Owner: Processamento local / Companion / qualidade ASR
> Última revisão: 2026-10-04
> Fonte de verdade: `local-companion/tda_companion/benchmark_bundles.py`, `benchmark_quality.py`, `src/features/edit/processing/benchmark-quality-*` e testes associados

Esta spec define o slice de qualidade objetiva do benchmark local. Ela complementa
[Processamento local](local-processing.md) e não muda a regra editorial central:
**concluir benchmark, criar referência ou calcular métricas não publica transcript,
não cria canon e não sincroniza texto para a cloud**.

## Objetivo

O benchmark de 5 minutos já compara os quatro perfis sobre a mesma amostra. A
#1416 adiciona a segunda metade do laboratório: preservar os outputs exatos,
permitir que uma pessoa transforme um deles em referência corrigida e calcular
métricas reproduzíveis contra essa referência.

O fluxo é:

```text
source Craig
  -> mesma amostra 0–300 s
  -> 4 profile artifacts imutáveis
  -> benchmark manifest escrito por último
  -> referência humana versionada e hash-bound
  -> receipts de qualidade sanitizados
  -> UI local com WER/CER/S-D-I/glossário/timing
```

Benchmark histórico sem evidência por perfil continua legível e permanece
explicitamente **quality unmeasured**. Não se inventa artifact/hash/reference
retroativamente.

## Evidência do benchmark

Cada execução concluída usa o `benchmark_id` canônico `benchmark-<job>-a<attempt>`.
O manifesto do bundle vincula esse identificador ao job/attempt e, separadamente,
ao `source_sha256`, ao descriptor exato da amostra e ao
`sample_identity_sha256`. A referência e cada receipt de qualidade revalidam essa
vinculação; uma referência nunca pode pontuar outra amostra.

Cada perfil grava localmente:

- `transcript.json` canônico;
- hash e tamanho;
- identidade de source/amostra/perfil;
- execution lineage;
- métricas de processamento.

O manifesto do perfil é escrito depois do transcript. O `benchmark.json` só é
escrito depois que os quatro perfis existem e passam read-back/hash. Resultado
parcial não vira benchmark concluído.

O receipt leve retornado ao job não contém transcript. Ele carrega somente
identidades, hashes, tamanhos, lineage e métricas de performance suficientes para
revalidar o bundle local.

## Referência humana

A referência vive apenas sob o namespace local do benchmark. Uma revisão contém:

- `benchmark_id`;
- source SHA-256;
- sample identity SHA-256;
- descriptor da amostra;
- conjunto exato de tracks;
- revision e parent revision;
- provenance;
- capability level;
- política de normalização;
- termos de glossário;
- conteúdo humano por track;
- hash canônico do payload.

Revisões são imutáveis. O índice mantém `latest_revision` e uma revisão ativa.
Salvar usa compare-and-swap por `expected_revision`; uma edição baseada em snapshot
obsoleto falha em vez de sobrescrever trabalho novo.

### Provenance

A primeira referência Level 1 pode nascer de qualquer um dos quatro outputs
preservados, mas esse output é apenas rascunho. A UI exige ação humana para salvar
e marca `human_owned=true`.

Provenance permitido:

- `derived-from-profile` — seed explícito + correção humana;
- `manual`;
- `imported`.

Escolher um seed não seleciona vencedor e não melhora artificialmente sua nota: a
referência salva passa a ser um artefato humano independente e versionado.

## Capability levels

### Level 1 — texto por track

Disponível no slice da #1416:

- WER;
- CER;
- substitutions/deletions/insertions;
- per-track;
- micro aggregate;
- fidelidade de termos de glossário.

### Level 2 — turns temporizados

Quando a referência contém turns válidos, acrescenta:

- coverage de turns;
- speaker accuracy;
- boundary error;
- p50/p95;
- overlap precision/recall/F1.

Essas métricas não são calculadas para referência Level 1.

### Level 3

Word-aligned reference permanece opcional/futuro. A implementação não finge suporte
nem extrapola precisão de timing.

## Normalização textual v1

`tda_asr_text_normalization_v1` é visível e versionada:

1. Unicode NFC;
2. Unicode casefold;
3. whitespace collapse;
4. remover pontuação Unicode;
5. preservar apóstrofo e hífen, normalizando variantes comuns;
6. preservar diacríticos;
7. nenhuma regra dependente de locale.

A política e seu SHA entram no receipt de qualidade.

## WER/CER e agregação

WER é calculado a partir de contagens brutas:

```text
WER = (substitutions + deletions + insertions) / reference_words
```

O valor **pode ultrapassar 1.0/100%**. A UI não faz clamp.

A agregação primária é micro: somar S/D/I e denominadores das tracks antes da
divisão. Macro WER pode ser exibido como dado secundário, nunca no lugar do micro.

Semântica de tracks:

- track nos dois lados: `matched`;
- só na referência: `missing_hypothesis`;
- só no output: `extra_hypothesis`.

Assim omissões e conteúdo extra não desaparecem por conveniência.

CER usa o mesmo texto normalizado, removendo espaços antes da distância de
Levenshtein.

## Glossário

Glossário é uma dimensão separada. Só termos que aparecem na referência entram na
avaliação. O receipt compartilha apenas hash do termo e contagens
correct/missed/extra + precision/recall; o texto do termo não sai no receipt.

## Timing, speaker e overlap

O matcher Level 2 é versionado (`tda_benchmark_turn_match_v1`) e trabalha primeiro
na mesma track. O candidato escolhe pares por interseção temporal com IoU mínimo
explícito e usa speaker somente depois do matching, para que `speaker_accuracy`
seja mensurável.

A saída declara `timing_precision`:

- `word_aligned`;
- `segment_aligned`;
- `window_fallback`.

Fallback nunca ganha precisão que não possui.

## Receipt de qualidade

`tda_benchmark_quality_receipt_v1` liga a medição a:

- benchmark manifest SHA-256;
- sample identity SHA-256;
- profile transcript SHA-256;
- reference revision + SHA-256;
- normalization policy + SHA-256;
- metric implementation version;
- capability level;
- métricas.

O receipt **não contém** transcript, referência, nomes/termos de glossário em claro,
áudio ou caminho local absoluto.

Receipts são locais, versionados pela revisão/hash da referência e idempotentes:
recalcular a mesma combinação deve produzir os mesmos bytes.

## Sem score composto e sem campeão automático

Performance, WER/CER, glossário e timing são dimensões diferentes. O contrato
retorna deliberadamente:

```json
{
  "winner": null,
  "composite_score": null
}
```

Qualquer política futura de default de engine precisa ser uma decisão separada,
com thresholds explícitos e evidência física; não nasce implicitamente da #1416.

## API local

Capabilities:

- `processing.benchmark.evidence-v1`;
- `processing.benchmark.reference-v1`;
- `processing.benchmark.quality-v1`.

Endpoints browser-scoped:

- `GET /api/v1/benchmarks/{benchmark_id}`;
- `GET /api/v1/benchmarks/{benchmark_id}/reference`;
- `GET /api/v1/benchmarks/{benchmark_id}/profiles/{profile_id}/reference-draft`;
- `POST /api/v1/benchmarks/{benchmark_id}/references`;
- `GET /api/v1/benchmarks/{benchmark_id}/quality`;
- `GET /api/v1/benchmarks/{benchmark_id}/quality/{profile_id}/inspection` — leitura privada/local sob demanda, nunca incorporada ao receipt sanitizado.

O body ampliado é permitido somente no POST de referência. O limite JSON global do
Agent permanece inalterado.

## UX

No histórico do Benchmark:

1. performance continua visível primeiro;
2. receipt antigo mostra `Qualidade não medida`;
3. receipt novo validado oferece escolha explícita do transcript-base;
4. a pessoa corrige cada track localmente;
5. salvar cria/ativa nova revisão;
6. a tabela mostra WER, CER, S/D/I, glossário e métricas temporais quando disponíveis;
7. clicar no WER abre breakdown por track e, sob demanda, regiões privadas locais de divergência entre referência e hypothesis;
8. a inspeção privada é marcada explicitamente como conteúdo local e pode mostrar termos/trechos em claro;
9. nenhuma ação publica ou sincroniza texto.

## Failure modes

Falhar fechado quando:

- artifact de perfil não bate com hash/tamanho;
- referência pertence a source/amostra diferente;
- track set diverge;
- normalization version diverge;
- revisão esperada ficou stale;
- capability level não é suportado;
- bundle não fecha 4/4;
- receipt do job anuncia evidence incompleta.

Orphan de arquivo temporário/revisão não indexada nunca deve ser interpretado como
referência ativa ou benchmark concluído.

## Aceite físico do contrato #1417

A CI comprova integridade estrutural com fixtures sintéticas; qualidade ASR real
continua exigindo o host Windows/GPU suportado e uma fonte Craig escolhida
explicitamente pelo operador.

O handoff canônico é:

```powershell
.\tools\acceptance\run-processing-benchmark-physical-gate.ps1 `
  -CraigZip <arquivo-craig-privado.zip> `
  -CompanionPayloadManifest <companion-payload-manifest.json> `
  -WhisperRuntimeCandidateManifest <whisper-runtime-candidate.json> `
  -QwenRuntimeCandidateManifest <qwen-runtime-candidate.json> `
  -OutputRoot <diretorio-local-de-evidencias>
```

Opcionalmente, `-HumanReferenceJson <reference-request.json>` ativa uma revisão
humana local e inclui no receipt sanitizado apenas revisão, WER/CER e metadados
numéricos por perfil.

O gate:

- reabre os quatro transcripts canônicos e confere SHA-256;
- valida o bundle 4/4, ordem de perfis e amostra de 300 s;
- baixa o ZIP de evidência apenas para o diretório local indicado;
- rejeita áudio e entradas inesperadas no ZIP;
- verifica diagnósticos contra padrões de token, cookie, caminho pessoal e nomes
  de arquivos de áudio;
- mantém transcript, referência humana e paths locais fora do receipt;
- não faz upload, publicação, promoção de runtime ou promoção do Companion.

O ZIP privado contém transcripts por definição e **não deve ser commitado**.
Somente o receipt sanitizado/metadados pode ser retido como evidência de
aceitação, conforme a governança vigente.

## Testes mínimos

Companion:

- bundle 4/4 e hashes;
- reference CAS/immutability;
- normalização com acentos/pontuação;
- WER > 100%;
- missing/extra tracks;
- Level 1 sem timing;
- Level 2 com speaker/boundary/overlap;
- glossário sanitizado;
- receipt sem texto privado;
- histórico sem referência continua unmeasured.

Web:

- receipt histórico continua parsável;
- evidence nova é all-or-none;
- Level 1 aceita ausência de turns;
- parser de quality rejeita winner/composite;
- serializer de referência não adiciona publish/sync.

## Não objetivos

- escolher automaticamente o melhor modelo;
- promover runtime/Companion;
- publicar transcript;
- importar referência para Supabase;
- substituir o contrato editorial de runs/review/publication;
- afirmar qualidade física sem rodar o corpus real autorizado.

## Dependências

- #1412 — epic do laboratório;
- #1413 — evidência por perfil/bundle já implementada em `benchmark_bundles.py`;
  a #1416 reutiliza esse contrato canônico e não cria uma segunda camada de
  persistência;
- #1415 — comparação/export de evidência local;
- PR histórica #285 — inspiração conceitual revalidada, não fonte de schema atual.

A aceitação desta spec ocorre por código + testes + CI do PR. Merge não
equivale a promoção de release nem a benchmark físico do Craig real.
