# Sessões compostas por múltiplas gravações Craig

> Status: implementação funcional e gate E2E/recovery concluídos
> Owner: sessions / processing / transcripts
> Última revisão: 2026-10-04
> Fonte de verdade: este documento, ADR-0019 accepted e epic #843

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

O domínio cloud já admite múltiplos arquivos/fontes por session. O Companion já possui source Craig content-addressed e múltiplos runs imutáveis por source.

Em 2026-09-28, os slices locais de workspace, cronologia, reconciliação de participantes e Session Assembly estão integrados à `main` (#862, #863/#871, #873 e #907). O composer Web de #849 foi entregue por #940, a provenance cloud multi-source de #851 foi entregue por #946 e o gate E2E/recovery de #852 foi entregue por #967. O rollout Web/cloud foi promovido pelo fluxo normal de Production; a distribuição de novos bytes do Companion continua sendo um lifecycle separado e exige seus próprios gates de release/aceite.

## Escopo

### Inclui

- 1..N recording parts por session;
- sources Craig independentes e imutáveis;
- deduplicação exata por conteúdo;
- ordenação temporal automática somente com evidência confiável;
- ordem confirmada pelo usuário como continuidade editorial quando wall-clock é insuficiente;
- offset manual como ferramenta avançada, não requisito do caminho feliz;
- gaps explícitos e preservados quando comprovados;
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

A presença de uma string não é suficiente. Timestamp sem timezone ou valor opaco não autoriza auto-order silenciosa.

Horário parseável sem referência absoluta suficiente (por exemplo `21:00:00`) é `ambiguous`, não `opaque`. Duas recording parts com o mesmo instante absoluto também não estabelecem ordem relativa; nesse caso a ordem/offset precisam de confirmação manual em vez de um tie-break autoritativo por ID.

### Ordem confirmada e manual override

Quando a evidência absoluta é insuficiente, o caminho feliz não exige digitar segundos.
O usuário confirma a ordem visual das recording parts e o Agent deriva uma timeline
editorial contínua por duração acumulada. Essa decisão é persistida como
`timeline_strategy=user_confirmed_sequence`.

A continuidade editorial **não** afirma que houve zero segundos físicos entre duas
capturas. Cada adjacência sem prova temporal fica com intervalo físico
`unknown`, enquanto `wall_clock` permanece `unavailable` ou `partial`.
Se duas parts adjacentes possuem timestamps absolutos confiáveis, a geometria real
continua soberana: gap comprovado é preservado e overlap comprovado continua
fail-closed até boundary explícito.

O workspace e a Session Assembly persistem de forma versionada e determinística:
- `timeline_strategy=trusted_absolute|user_confirmed_sequence|manual_offsets`;
- `wall_clock=unavailable|partial|trusted`;
- `unknown_interval_count=N`;
- fingerprint inclui estratégia, ordem, offsets derivados, trims e decisões de relação;
- reorder/detach invalida somente a geometria derivada da sequência e exige nova
  confirmação, sem alterar source, run ou disparar ASR.

Offset manual continua disponível nos controles técnicos para exceções reais. A
decisão temporal entra na provenance/hash da assembly.

Compatibilidade de rollout: a Web continua aceitando workspaces com
`tda_session_timeline_v1` emitidos pelo Stable anterior. Nessa combinação não se
inventa provenance v2 e o CTA de sequência confirmada permanece oculto. O fallback
`user_confirmed_sequence` só é habilitado quando o Agent anuncia explicitamente a
capability `transcription.session-sequence`; workspaces v2 usam
`tda_session_timeline_v2`.

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
- mostrar informação factual, sem tratar a existência do gap como erro;
- gap derivado de timestamps absolutos confiáveis é factual e não exige confirmação redundante;
- gap criado por offset manual continua exigindo confirmação quando necessário.

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

Confirmações de gap e resoluções de overlap pertencem à relação entre adjacências, não à part isolada. Reorder/detach invalidam decisões relacionais persistidas; mudanças de offset/trim invalidam decisões antigas da geometria afetada para que uma confirmação não “teleporte” silenciosamente para outro par ou outro overlap.

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
4. quando identidade forte faltar, manter uma identidade `local_observation` por source/track;
5. ambiguity cross-source permanece explícita como advisory, sem bloquear Assembly;
6. manual merge/split continua disponível como override editorial;
7. nunca criar profile global por match textual.

O mapping participa da identity da assembly.

### Implementação inicial de reconciliação

O Companion expõe o contrato local versionado `tda_session_participant_mapping_v1`.

Regras implementadas:
- cada observação mantém `source_id + track_number + raw_speaker` e identity Craig disponível;
- `track_number` nunca é authority cross-source;
- Discord ID exato pode agrupar observações dentro da mesma session;
- username/label só produz evidência auxiliar e conflitos; não faz merge automático quando a identidade forte falta;
- mesmo label com Discord IDs distintos permanece em participants distintos;
- label igual com identidade ausente/parcial **não** autoriza merge: as observações permanecem separadas e a ambiguidade vira warning;
- a falta de identidade cross-source, por si só, não bloqueia Assembly nem review porque `source_id + track_number + raw_speaker` preservam autoria local;
- decisões manuais são full-replacement, CAS-guarded pelo `workspace.revision`, persistidas localmente e sobrevivem a restart;
- o mapping recebe SHA-256 determinístico para entrar na provenance da futura Session Assembly;
- nenhuma resolução cria ou preenche `profile_id` global.

O detach de uma recording part remove somente as decisões manuais pertencentes àquela source; não altera source/run bruto.

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

### Princípio de produto

A unidade mental do operador é a **sessão**. ZIP, source, job, run,
Recording Part, workspace e Session Assembly continuam existindo como contratos
internos de segurança e provenance, mas não formam um wizard obrigatório.

O caminho normal é:

```text
Sessão
  -> selecionar ou soltar 1..N ZIPs Craig
  -> confirmar a ordem editorial somente quando a cronologia factual não puder ser provada
  -> escolher profile/contexto/glossário uma vez
  -> Transcrever sessão
  -> acompanhar progresso por gravação
  -> Revisar transcrição
```

Com um ZIP, a seleção continua curta. A partir do segundo ZIP, o Web explica antes
do CTA que as gravações formarão uma única sessão, mostra a ordem numerada e
permite reordenar por pointer ou teclado. Essa ordem representa intenção
editorial, não uma alegação de relógio real.

Horário Craig só ganha authority quando a classificação é
`trusted_absolute`. Quando todas as parts possuem instantes absolutos distintos e
coerentes, essa evidência factual é soberana sobre a ordem de attachment/upload: o
Agent ordena e aplica offsets automaticamente, sem pedir confirmação redundante.
Uma ordem manual **já explicitamente persistida** continua sendo override humano e
não é sobrescrita. `ambiguous`, `opaque` e `missing` são estados neutros:
não viram erro por si sós e nunca autorizam horário inventado. Gap comprovado é
informação; overlap real não resolvido continua sendo uma exceção que pede
decisão.

O Web deve:

- aceitar múltiplos arquivos na mesma seleção e em drops sucessivos;
- manter cada arquivo independentemente válido, inválido, duplicado ou com falha;
- preservar os demais quando um ZIP é inválido;
- deduplicar bytes idênticos por `source_id` sem criar trabalho duplicado;
- pedir decisão somente para variantes reais de mesmo `recording_id`, cronologia
  ambígua/overlap, participante ambíguo ou múltiplos resultados elegíveis;
- preparar runtime/modelo uma vez por intenção quando necessário;
- enfileirar somente gravações sem resultado elegível;
- reutilizar gravações já concluídas;
- reprocessar somente falhas;
- aplicar cronologia `trusted_absolute` automaticamente, inclusive quando ela corrige a ordem de attachment; override manual explícito continua soberano e gaps comprovados continuam sendo informação;
- quando wall-clock for insuficiente, pedir uma confirmação simples da ordem e seguir
  com continuidade editorial sem fabricar intervalo físico;
- selecionar automaticamente o resultado quando existe authority inequívoca;
- montar a Session Assembly automaticamente assim que as invariantes permitem;
- apresentar o resultado final como uma transcrição contínua pronta para review.

O progresso primário usa linguagem de produto, por exemplo
`2/3 concluídas · 1 transcrevendo`. IDs, hashes, source/run/workspace/assembly,
ordenação manual e ferramentas de diagnóstico ficam em **Detalhes técnicos**.

### Recuperação

O Agent continua sendo authority de workspace, intenção de transcrição, jobs,
runs e assemblies. Profile/contexto/glossário da intenção são persistidos
somente no SQLite local do Companion. O navegador guarda apenas metadata
bounded de recuperação: scope/campaign/session, source IDs, profile, hashes de
contexto/glossário e identidades de enqueue/job/run. Texto de
contexto/glossário, transcript, paths e bytes ZIP não entram no storage
persistente do browser.

Reload/reconnect valida o receipt do browser contra a intenção local do Agent
antes de restaurar a operação. Divergência de request/profile/hash falha
fechado. Isso permite recuperar inclusive a janela attach -> enqueue sem
recriar source/job confirmado nem apagar partes concluídas.

Quando uma resposta de enqueue fica ambígua, a mesma identidade persistida é
reutilizada. Quando um job falha/cancela/interrompe após ter sido criado, retry
usa o job persistido do Agent para preservar a configuração local da intenção e
reexecutar somente aquela gravação.

Se o navegador desaparecer antes de um arquivo selecionado chegar ao Agent,
os bytes desse arquivo não são inventados nem persistidos no browser: o operador
precisa selecionar novamente apenas o ZIP ainda não staged. Isso preserva a
regra de que áudio bruto continua local e sob controle explícito.

### Exceções com decisão humana

- **same `recording_id`, bytes diferentes:** manter ambas ou escolher uma;
- **dois ou mais resultados elegíveis sem authority da intenção:** escolher um;
- **ordem temporal sem evidência suficiente:** confirmar a ordem exibida, sem
  preencher segundos manualmente;
- **overlap comprovado:** resolver boundary/corte explicitamente;
- **identidade realmente contraditória que impeça atribuição local segura:** corrigir a source/metadata; label-only ambiguity permanece advisory e pode ser unificada depois.

Essas exceções abrem/indicam os controles técnicos existentes, mas o caminho
feliz não exige attach manual, `Processar pendentes`, seleção de run por part
nem `Montar transcrição da sessão`.

### Compatibilidade

Uma sessão com um único ZIP usa exatamente a mesma intenção 1..N. Não existe um
segundo produto escondido para “single-source”; o orquestrador simplesmente
tem uma gravação para acompanhar.

## Gate sintético de regressão

A #852 consolida as provas do fluxo multi-recording em camadas proporcionais, sem GPU e sem material privado:

- Companion/SQLite: workspace 1..20 parts, CAS/restart, timeline, participants, assembly atômica e review;
- Web: composer, selective processing/idempotência, variante por `recording_id`, reload/reconnect e assembly review;
- publication: canonicalização multi-source, payload sanitizado e PostgreSQL scratch para replay, stale-current, replace, restore/unpublish e rollback atômico;
- `multi-recording-gate`: job focado do CI que executa os contratos Companion/Web/publication relevantes e um guardrail de fixtures/paths privados;
- `processing-e2e` permanece dono da jornada browser 2 parts e `transcript-import-postgres` permanece dono do scratch PostgreSQL completo.

Esse gate não roda modelo ASR pesado, não usa áudio de campanha e não substitui aceite físico de GPU.

### Gate integrado de review e Markdown

A #1118 estende essa proteção até o fim da jornada editorial privada. O job
`session-workflow-gate` é obrigatório quando processamento, transcript review,
publicação multi-source ou a jornada browser correspondente mudam. Ele compõe,
sem reimplementar os contratos donos:

- intenção 1..N, selective retry e Session Assembly do Companion;
- review CAS da Assembly, incluindo conflito stale e aprovação do draft exato;
- o parser/serializer compartilhado `TDA Transcript Markdown v1`, onde somente
  participante e texto são editáveis e IDs/ordem/timestamps permanecem
  estruturais;
- dual-time: elapsed continua canônico e wall-clock só aparece quando a origem
  absoluta foi validada;
- publicação privada `tda_transcript_publication_request_v2` com provenance de
  todas as parts e recuperação por receipt da mesma `operationId`;
- browser sintético de ponta a ponta e scanner estático que rejeita paths
  privados e metadata de recovery contendo transcript/contexto/glossário em
  plaintext.

O browser limita a renderização simultânea da lista de review a 200 falas, sem
truncar o draft nem o Markdown. Assim, sessões sintéticas de milhares de
segmentos continuam validadas pelo contrato sem transformar o DOM num churrasco
de memória. O handoff para o Edit é explícito e privado; não publica transcript,
capa ou resumo no site público.

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

- #844 — recording parts/workspace local — implementado;
- #845 — cronologia, gaps, overlaps e trims — implementado;
- #846 — participant reconciliation entre parts — implementado;
- #848 — Session Assembly imutável + review base — implementado;
- #849 — composer Web multi-recording — implementado via #940;
- #851 — provenance multi-source na publicação cloud — implementado via #946;
- #852 — gate E2E/recovery sintético amplo — implementado via #967;
- #1441 — sequência confirmada sem wall-clock confiável — implementação nesta entrega.

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
- ADR-0019 — decisão accepted de multi-recording/session assembly;
- `docs/domains/sessions.md`;
- `docs/domains/processing.md`;
- `docs/features/local-processing.md`;
- `docs/features/transcript-review-publication.md`;
- #843 e issues filhas.
