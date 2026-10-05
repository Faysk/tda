# Sessões compostas por múltiplas gravações Craig

> Status: implementação funcional e gate E2E/recovery concluídos
> Owner: sessions / processing / transcripts
> Última revisão: 2026-10-05
> Fonte de verdade: este documento, ADR-0019 + ADR-0022, epic fundacional #843 e evolução de automação #1508

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

A fundação multi-recording de #843 foi integrada incrementalmente: workspace/parts, timeline, participant mapping, Session Assembly, composer Web, provenance cloud e gate E2E/recovery (#852). Em 05/10/2026, a epic **#1508** completou a evolução do happy path Craig com #1509–#1516: metadata estruturada, chronology autoritativa automática, participant reconciliation não bloqueante, exact run reuse, overlap conservador automático, bot policy e orquestração sem gates técnicos quando não existe ambiguidade real. PR #1531 tornou o estado concluído autoritativo na Overview e PR #1532 fechou o gate zero-interrupção.

## Current behavior — 2026-10-05

O caminho normal é **1..N ZIPs Craig → uma intenção de sessão → reuso/processamento seletivo → Assembly automática → Revisar transcrição**.

Quando a evidência é suficiente, o sistema executa automaticamente:

- staging/validação das sources;
- exact run reuse pela intenção/fingerprint vigente;
- chronology Craig autoritativa;
- participant reconciliation;
- `preserve_both_exact_v1` para overlap factual confiável;
- collapse somente de duplicata comprovada pela policy conservadora;
- build da Session Assembly e entrada no estado **Transcrição pronta**.

O operador é interrompido apenas quando resta uma decisão real: variante de source, falta/conflito de evidência temporal, escolha entre resultados sem authority ou resolução editorial avançada. `Processar pendentes`, seleção manual de run, boundary/trims e `Montar transcrição da sessão` continuam disponíveis para recovery/advanced controls, não como sequência obrigatória do happy path.

### Legacy compatibility

- authority temporal corrente: **`tda_session_timeline_v2`**;
- `tda_session_timeline_v1` continua aceito somente para leitura/rollout compatível;
- schema de participant mapping permanece **`tda_session_participant_mapping_v1`**;
- a policy de reconciliação corrente é **`strong_discord_or_local_v2`**; schema e policy possuem versionamentos independentes.



## Escopo

### Inclui

- 1..N recording parts por session;
- sources Craig independentes e imutáveis;
- deduplicação exata por conteúdo;
- ordenação temporal automática somente com evidência confiável;
- ordem confirmada pelo usuário como continuidade editorial quando wall-clock é insuficiente;
- offset manual como ferramenta avançada, não requisito do caminho feliz;
- gaps explícitos e preservados quando comprovados;
- overlaps factuais preservados automaticamente, com dedupe apenas quando a duplicação é comprovada; boundary manual permanece escape hatch;
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

## Arquitetura vigente

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

## Metadata Craig como evidência auxiliar

A source continua sendo identificada pelos bytes do ZIP. Metadata Craig melhora a
automação, mas não substitui a identidade content-addressed nem vira requisito
artificial para transcrever áudio válido.

Quando disponíveis, o Companion normaliza duas fontes locais:

- `info.txt`: recording id, guild/channel/requester, `start_time`, tracks e notes;
- primeira linha JSON de `raw.dat`: metadata estruturada antes do payload Ogg
  original, incluindo IDs Discord, `globalName`, `bot` e `unknown`.

O header de `raw.dat` é lido de forma bounded (até 256 KiB e somente até o
primeiro newline). O payload de áudio bruto não é materializado no staging e não é
enviado para cloud.

Quando `info.txt` e `raw.dat` existem juntos, campos fortes são cruzados.
Conflito de horário ou identidade não é resolvido por preferência silenciosa:
a evidência conflitante deixa de ser promovida como authority. Ausência,
malformação bounded ou falta de campos opcionais no `raw.dat` não invalida tracks
FLAC que continuam seguras e suficientes para processamento.

Notes Craig são preservadas como markers locais timestamped. Elas podem enriquecer
a revisão/diagnóstico, mas não alteram por si só speaker, texto ASR ou cronologia.

### Tracks Craig marcadas como bot

A policy padrão de transcrição é `exclude_confirmed_craig_bots_v1`:

