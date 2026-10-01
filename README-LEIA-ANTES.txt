TDA — PACK DE ACEITE FÍSICO / RECOVERY
======================================

PACK VERSION
------------

v2.0.3

Correções acumuladas:
- saída escalar do Git no PowerShell 7;
- regex ProductCode do helper oficial corrigida SOMENTE na cópia isolada de teste.

Correção anterior:
  System.Char does not contain a method named 'Trim'

Causa:
PowerShell "desembrulha" arrays de uma linha. O resultado de `git rev-parse`
virava String; aplicar [-1] nele selecionava o último caractere do SHA.

Correção:
os retornos Git usados como listas agora são explicitamente envolvidos por @(...)
e convertidos para String antes de Trim().

O primeiro teste que falhou parou antes de buscar o helper, instalar o Companion
ou iniciar qualquer aceite físico.


NOVO NO v2.0.3
--------------

O teste físico anterior revelou que o helper oficial do #455 possui um regex
ProductCode sobre-escapado e rejeita GUIDs MSI normais com chaves.

Este pack:
1. valida o SHA exato do helper #455;
2. extrai os scripts para _harness;
3. calcula o hash original;
4. corrige SOMENTE a linha do regex na cópia isolada;
5. calcula o hash corrigido;
6. grava OPERATIONAL-HARNESS-PATCH.txt no ZIP de evidência;
7. não altera nenhum arquivo do seu checkout Git.


ALVO DESTE PACK
---------------

Este pack cobre o gate que depende da sua máquina Windows + RTX 4070 para a issue #437:

- instalação/verificação do RC exato;
- identidade/hash do MSI e payload;
- lifecycle e recovery do Agent;
- conflito de porta 8765;
- Diagnóstico da UI;
- retomada BITS medida usando o MESMO job;
- Craig ZIP sintético;
- persistência da seleção Craig após queda/recovery do Agent;
- preparação dos quatro perfis;
- ASR físico em:
  * whisper-turbo
  * whisper-detailed
  * qwen-fast
  * qwen-quality
- GPU/driver/runtime/model identity;
- receipts instalados e físicos sanitizados.

CANDIDATO EXATO
---------------

RC:
  companion-rc-v0.3.14-1585a93235ba

Source SHA:
  1585a93235ba2fe7c2c093ef1683f0beca5d1605

MSI SHA-256:
  83c267ae14f10fda950413cab74394fc7b875225fa0e13f5123c8901f609f8c3

Payload manifest SHA-256:
  bc6ac20dbac3e0d9a31ff1cc3ff8a09e8e5b455cb644bcea00fe45f80bd34312

Harness operacional fixado:
  PR #455 head
  36c721687d78439670db62dc29b7d99c1da759c3


ANTES DE RODAR
--------------

1. Use o PC com RTX 4070.
2. Tenha Internet funcionando.
3. Tenha PowerShell 7 (pwsh.exe).
4. Seu repo pode continuar exatamente em:
     G:\Project\tda
5. NÃO precisa dar git pull, checkout, reset ou limpar seu worktree.
   O runner busca apenas o ref do PR #455 e extrai os quatro scripts oficiais
   para uma pasta isolada de teste.
6. Feche trabalhos não salvos no Companion.
7. O teste pode instalar/remover RCs do Companion.
   O fluxo MSI preserva:
     State / Data / Logs / Cache / Models / Runtime


COMO RODAR
----------

Opção mais simples:

  1. Extraia este ZIP para qualquer pasta.
  2. Dê duplo clique em:
       RUN-ME.cmd

Ou pelo PowerShell 7:

  pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\RUN-ALL-TDA-ACCEPTANCE.ps1 -RepositoryPath "G:\Project\tda"


PARTES INTERATIVAS
------------------

AGENT RECOVERY
  Quando o teste pedir, finalize SOMENTE o processo Agent.
  O teste mede se um novo PID aparece e volta Ready.

  Se estiver em dúvida sobre os processos, rode em outro terminal:
    .\SHOW-TDA-PROCESSES.ps1


CONFLITO DA PORTA 8765
  Quando o harness pedir para ocupar a porta:

  1. deixe o Agent parado conforme instrução do harness;
  2. abra outro PowerShell 7;
  3. rode:
       .\START-PORT-8765-BLOCKER.ps1
  4. volte à UI e observe o conflito;
  5. depois volte ao blocker e pressione ENTER para liberar a porta;
  6. confirme que o Agent consegue voltar.


BITS RESUME
  O harness exige evidência real de UM job BITS TDA.

  - mantenha a Internet ligada inicialmente;
  - inicie no Companion um download GRANDE que ainda não esteja cacheado
    (preferencialmente runtime/modelo Qwen);
  - quando o harness detectar o job, ele pedirá para desligar a Internet;
  - NÃO clique novamente em prepare/install;
  - quando solicitado, religue a Internet;
  - o harness mede se o MESMO JobId retomou e avançou bytes.

  Para enxergar os jobs, se quiser:
    .\SHOW-TDA-BITS.ps1

  Se TODOS os runtimes/modelos já estiverem totalmente cacheados e não houver
  download pendente possível, NÃO apague modelos só para satisfazer o teste.
  Deixe o harness falhar e me mande o ZIP; tratamos essa evidência separadamente.


CRAIG
  O pack gera um Craig ZIP sintético. Não use áudio real.


ASR
  Depois da etapa instalada, o launcher exige os quatro perfis prontos.
  Se faltar algum, ele pedirá para preparar pela UI.

  Em seguida roda os quatro perfis com áudio SAPI sintético de ~80 s.
  TRANSCRIPTS NÃO SÃO GRAVADOS.


RESULTADOS
----------

Tudo fica em:

  G:\Project\tda\TDA-TEST-RESULTS\<data-hora>\

A pasta de trabalho completa contém downloads e o áudio sintético.

O arquivo para me enviar é criado automaticamente em:

  G:\Project\tda\TDA-TEST-RESULTS\TDA-ACCEPTANCE-RESULTS-<data-hora>.zip

MANDE SOMENTE ESSE ZIP.

Ele inclui:
- transcript do terminal;
- inventário Windows/GPU;
- estado Git;
- hashes do harness;
- health do Agent antes/depois;
- receipts JSON sanitizados;
- evidência BITS sanitizada, quando produzida;
- logs MSI relevantes;
- RESULT-SUMMARY.txt;
- EVIDENCE-MANIFEST.json.

Ele NÃO inclui:
- .env;
- tokens capturados deliberadamente;
- áudio privado;
- transcrição privada;
- downloads do MSI;
- áudio sintético usado no ASR.


SE DER ERRO
-----------

Não tente "ajeitar no braço" e repetir vinte coisas aleatórias.

O runner cria o ZIP mesmo quando falha.

Me mande o ZIP gerado e eu identifico exatamente em qual gate morreu.
