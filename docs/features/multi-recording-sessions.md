# Sessões compostas por múltiplas gravações Craig

> Status: em desenho
> Owner: sessions / processing / transcripts
> Última revisão: 2026-09-27
> Fonte de verdade: este documento, ADR-0019 proposto e epic #843

## Objetivo

Definir como o TDA representa, processa, reúne, revisa e publica uma sessão que chegou em **duas ou mais gravações Craig independentes**.

O objetivo não é ensinar o Companion a “engolir vários ZIPs de uma vez”. O objetivo é preservar as garantias atuais de source/run e adicionar uma composição de sessão segura, reprocessável e auditável.

A regra principal é:

> **Sessão é a unidade lógica/editorial. ZIP Craig é uma source de gravação. Uma sessão pode possuir uma ou várias recording parts.**

## Contexto

O fluxo atual funciona bem para uma gravação:

```text
Craig ZIP
  -> source content-addressed
  -> job
  -> immutable run
  -> review
  -> publish
```

O uso real passou a produzir cenários em que uma única sessão possui dois ou mais ZIPs, por exemplo por reconnect, restart, continuação ou interrupção da gravação.

O domínio cloud já admite múltiplos arquivos/fontes por session. O Companion já possui source Craig content-addressed e múltiplos runs imutáveis por source. O gap é a associação e composição desses resultados em **uma timeline editorial da sessão**.

## Escopo

### Inclui

- 1..N recording parts por session;
- sources Craig independentes e imutáveis;
- deduplicação exata por conteúdo;
- ordenação temporal automática somente com evidência confiável;
- ordem/offset manual quando necessário;
- gaps explícitos;
- overlaps com resolução explícita;
- participant reconciliation entre reconnects;
- seleção de um run terminal por part;
- selective reprocessing;
- Session Assembly imutável;
- review derivado da assembly;
- provenance multi-source na publicação;
- recuperação/restart;
- compatibilidade com o fluxo single-source.

### Não inclui

- concatenar ZIP/FLAC;
- upload de áudio bruto para cloud/R2;
- fuzzy merge automático de falas sobrepostas;
- diarização genérica quando Craig já possui tracks;
- reescrever engines Qwen/Whisper;
- ativar o importer legado;
- inferir profile global por nickname;
- publicação automática ao concluir ASR.

## Conceitos e vocabulário

### Session

Unidade lógica/editorial existente do TDA. Agrega participants, fontes, transcript, revisão e publications.

### Source

Material de origem local identificado por conteúdo.

Para Craig:

```text
source_id = craig-<sha256 do ZIP>
```

A source não recebe ownership editorial de uma session por mutação do seu manifest.

### Recording Part

Associação de uma source a uma session workspace.

Uma part não copia o áudio nem o run. Ela declara que uma source participa daquela composição de sessão e mantém metadata operacional/editorial pequena como ordem, colocação temporal e seleção de run.

### Run

Resultado ASR imutável de uma source e tentativa/configuração concreta, conforme ADR-0016.

Uma part pode possuir vários runs históricos, mas uma assembly escolhe exatamente um run terminal válido para cada part incluída.

### Session Workspace

Estado local mutável da composição em preparação:

```text
campaign + session
  -> parts
  -> order/timing
  -> selected runs
  -> participant mapping
  -> unresolved/resolved conflicts
```

É persistido pelo Agent e usa optimistic concurrency. Não é resultado final nem publicação.

### Session Assembly

Snapshot local imutável e verificável da transcrição completa de uma sessão composta por 1..N parts.

Ela referencia exatamente:
- sources;
- runs;
- hashes;
- ordem/offset;
- trims/resoluções;
- participant mapping;
- versão de canonicalização.

Assembly é base válida para review; não é um run ASR.

## Arquitetura alvo

```text
Session
  │
  └─ Session Workspace (mutável, local)
       ├─ Recording Part A
       │    └─ Source A
       │         ├─ Run A1
       │         └─ Run A2
       ├─ Recording Part B
       │    └─ Source B
       │         ├─ Run B1
       │         └─ Run B2
       └─ Recording Part C
            └─ Source C
                 └─ Run C1

              ↓ seleção/resolução

       Session Assembly A1 (imutável)
          A/run A1
          B/run B1
          C/run C1

              ↓ review/edit

       Draft / approved_local

              ↓ publish explícito

       Published Transcript Revision
```

Se apenas B for reprocessada:

```text
Session Assembly A2
  A/run A1
  B/run B2
  C/run C1
```

A1 continua intacta.

## Por que a composição acontece depois do ASR

Não criar um ZIP mestre nem concatenar FLACs.

Isso preserva:

- identidade content-addressed;
- retry/reprocessamento seletivo;
- histórico de cada captura;
- comparação entre engines;
- provenance de reconnects;
- recuperação de falha;
- independência de gap/overlap em relação aos bytes de áudio;
- menor I/O e menor duplicação local.

Uma decisão editorial de composição não deve transformar bytes de origem em um novo pseudo-source.

