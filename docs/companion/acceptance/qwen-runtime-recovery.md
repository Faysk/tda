# Aceite físico — recovery do Qwen Runtime no Benchmark

> Issue: #1210  
> Status: gate de aceite físico implementado; execução real pendente  
> Owner: Processing / Companion  
> Última revisão: 2026-10-01  
> Escopo: provar em Windows real o ciclo **runtime Qwen incompatível → Stable oficial → readiness 4/4** sem áudio/transcript.

## Objetivo

Este aceite fecha a lacuna entre os testes sintéticos da Web/Companion e a evidência física exigida pela #1210.

Ele **não** mede qualidade ASR e **não** substitui o aceite físico completo do Companion. O objetivo é provar somente o recovery de runtime/readiness:

1. Production Web está publicada;
2. Companion instalado é a versão esperada;
3. Qwen Fast e Qwen Quality começam bloqueados por incompatibilidade de runtime/alignment;
4. o Agent confirma Stable oficial compatível;
5. uma única atualização explícita é iniciada pelo Companion;
6. o runtime ativo passa a atender ao mínimo;
7. capabilities são recalculadas;
8. Qwen Fast e Qwen Quality ficam prontos se não houver outro gate;
9. receipt não contém token, paths, áudio ou transcript.

## Harness

Arquivo:

`tools/acceptance/qwen_runtime_recovery.py`

O harness usa somente stdlib Python e conversa com:

- Agent local em `127.0.0.1`;
- `https://dnd.faysk.dev/api/version`.

O pairing token é lido localmente apenas para autenticar o Agent. Ele **não** é impresso nem persistido no receipt.

O update só ocorre quando o operador fornece explicitamente:

`--confirm UPDATE`

## Pré-condições

- Windows real com TDA Companion **0.3.17** instalado;
- Agent local ativo;
- Production Web acessível e identificável **antes de qualquer mutação local**;
- Qwen Runtime realmente incompatível: versão abaixo de `1.0.12`, versão não identificável ou instalação verificavelmente reparável;
- Stable oficial `1.0.12` disponível;
- nenhum job/preparation ativo;
- gates físicos locais necessários para Qwen já existentes; caso contrário o harness deve falhar em `QWEN_RECOVERY_FINAL_QWEN_NOT_READY` em vez de declarar sucesso falso.

Não fazer downgrade artificial somente para fabricar evidência se o ambiente já foi corrigido por outro caminho. O harness não exige que a máquina esteja especificamente em `1.0.11`: versão desconhecida e repair da mesma `1.0.12` só são aceitos quando o blocker reportado pertence à família de runtime da #1210 e o Companion confirma uma operação oficial compatível. Se o ambiente já estiver pronto, a reprodução inicial deixou de existir e deve ser documentada como tal.

## Execução

Na raiz do checkout:

```powershell
python tools/acceptance/qwen_runtime_recovery.py --confirm UPDATE
```

Defaults do contrato da #1210:

- port: `8765`;
- origin: `https://dnd.faysk.dev`;
- Companion: `0.3.17`;
- mínimo Qwen: `1.0.12`;
- Stable esperada: `1.0.12`.

Parâmetros podem ser sobrescritos somente quando a evidência justificar:

```powershell
python tools/acceptance/qwen_runtime_recovery.py `
  --confirm UPDATE `
  --port 8765 `
  --expected-companion-version 0.3.17 `
  --minimum-version 1.0.12 `
  --expected-stable-version 1.0.12
```

## Receipt

Default:

`%LOCALAPPDATA%\TDA\State\acceptance\qwen-runtime-recovery\qwen-runtime-recovery.json`

O receipt contém somente:

- commit/release da Production observada;
- versão/API do Companion;
- contrato mínimo/Stable;
- readiness de `qwen-fast` e `qwen-quality` antes/depois;
- snapshot sanitizado do runtime antes/depois;
- provas explícitas de privacidade.

Flags obrigatórias:

```json
{
  "contains_token": false,
  "contains_paths": false,
  "contains_audio": false,
  "contains_transcript": false
}
```

## Falha fechada

O harness não declara PASS nos seguintes casos:

- Companion diferente do esperado;
- Qwen já começa pronto e portanto o bloqueio original não foi reproduzido;
- mínimo informado pelo Agent diverge;
- Stable ausente ou abaixo do mínimo;
- `can_update` não é verdadeiro;
- update não conclui ou não é aceito;
- versão final não atende ao mínimo;
- qualquer Qwen continua não-ready;
- Production `/api/version` não pode ser validada;
- receipt contém marcador de token/path/áudio/transcript.

Códigos principais:

- `QWEN_RECOVERY_INITIAL_BLOCK_NOT_REPRODUCED`
- `QWEN_RECOVERY_STABLE_BELOW_MINIMUM`
- `QWEN_RECOVERY_STABLE_UNAVAILABLE`
- `QWEN_RECOVERY_UPDATE_NOT_OFFERED`
- `QWEN_RECOVERY_UPDATE_NOT_COMPLETED`
- `QWEN_RECOVERY_FINAL_QWEN_NOT_READY`
- `QWEN_RECOVERY_RECEIPT_PRIVACY_INVALID`

## Relação com Stable do Companion

Este receipt prova a #1210, mas **não** é o receipt v2 de promoção Stable do Companion.

A promoção `companion-rc-v0.3.17-...` continua exigindo:

- installed acceptance receipt;
- ASR physical acceptance receipt;
- identidade exata do MSI/payload;
- runtimes Stable fisicamente aceitos;
- workflow `Companion Promote Stable`.

Não reutilizar este receipt como atalho para promoção.

## Evidência de encerramento da #1210

Para fechar a #1210:

- PR #1211 em Production;
- CI/CodeQL/main verdes;
- Production CD verde;
- RC 0.3.17 publicado;
- harness acima retorna PASS em Windows real;
- receipt sanitizado anexado/registrado na issue;
- captura ou observação operacional confirma Benchmark `4 / 4 perfis prontos`;
- nenhum outro gate Qwen permanece bloqueando.

A evidência comprova recovery de runtime/readiness, não qualidade de transcrição.


## Physical validation on 2026-10-01

The installed official Companion RC 0.3.17 updated the real Qwen Runtime from 1.0.11 to Stable 1.0.12. The MSI SHA-256 was verified against the release asset before installation. The initial harness correctly refused success because the update invalidated GPU receipts (`QWEN_GATE_BINDING_CHANGED`). No downgrade was performed to recreate the initial state.

Both profiles were then prepared using an explicitly authorized local Craig archive (427,225,794 bytes). Qwen Fast and Qwen Quality completed their physical gates on NVIDIA GeForce RTX 4070 Laptop GPU, compute capability 8.9; the refreshed catalog reported all four profiles ready. This is not RTX 2080 evidence. Benchmark execution and final browser acceptance are separate gates.

Future initial recovery runs may pass `--preparation-source-id craig-<sha256>` for an already staged, explicitly authorized source. The harness prepares pending Qwen profiles after runtime update and checks readiness again; it never includes the source ID, audio or transcript in its receipt. Without that argument, missing GPU acceptance still fails rather than manufacturing success. The Web flow now points explicitly to source analysis/profile preparation after update.
