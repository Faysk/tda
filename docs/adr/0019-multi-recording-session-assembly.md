# ADR-0019 — Sessão pode compor múltiplas recording sources por uma assembly pós-ASR

> Status: accepted
> Data: 2026-09-27
> Decisores: proprietário / maintainers TDA
> Supersede: —
> Superseded por: —
> Última revisão: 2026-10-05
> Emenda: #1508/#1513/PR #1527 — overlap factual confiável usa policy conservadora automática

## Contexto

O pipeline atual do TDA identifica um ZIP Craig por conteúdo, processa cada source localmente e preserva runs ASR concluídos como outputs imutáveis. ADR-0016 separa source, run, review e publicação.

O uso real passou a gerar duas ou mais gravações para uma mesma sessão. Tratar cada ZIP como uma “sessão” diferente quebra a identidade editorial. Concatenar os áudios antes do processamento destruiria vantagens atuais de content addressing, retry seletivo e provenance.

É necessário decidir qual objeto representa a união lógica desses resultados.

## Drivers

- preservar source/run imutáveis;
- reprocessar somente a gravação problemática;
- manter provenance de reconnects;
- não enviar áudio bruto para cloud;
- suportar gaps/overlaps sem heurística destrutiva;
- permitir review/publicação de uma transcrição única da sessão;
- manter o fluxo de uma gravação simples;
- reaproveitar garantias de ADR-0016 e publicação revisionada.

## Opções consideradas

### A. Concatenar áudio e criar uma source sintética única

**Prós**
- engines continuariam vendo um único input;
- transcript final nasceria de um único run.

**Contras**
- duplica bytes/I/O;
- cria pseudo-source sem origem física clara;
- qualquer mudança de uma part força reconstrução/re-ASR do conjunto;
- esconde gaps/overlaps dentro de manipulação de áudio;
- enfraquece provenance e comparação;
- complica rollback e deduplicação content-addressed.

### B. Tratar cada ZIP como sessão independente

**Prós**
- zero mudança no processing.

**Contras**
- identidade de produto fica errada;
- review/publicação se fragmentam;
- participantes/timeline/resumo da sessão deixam de representar o evento real;
- navegação pública/editorial precisaria recompor sessões artificialmente depois.

### C. Preservar sources/runs e criar Session Assembly pós-ASR

**Prós**
- mantém content addressing;
- permite selective reprocessing;
- preserva histórico;
- torna gap/overlap decisão explícita;
- composição pode ser versionada/imutável;
- review/publicação continuam sobre um snapshot completo;
- não altera engines.

**Contras**
- adiciona novo lifecycle local;
- exige participant reconciliation;
- review/publication precisam aceitar provenance multi-source;
- cleanup precisa conhecer dependências.

## Decisão

Adotar **Opção C**.

Uma `Session` pode possuir uma ou várias **Recording Parts**, cada uma apontando para uma source Craig independente.

Cada source continua sendo processada separadamente e pode possuir múltiplos runs.

Depois que as parts necessárias possuem runs válidos e suas relações temporais/participantes foram resolvidas, o Companion cria uma **Session Assembly imutável**.

A assembly:
- seleciona exatamente um run válido por part;
- preserva source/run hashes;
- transforma timestamps locais em timeline global por regras versionadas;
- registra gaps;
- resolve automaticamente overlaps factuais quando a evidência suporta a policy conservadora e exige ação humana somente para ambiguidade editorial real;
- preserva participant mapping;
- gera transcript canônico e hash;
- torna-se uma base válida para review.

Review não altera a assembly. Edição gera draft/revision derivada conforme ADR-0016.

Publicação continua explícita. A published revision preserva provenance das parts/assembly e não contém áudio bruto.

## Decisões complementares

### Source não pertence fisicamente à session

Não mutar o manifest content-addressed para inserir session/ordem editorial. A associação vive em workspace local próprio.

### Track number não é identidade cross-source

Reconciliação usa provenance da track e participant mapping explícito. Nickname não autoriza inferir profile global.

### Gap é informação

Não compactar a timeline para esconder períodos sem gravação.

### Overlap usa preservação conservadora, sem fuzzy dedupe

Overlap factual com geometria confiável usa `preserve_both_exact_v1`: ambas as capturas permanecem disponíveis por default. A Assembly só colapsa duplicata quando há identidade forte, texto normalizado idêntico e timing trusted compatível, preservando provenance das duas origens.