## Persistência local do workspace

O Agent deve ser authority do workspace local, usando persistência durável existente ou estrutura equivalente.

Identidade:

```text
(campaign_id, session_id)
```

Shape conceitual de part:

```text
part_id
source_id
ordinal
selected_run_id?
timeline_offset_seconds?
trim_start_seconds?
trim_end_seconds?
participant_mapping_revision?
created_at
updated_at
```

O schema final pode diferir.

### Regras

- source pode existir sem workspace;
- attach não altera source;
- detach não deleta source/run;
- mesma source não é anexada duas vezes ao mesmo workspace por acidente;
- mesma `recording_id` com hash diferente é variante/conflito, não duplicate exata;
- mutations usam expected revision/CAS;
- restart recupera workspace;
- listagens são sanitizadas.

## Deduplicação

### Duplicate exata

Mesmo `source_id` no mesmo workspace:

```text
craig-abc... == craig-abc...
```

Resultado: operação idempotente ou conflito acionável “esta gravação já faz parte da sessão”.

Não criar nova part nem novo ASR por upload duplicado.

### Recording ID igual, bytes diferentes

```text
recording_id igual
source_sha256 diferente
```

Não remover nem escolher automaticamente.

Pode significar:
- re-export;
- ZIP incompleto;
- versão reconstruída;
- outro pacote relacionado.

A UI deve sinalizar a relação e pedir decisão.

## Cronologia

Cada source possui timeline local começando no seu próprio zero.

A assembly usa:

```text
global_time = part.session_offset + local_time
```

### Confiança do timestamp

`start_time` de Craig só é usado como authority automática após classificação:

- `trusted_absolute`;
- `ambiguous`;
- `opaque`;
- `missing`.

A presença de uma string não é suficiente. Timestamp sem timezone ou valor opaco não autoriza auto-order silenciosa. Dois `trusted_absolute` no mesmo instante também não estabelecem ordem entre as parts: empate temporal exige ordem manual, e identificadores técnicos nunca funcionam como evidência cronológica.

### Manual override

Quando a evidência é insuficiente, o usuário define ordem/offset.

A decisão entra na provenance/hash da assembly.

## Gaps

Exemplo:

```text
Part A  21:00 ───── 22:30
Part B                    22:37 ───── 00:10
                  gap 7m
```

Regras:
- preservar o buraco;
- não fabricar fala;
- não encostar timelines artificialmente;
- mostrar warning factual;
- assembly pode aceitar gap explícito se o usuário confirmar.

## Overlaps

Exemplo:

```text
Part A  21:00 ───────── 22:30
Part B              22:28 ───────── 00:10
                    overlap 2m
```

Overlap não recebe fuzzy dedupe automático.

Primeiro corte:
- preferir part anterior até boundary;
- preferir part posterior a partir de boundary;
- trims manuais equivalentes.

A UI pode sugerir boundary, mas unresolved overlap bloqueia `approved_local`/publish.

O intervalo de overlap é sempre a interseção real `[max(starts), min(ends)]`. Um boundary fora dessa interseção é inválido. Se a ordem manual trouxer duas parts disjuntas em ordem temporal inversa, isso é `order_conflict`, não overlap artificial, e permanece fail-closed.

A política de ownership no boundary precisa ser determinística e versionada, inclusive quando um segmento cruza o corte.

## Participantes entre parts

`track_number` é identidade local da source, não identidade de pessoa ao longo da session.

Exemplo válido:

```text
ZIP A: track 1 Renan, track 2 Thom
ZIP B: track 1 Thom,  track 2 Renan
```

Ordem de confiança:

1. preservar sempre source + track + raw speaker;
2. Discord ID da track, quando presente e consistente, é evidência forte;
3. username/label é evidência auxiliar;
4. mapear para participant somente quando inequívoco ou confirmado;
5. ambiguity permanece explícita;
6. nunca criar profile global por match textual.

O mapping participa da identity da assembly.

## Seleção de runs e reprocessamento

Cada part escolhe um run terminal íntegro.

A UI pode sugerir o run mais recente/selecionado, mas a decisão é explícita quando houver alternativas relevantes.

Reprocessar uma part:
- cria novo job/run apenas daquela source;
- não chama ASR das outras parts;
- permite criar uma nova assembly com a nova seleção;
- não muta assembly anterior.

Misturar runs Qwen/Whisper entre parts é tecnicamente possível se cada run for válido. A provenance precisa tornar isso claro; o produto não interpreta automaticamente “mix” como melhor qualidade.

## Contrato da Session Assembly

Manifest conceitual:

```text
schema_version
assembly_id
campaign_id
session_id
created_at
canonicalization_version
parts[]
  part_id
  source_id
  source_sha256
  run_id
  run_transcript_sha256
  ordinal
  session_offset
  trims/resolution
participant_mapping_hash
transcript_sha256
stats
```

### Identidade de segmento

Não confiar em IDs locais isolados.

