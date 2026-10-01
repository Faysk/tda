# Aceite físico — Qwen empty-window #1236

> Issue: #1236  
> Owner: local-companion / processing  
> Última revisão: 2026-10-01  
> Status: harness implementado; execução física no Craig original ainda pendente  
> Runtime candidato: Qwen `1.0.13`  
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
2. runtime Qwen candidato exato `1.0.13` instalado localmente;
3. os gates físicos de `qwen-fast` e `qwen-quality` refeitos para os bytes exatos do `1.0.13`;
4. Craig original ainda staged em `%LOCALAPPDATA%\TDA\Data\staging`; o gate exige exatamente o source content-addressed por `b2ac78347d88b2761e51be38a60aa266933e3b00f30e72c50626fbe599849b1e`;
5. nenhum job concorrente usando a GPU/runtime;
6. ambiente Python do `local-companion` disponível para executar o harness.

O gate falha antes de iniciar ASR se o source não for exatamente o Craig que reproduziu #1236, se o runtime ativo não for exatamente `1.0.13`, se o worker não bater com seu hash, ou se qualquer physical gate estiver stale. A versão esperada é parte do contrato versionado do harness e não pode ser sobrescrita por flag de linha de comando; um candidato futuro exige atualização explícita do código/documento.

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

e o receipt preserva somente a evidência numérica sanitizada. Esse resultado **não é silêncio e não autoriza Stable**. Ele estabelece uma causa recuperável/específica para a janela observada sem esconder possível fala.

### `empty_condition_not_reproduced`

O perfil concluiu os 300 s sem encontrar decode vazio. A correção continua validada quanto aos invariantes sintéticos, mas o root cause histórico não foi reobservado naquele perfil.

### `other_failure`

Falha diferente. Registrar o código e tratar separadamente; não reclassificar como silêncio.

## Flags finais

- `candidate_completed_both_profiles=true`: Fast e Quality terminaram os 300 s sem outcome contraditório e com cobertura exata de 4 tracks / 1200 s de áudio-trabalho.
- `diagnostic_complete=true`: cada perfil terminou com outcome válido ou produziu o diagnóstico explícito esperado para vazio com sinal; um evento de rejeição seguido indevidamente por resultado terminal continua fail-closed.
- `stable_promotion_eligible=true`: ambos terminaram e este gate ficou completo.

`stable_promotion_eligible` significa apenas que **o gate de #1236** deixou de bloquear o candidato. Não substitui os demais receipts/gates de release do Companion/Qwen e não autoriza promoção isoladamente.

## Rollback

O `1.0.13` é candidato imutável. Não substituir assets ou tag em caso de falha.

Enquanto o candidato estiver em aceite:

- `1.0.12` permanece o rollback Stable conhecido;
- o mínimo compatível do Companion permanece `1.0.12`;
- falha do `1.0.13` impede a promoção;
- rollback local deve restaurar os bytes verificados de `companion-qwen-runtime-v1.0.12` e o seletor `current.json` correspondente.

Depois de qualquer rollback, revalidar os physical gates porque eles são vinculados ao archive/worker/model/aligner exatos.

## Critério de fechamento de #1236

A issue só pode ser encerrada quando a evidência física do Craig original for anexada de forma sanitizada e os critérios da própria issue estiverem cobertos. CI verde e regressões sintéticas, sozinhos, não estabelecem o conteúdo/sinal da janela real que falhou originalmente.