Qualquer diferença de texto, identidade fraca/local ou timing incerto preserva ambas as falas. Boundary/manual trim permanece ferramenta avançada para a ambiguidade que realmente exigir decisão editorial.

Similaridade fuzzy nunca é autoridade para remover conteúdo.

### Assembly é diferente de run

Run explica uma inferência ASR sobre uma source. Assembly explica qual conjunto de resultados forma uma versão completa da sessão.

### Uma mudança gera nova assembly

Trocar selected run, ordem, offset, trim ou participant mapping não modifica assembly anterior.

## Consequências

### Positivas

- um ZIP ruim pode ser reprocessado sozinho;
- Qwen/Whisper podem ser comparados por part;
- reconnects preservam provenance;
- composição e publicação ficam reproduzíveis;
- rollback editorial não exige novo ASR;
- fluxo single-source continua possível;
- engines permanecem desacopladas da feature.

### Negativas / trade-offs

- mais um conceito na biblioteca local;
- UI precisa distinguir run de assembly;
- delete/cleanup ganha dependency checks;
- publication payload/schema precisa suportar provenance N sources;
- chronology/participant conflicts podem exigir ação humana.

### Dívida temporária

O review single-source atual pode coexistir com review por assembly enquanto a unificação não trouxer benefício suficiente. Não fazer migração destrutiva apenas para ter um modelo “bonito”.

## Invariantes

- Session é unidade lógica/editorial.
- Source é material de origem por conteúdo.
- Run concluído é imutável.
- Assembly concluída é imutável.
- Source/run não são reescritos pela composição.
- Partial assembly não é publicável.
- Gap não fabrica conteúdo.
- overlap resolvido deterministicamente por `preserve_both_exact_v1` pode seguir sem gate humano; ambiguidade realmente unresolved não é aprovada/publicada.
- Track number não identifica participant entre sources.
- Mudança da composição cria nova assembly.
- Review/approval ligam-se ao snapshot exato.
- Publish é explícito.
- Cloud não requer áudio bruto.

## Condição de revisão

Reavaliar se:
- Craig passar a entregar uma identidade nativa e estável de “sessão multi-recording” que elimine a necessidade do workspace sem perder provenance;
- o produto abandonar processamento por source;
- houver requisito comprovado para composição em áudio antes do ASR;
- experimentos mostrarem que assembly pós-ASR não consegue resolver um caso real importante sem perda de informação.

## Validação

A implementação respeita este ADR quando:

- 2+ ZIPs da mesma session permanecem sources independentes;
- duplicate exata reutiliza source;
- selective reprocessing não chama ASR das parts preservadas;
- gap/overlap são representados explicitamente;
- reconnect com track number trocado não muda speaker automaticamente;
- assembly possui manifest/hash/commit marker;
- nova seleção gera nova assembly;
- review e publication preservam provenance;
- nenhum áudio/path privado é sincronizado.

#852 permanece o gate histórico amplo da fundação multi-recording. A evolução de automação Craig é coordenada por #1508; #1515/PR #1532 prova o happy path zero-interrupção integrado por PR #1531.

## Estado de adoção

A decisão foi implementada incrementalmente e integrada à `main` em 2026-09-28 pelos slices #862, #863/#871, #873, #907, #940, #946 e #967. O conjunto cobre workspace/recording parts, cronologia, reconciliação de participantes, Session Assembly imutável, composer Web, provenance multi-source de publicação e gate sintético/E2E/recovery.

A adoção deste ADR não elimina o lifecycle próprio de distribuição do Companion: código integrado à `main` não prova, sozinho, que um binário Stable já contém a capability. Promoção de MSI/runtime continua exigindo os gates de release/aceite do Companion.

## Referências

- #843 — fundação/epic multi-recording;
- #844, #845, #846, #848, #849, #851 e #852 — slices/gate da fundação;
- #1508 e #1509–#1516 — evolução para automação Craig;
- #1513 / PR #1527 — policy conservadora de overlap;
- #1515 / PR #1532, integrada por PR #1531 — gate do happy path zero-interrupção;
- ADR-0003 — processamento pesado local;
- ADR-0013 — Companion/ASR;
- ADR-0016 — runs imutáveis, revisão e publicação;
- ADR-0017 — Web como entrada de processamento;
- `docs/features/multi-recording-sessions.md`.