Preservar identidade composta:

```text
part_id + source_id + track_number + source_segment_id
```

ou derivar `assembly_segment_id` determinístico desse conjunto.

### Ordenação

Deve ser total, estável e independente de locale/filesystem.

Versão inicial a fechar na implementação:

```text
global_start
global_end
part_ordinal
track_number
source_segment_id
```

com tie-break completo.

### Commit

Aplicar a mesma filosofia de runs imutáveis:

1. validar todas as dependências;
2. produzir transcript canônico;
3. escrever/fence do transcript;
4. calcular/verificar hash;
5. escrever `assembly.json` por último;
6. marker presente = candidato concluído;
7. partial sem marker não aparece como resultado.

## Review

Review precisa aceitar base tipada:

```text
run
ou
session_assembly
```

Para multi-recording:
- draft deriva da assembly;
- run bruto continua intocado;
- approval liga-se ao assembly hash + draft revision/SHA;
- nova assembly não herda approval;
- draft de assembly antiga não é aplicado automaticamente na nova.

Single-source pode manter o caminho atual enquanto a migração/unificação não tiver benefício comprovado.

## Publicação

A publicação continua explícita e usa as garantias de #430/#443.

A revision publicada da sessão deve preservar provenance estruturada das parts:

- assembly ID/schema/hash;
- source identity/hash;
- run ID/transcript hash;
- ordinal;
- timing/trims necessários;
- mapping/version hash sanitizado.

Não enviar:
- áudio;
- path local;
- ZIP;
- checkpoints;
- tokens;
- metadata Craig privada desnecessária.

Provenance multi-source crítica deve preferir estrutura relacional/versionada em vez de depender exclusivamente de JSONB livre.

## Cleanup e retenção

Workspace mutável não é dono dos bytes de source/run.

- apagar workspace não apaga source/run;
- assembly mantém referências exatas;
- source/run usado por assembly não pode ser removido silenciosamente por generic cleanup;
- delete precisa detectar dependências;
- publicação cloud é independente de retenção local após receipt confirmado, conforme lifecycle explícito.

## UX alvo

### Single-source

Fluxo curto existente permanece reconhecível.

### Multi-source

```text
Sessão
  Gravações
   1. ZIP A · analisado · run selecionado
   2. ZIP B · analisado · precisa processar
   3. ZIP C · overlap a resolver

  + Adicionar gravação

  [Processar pendentes]
  [Resolver timeline]
  [Montar transcrição da sessão]
```

O sistema deve mostrar:
- duplicate;
- ordem;
- tempo/duração quando factual;
- gap/overlap;
- participants/conflicts;
- status por part;
- selected run;
- readiness da assembly.

## Falhas e recuperação

### Upload de uma part falha

Outras parts permanecem.

### Job de uma part falha

Outros runs continuam válidos.

### Agent/browser reinicia

Workspace reaparece do storage local.

### Source some/corrompe

Part fica inválida com diagnóstico; não é removida silenciosamente.

### Assembly interrompe

Sem commit marker = não concluída.

### Run selecionado é removido/tombstoned

Dependência precisa ser bloqueada/diagnosticada antes de destruir authority usada pela assembly.

### Publish falha

Assembly/review local permanecem disponíveis; current cloud anterior permanece conforme #430.

## Segurança e privacidade

- todo áudio permanece local;
- Web recebe metadata mínima;
- nenhum path absoluto;
- nenhum transcript integral em logs/events/receipts técnicos;
- publicação requer capability cloud vigente;
- campaign/session scope é validado server-side;
- participant identity privada não se torna pública por fazer parte do processing.

## Compatibilidade

A feature é aditiva.

Clients/Companions sem capability multi-recording continuam no fluxo single-source atual.

Não migrar destrutivamente:
- source IDs;
- runs;
- reviews históricos;
- published revisions anteriores.

## Backlog executável

- #844 — persistir recording parts/workspace local;
- #845 — cronologia, gaps, overlaps e trims;
- #846 — participant reconciliation entre parts;
- #848 — Session Assembly imutável + review base;
- #849 — composer Web multi-recording;
- #851 — provenance multi-source na publicação cloud;
- #852 — gate E2E/recovery sintético.

Epic: #843.

## Critérios de aceite globais

- 1..N sources numa session sem mudar identidade da source;
- duplicate exata idempotente;
- ordem/gap/overlap auditáveis;
- reconnect não confunde track number com participant;
- um run válido por part;
- selective reprocessing;
- assembly imutável e atômica;
- review/approval ligados à assembly exata;
- published revision preserva provenance multi-source;
- single-source continua simples;
- fixtures e logs sem dados privados.

## Referências

- ADR-0016 — runs/review/publicação;
- ADR-0019 — proposta de multi-recording/session assembly;
- `docs/domains/sessions.md`;
- `docs/domains/processing.md`;
- `docs/features/local-processing.md`;
- `docs/features/transcript-review-publication.md`;
- #843 e issues filhas.
