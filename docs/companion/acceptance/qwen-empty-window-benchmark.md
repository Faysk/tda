# Aceite físico — Qwen empty-window #1236

> Issue: #1236  
> Owner: local-companion / processing  
> Última revisão: 2026-10-01  
> Status: harness implementado; execução física no Craig original ainda pendente  
> Runtime candidato: Qwen `1.0.14`  
> Amostra: primeiros `300 s` do Craig já staged localmente  
> Perfis: `qwen-fast` e `qwen-quality`

## Objetivo

Este gate responde, no mesmo source local que reproduziu #1236, se um decode vazio do Qwen representa:

- silêncio quase digital que pode continuar como intervalo de zero segmentos;
- reconhecimento vazio apesar de existir sinal, que deve falhar explicitamente;
- outra falha de runtime/modelo/worker;
- ou uma condição que não reaparece no candidato.

Ele **não** envia áudio, transcript, nomes, paths ou token para cloud/GitHub. O script usa o worker Qwen real, os modelos locais já preparados e o Craig já staged no computador.

O benchmark normal de quatro perfis não é autoridade para este gate enquanto #1233/#1234 puderem falhar antes do Qwen. Este aceite executa apenas os dois perfis Qwen com worker isolado novo por perfil.

## Pré-condições

1. checkout da revisão que contém a correção de #1236;
2. runtime Qwen candidato exato `1.0.14` instalado localmente;
3. os gates físicos de `qwen-fast` e `qwen-quality` refeitos para os bytes exatos do `1.0.14`;
4. Craig original ainda staged em `%LOCALAPPDATA%\TDA\Data\staging`; o gate exige exatamente o source content-addressed por `b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e`;
5. nenhum job concorrente usando a GPU/runtime;
6. ambiente Python do `local-companion` disponível para executar o harness.

O gate falha antes de iniciar ASR se o source não for exatamente o Craig que reproduziu #1236, se o runtime ativo não for exatamente `1.0.14`, se o worker não bater com seu hash, ou se qualquer physical gate estiver stale. A versão esperada é parte do contrato versionado do harness e não pode ser sobrescrita por flag de linha de comando; um candidato futuro exige atualização explícita do código/documento.

## Execução

Na raiz do repositório:

```powershell
uv run --project local-companion python tools/acceptance/qwen_empty_window_benchmark.py `
  --confirm RUN `
  --source-id "<source-id-staged>"
```

Opcionalmente, quando o checkout/runtime estiver fora dos defaults:

```powershell
uv run --project local-companion python tools/acceptance/qwen_empty_window_benchmark.py `
  --confirm RUN `
  --source-id "<source-id-staged>" `
  --sample-seconds 300 `
  --tda-root "$env:LOCALAPPDATA\TDA" `
  --repo-root "<checkout-do-tda>"
```

O `source-id` é usado somente localmente. O receipt grava apenas um binding SHA-256 derivado; não grava o identificador bruto.

## Evidência produzida

Default:

```text
%LOCALAPPDATA%\TDA\State\acceptance\qwen-empty-window\qwen-empty-window.json
```

O receipt `tda_qwen_empty_window_acceptance_v1` contém:

- versão, runtime ID, archive SHA-256 e worker SHA-256;
- identidade sanitizada dos physical gates;
- resultado separado de `qwen-fast` e `qwen-quality`;
- métricas estruturais do benchmark, sem texto;
- binding ao SHA-256 sanitizado do Craig original e contrato exato de cobertura: `4` tracks, `300 s` de duração de sessão e `1200 s` de áudio-trabalho por perfil;
- somente quando houver decode vazio:
  - track/window numéricas;
  - início/fim da janela;
  - quantidade de samples;
  - peak dBFS;
  - RMS dBFS;
  - thresholds usados;
- flags explícitas de privacidade.

Não contém `source_id`, nome de speaker, texto, transcript, áudio, worker path, path local, token ou Authorization.

## Interpretação

### `confirmed_near_digital_silence`

O ASR devolveu texto vazio e a janela inteira ficou em:

- peak `<= -84 dBFS`;
- RMS `<= -90 dBFS`.

A janela vira zero segmentos, sem forced alignment, mas continua contando para timeline, duração, progresso e checkpoint.

### `empty_recognition_with_signal`

O ASR devolveu vazio, porém peak ou RMS ultrapassou o limite conservador.

O worker termina com:

```text
QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN
```

e o receipt preserva somente a evidência numérica sanitizada. Esse resultado **não é silêncio**. Evidência física no Craig original mostrou que retries por boundary/trim/subdivisão do mesmo `qwen-fast` não recuperam de forma confiável e podem até produzir texto espúrio sobre silêncio digital. Portanto `QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN` permanece fail-closed. Se o perfil solicitado for `qwen-fast`, a recuperação de produto é explícita: reenviar a mesma sessão como um novo job `qwen-quality`, preservando profile/model provenance em vez de misturar modelos dentro do mesmo run.

### `empty_condition_not_reproduced`

O perfil concluiu os 300 s sem encontrar decode vazio. A correção continua validada quanto aos invariantes sintéticos, mas o root cause histórico não foi reobservado naquele perfil.

### `other_failure`

Falha diferente. Registrar o código e tratar separadamente; não reclassificar como silêncio.

## Flags finais

- `candidate_completed_both_profiles=true`: Fast e Quality terminaram os 300 s sem outcome contraditório e com cobertura exata de 4 tracks / 1200 s de áudio-trabalho.
- `diagnostic_complete=true`: cada perfil terminou com outcome válido ou produziu o diagnóstico explícito esperado para vazio com sinal; um evento de rejeição seguido indevidamente por resultado terminal continua fail-closed.
- `stable_promotion_eligible=true`: ambos terminaram e este gate ficou completo.

`stable_promotion_eligible` significa apenas que **o gate de #1236** deixou de bloquear o candidato. Não substitui os demais receipts/gates de release do Companion/Qwen e não autoriza promoção isoladamente.

## Gate complementar — full transcription, retry e run imutável

> **Transição de candidato:** o wrapper exato abaixo continua fixado ao RC `1.0.13` até que o pacote formal `1.0.14` seja produzido após o merge desta correção e seus manifests/hashes públicos possam ser fixados sem placeholders. O wrapper antigo não é evidência de fechamento para o `1.0.14`; um follow-up deve relocká-lo ao novo RC antes do próximo aceite físico.

O benchmark de 300 s usa `benchmark_sample_seconds` e, por desenho, **não grava run imutável nem checkpoint normal**. Portanto ele cobre o defeito de empty-window, mas não fecha sozinho o critério de full transcription/recovery da issue.

Depois que o gate de 300 s estiver compreendido, execute o gate complementar com o ZIP privado original ainda local:

```powershell
.\tools\acceptance\run-qwen-1236-full-recovery.ps1 `
  -CraigZip "<caminho-local-do-craig-original.zip>"
```