- somente `bot=true` comprovado pela metadata Craig é excluído;
- nickname, label ou heurística textual nunca classificam uma track como bot;
- `unknown=true` continua elegível;
- todas as tracks permanecem na source imutável;
- o job/run registra policy e números de tracks incluídas/ignoradas;
- `audio_work_seconds` e progresso representam somente o trabalho enviado ao ASR;
- `all_tracks_v1` permanece como override explícito quando for necessário incluir
  bots.

A track policy faz parte da compatibilidade do run. Um resultado all-tracks não é
exact-match de uma intenção que exclui bots, e vice-versa.

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
continua soberana: gap comprovado é preservado e overlap comprovado entra em
`preserve_both_exact_v1`: ambas as capturas permanecem disponíveis e a Assembly
só colapsa duplicatas que tenham identidade forte, texto normalizado idêntico e
timing trusted compatível.

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

Overlap não recebe fuzzy dedupe automático nem corte destrutivo por default.

Quando a geometria é `trusted_absolute`, a resolução derivada é
`preserve_both_exact_v1`:
- os segmentos das duas recordings entram na composição;
- uma duplicata só é colapsada quando pertence à mesma identidade forte
  (Discord ID ou merge manual explícito), tem texto normalizado idêntico e início/fim
  globais dentro da tolerância estrita da policy;
- o segmento preservado registra provenance das duas origens e a versão
  `trusted_overlap_exact_text_v1`;
- qualquer diferença de texto, identidade fraca/local ou timing incerto preserva
  **ambas** as falas.

Isso privilegia false negatives (uma duplicata extra para revisar) sobre false
positives (fala real perdida). Similaridade textual aproximada nunca é autoridade.

Boundary manual continua como ferramenta avançada/legacy:
- preferir part anterior até boundary;
- preferir part posterior a partir de boundary;
- trims manuais equivalentes.

O intervalo de overlap é sempre a interseção real `[max(starts), min(ends)]`. Um
boundary fora dessa interseção é inválido. Se a ordem manual trouxer duas parts
disjuntas em ordem temporal inversa, isso é `order_conflict`, não overlap
artificial, e permanece fail-closed.

A policy de overlap entra no fingerprint/canonicalização da Assembly. Assemblies
anteriores continuam imutáveis.

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

### Reconciliação vigente

O Companion expõe o schema local versionado `tda_session_participant_mapping_v1`. A policy vigente é `strong_discord_or_local_v2`; manter o schema em v1 não significa usar uma policy antiga.

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

Cada part escolhe um run terminal íntegro. Reuso automático só acontece quando o
Agent consegue provar compatibilidade exata com a intenção atual.

Runs novos recebem `tda_transcription_intent_fingerprint_v1`, calculado sobre
inputs semânticos que podem mudar o resultado:

- profile e identidade engine/model/revision;
- language;
- alignment + revision;
- recipe version;
- track-policy version;
- SHA-256 de contexto;
- SHA-256 de glossário.

Job id, attempt, horário de conclusão e GPU UUID são fatos operacionais e não
tornam dois outputs semanticamente diferentes por si só.

Prioridade de seleção:

1. run produzido/reconciliado pela própria intenção corrente;
2. run histórico com fingerprint **exatamente igual**;
3. nenhum exact match: processar somente aquela source;
4. múltiplos exact matches com transcript SHA diferente: pedir decisão, não escolher
   silenciosamente.

Um singleton histórico não é reutilizado só por ser o único disponível. Runs
legados sem fingerprint continuam íntegros/revisáveis, mas não viram evidência
automática de equivalência.

Um `selected_run_id` persistido também é revalidado quando uma nova intenção muda
profile/contexto/glossário/policy. Isso impede que uma sessão apresentada como
Whisper Detailed use silenciosamente um run Qwen antigo.

Reprocessar uma part:
- cria novo job/run apenas daquela source;
- não chama ASR das outras parts;
- permite criar uma nova assembly com a nova seleção;
- não muta assembly anterior.

**Reprocessar do zero** permanece uma ação explícita mesmo quando existe exact
match; ela cria novo trabalho sem apagar o run reutilizável anterior.

Misturar runs Qwen/Whisper entre parts continua tecnicamente representável, mas
somente após escolha explícita. A provenance precisa deixar o mix claro; o produto
não interpreta automaticamente uma combinação de engines como melhor qualidade.

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
informação; overlap factual confiável é preservado e reconciliado de forma
conservadora. Só um overlap sem evidência suficiente para aplicação segura da
policy automática sobe como exceção.