Este wrapper é travado em:

- source candidato `bb9b0a96fc30dde1837d9f9d6b5c49467362f9c1`;
- Companion RC `0.3.18`;
- Qwen Runtime RC `1.0.13`;
- Craig SHA-256 `b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e`.

Ele baixa somente os manifests públicos pequenos dos RCs e confere seus SHA-256 fixados. Não instala nem promove nada. Os bytes exatos do Companion 0.3.18 e Qwen 1.0.13 já precisam estar instalados localmente; caso contrário o gate retorna `BLOCKED`.

O gate reutiliza `run-qwen-recovery-physical-gate.ps1` em scratch isolado e exige:

1. ingest do Craig exato com quatro tracks;
2. preparação física de `qwen-fast` e `qwen-quality`;
3. `qwen-fast` iniciando no worker real e aceitando cancelamento limitado;
4. `qwen-quality` persistindo checkpoint da track 1;
5. hard crash do Agent;
6. recuperação do job como `PROCESS_INTERRUPTED` recuperável;
7. retry em novo attempt sem perder o checkpoint já durável;
8. conclusão da transcrição completa;
9. `run.json` imutável e hash do `transcript.json` batendo com o resultado;
10. validação do transcript persistido pelo `TranscriptDocument` canônico do produto;
11. source SHA, perfil, quatro track numbers, hashes de track, `audio_work_seconds`, `session_duration_seconds`, contagens de segments/words e `duration_semantics=session_extent_v1` coerentes entre transcript e manifest.

A validação estrutural gera `qwen-quality-full-run-structure.json` apenas com hashes, números, durações e contagens. Não copia texto, speaker, áudio, path local ou token. O pacote final de evidência também permanece sanitizado: eventos mantêm somente campos estruturais allowlisted e podem preservar diagnósticos não textuais de janela/checkpoint/alignment (por exemplo `start_seconds`, `end_seconds`, contagens duráveis/reutilizadas, `sample_count`, `peak_dbfs`, `rms_dbfs`, thresholds de silêncio, `failure_class` e limites temporais); `speaker`, texto/transcript e paths continuam excluídos. Logs omitem a `message` textual livre e o leak-check rejeita token, nome do ZIP e o caminho privado completo, inclusive quando escapado em JSON.

Esse gate pode demorar porque o Quality precisa concluir o Craig real inteiro depois do retry. Isso é intencional: o critério de full transcription não deve ser inferido a partir do benchmark curto. O Fast continua coberto separadamente pelo contrato fail-closed/actionable de `QWEN_ASR_EMPTY_SIGNAL_UNCERTAIN`.

## Rollback

O `1.0.14` é o novo candidato imutável. O `1.0.13` permanece como candidato anterior rejeitado pelo full-recovery real; nenhum dos dois pode ter assets ou tags sobrescritos.

Enquanto o novo candidato estiver em aceite:

- `1.0.12` permanece o rollback Stable conhecido;
- o mínimo compatível do Companion permanece `1.0.12`;
- falha do `1.0.14` impede a promoção;
- rollback local deve restaurar os bytes verificados de `companion-qwen-runtime-v1.0.12` e o seletor `current.json` correspondente.

Depois de qualquer rollback, revalidar os physical gates porque eles são vinculados ao archive/worker/model/aligner exatos.

## Critério de fechamento de #1236

### Investigação atual — #1570, 07/10/2026

No runtime 1.0.18, RTX 4070 Laptop, o Fast rejeitou saída vazia na janela
54–114 s da primeira track do benchmark de 300 s. A recuperação limitada no
mesmo perfil também retornou vazia. Uma execução diagnóstica isolada com ganho
controlado de 32× manteve `QWEN_ACCEPTANCE_NO_SPEECH_RECOGNIZED`; esse resultado
não estabelece ausência de fala e não autoriza relaxar os limiares de silêncio.
Áudio, textos e evidências privadas permanecem fora do Git.

A decisão de produto é oferecer recuperação explícita da sessão com Quality,
preservando ZIPs e histórico e criando jobs com identidade própria. O benchmark
Fast original permanece parcial, sem substituição oculta de modelo. A
classificação editorial da janela e a repetição física dos quatro perfis ainda
não foram confirmadas; o caminho de recuperação não é prova de precisão Fast.

A issue só pode ser encerrada quando a evidência física do Craig original for anexada de forma sanitizada e os critérios da própria issue estiverem cobertos. CI verde e regressões sintéticas, sozinhos, não estabelecem o conteúdo/sinal da janela real que falhou originalmente.