O Web deve:

- aceitar múltiplos arquivos na mesma seleção e em drops sucessivos;
- manter cada arquivo independentemente válido, inválido, duplicado ou com falha;
- preservar os demais quando um ZIP é inválido;
- deduplicar bytes idênticos por `source_id` sem criar trabalho duplicado;
- pedir decisão somente para variantes reais de mesmo `recording_id`, cronologia
  ambígua, overlap que permaneça realmente irresolúvel, conflito de source/metadata
  ou múltiplos resultados elegíveis;
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
- **overlap sem prova suficiente para a policy conservadora:** preservar conteúdo e, somente se ainda houver uma decisão editorial real, oferecer boundary/corte avançado;
- **identidade realmente contraditória que impeça atribuição local segura:** corrigir a source/metadata; label-only ambiguity permanece advisory e pode ser unificada depois.

Essas exceções abrem/indicam os controles técnicos existentes, mas o caminho
feliz não exige attach manual, `Processar pendentes`, seleção de run por part
nem `Montar transcrição da sessão`.

### Compatibilidade

Uma sessão com um único ZIP usa exatamente a mesma intenção 1..N. Não existe um
segundo produto escondido para “single-source”; o orquestrador simplesmente
tem uma gravação para acompanhar.

## Gates de regressão

### Fundação — #852

#852 continua sendo o gate fundacional de workspace/timeline/participants/Assembly/publication multi-source. Ele prova contratos sintéticos sem GPU nem material privado e permanece histórico útil para a arquitetura de #843.

### Happy path automático — #1515 / PR #1532

O gate atual da evolução #1508 é #1515, entregue pelo PR #1532 e integrado no delivery de #1531. A jornada sintética prova:

- 2 ZIPs como uma única intenção;
- ordem selecionada diferente da chronology Craig autoritativa;
- um run existente reutilizado somente por exact fingerprint;
- somente a source faltante enviada ao ASR;
- chronology e participants resolvidos sem gate manual;
- Assembly construída automaticamente;
- estado terminal **Transcrição pronta**;
- **Revisar transcrição** abre Results.

O happy path deve provar a ausência de CTAs/mensagens técnicas concorrentes como **Carregue o mapa de participantes**, **Resolver participantes**, **Usar horários Craig**, **Montar transcrição da sessão** e **Detalhes técnicos** como próximo passo.

Esses gates não executam modelo pesado nem usam material privado e não substituem aceite físico de GPU/runtime.

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

## Historical delivery map

### Fundação #843

- #844 — recording parts/workspace local — implementado;
- #845 — cronologia, gaps, overlaps e trims — implementado;
- #846 — participant reconciliation — implementado;
- #848 — Session Assembly imutável + review base — implementado;
- #849/#940 — composer Web — implementado;
- #851/#946 — provenance multi-source na publicação — implementado;
- #852/#967 — gate E2E/recovery fundacional — implementado;
- #1441 — sequência confirmada sem wall-clock confiável — implementado.

### Evolução #1508 — concluída em 05/10/2026

- #1509 — metadata `raw.dat`/notes — concluído;
- #1510 — chronology Craig autoritativa automática — concluído;
- #1511 — participant reconciliation automática e não bloqueante — concluído;
- #1512 — exact run reuse por fingerprint — concluído;
- #1513 — overlap comprovado reconciliado sem perder fala única — concluído;
- #1514 — remoção dos gates técnicos do happy path — concluído via #1531;
- #1515 — gate E2E da automação — concluído via #1532;
- #1516 — bot tracks ignoradas por default com provenance/override — concluído.

ADR-0022 é a decisão vigente para overlap. #843 permanece a fundação arquitetural; #1508 é a evolução atual do produto, não um substituto que apaga o histórico.

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
- ADR-0022 — policy vigente de overlap conservador automático;
- `docs/domains/sessions.md`;
- `docs/domains/processing.md`;
- `docs/features/local-processing.md`;
- `docs/features/transcript-review-publication.md`;
- #843 — fundação multi-recording;
- #1508 e #1509–#1516 — automação Craig atual;
- PR #1531 e PR #1532 — completed state e gate zero-interrupção.
