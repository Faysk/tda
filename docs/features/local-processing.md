# Processamento local no Edit

> Status: implementação candidata
> Owner: Processamento UI/adapters (Painelzinho); API/export local: Motorzinho; importação cloud: Carteiro
> Última revisão: 2026-09-11
> Fonte de verdade: `src/features/edit/processing`, `src/app/edit/processamento`, `local-companion/tda_companion` e testes associados

`/edit/processamento` é a superfície operacional para conexão com o TDA Companion, fila local, telemetria e eventos. O processamento pesado e os áudios permanecem no computador do usuário; o site cloud não depende do PC estar ligado para continuar disponível.

## Estado atual

O recorte atual entrega:

- workbench próprio do Edit;
- conexão explícita com `http://127.0.0.1:8765/api/v1`;
- fila local persistida;
- eventos estruturados para log;
- telemetria best-effort de CPU, RAM, GPU e VRAM;
- novo aplicativo Windows `TDACompanion.exe`;
- instalador `TDACompanion-x64.msi` por usuário;
- link estável no próprio Processamento para baixar a release mais recente do Companion.

Ainda **não é ASR real ponta a ponta**. O job HTTP executável continua sendo `synthetic.fixture`; o transcriber preservado será conectado ao supervisor em etapa própria. Sincronização/publicação cloud também permanece não configurada.

## Download e instalação

A tela de Processamento oferece uma ação compacta **Baixar TDA Companion** para Windows x64. O href fica sob controle do próprio TDA:

```text
/api/downloads/companion/windows
```

O resolver consulta as releases públicas do repositório, filtra apenas tags `companion-vX.Y.Z`, exige o asset `TDACompanion-x64.msi` e redireciona para a maior versão válida. Releases `prod-*` do site não entram nessa seleção.

Assim o frontend não precisa conhecer a versão atual nem depender de `/releases/latest` global do repositório.

O MSI instala em `%LOCALAPPDATA%\TDA\Companion`, mantém dados em `%LOCALAPPDATA%\TDA\Data` e cria atalho no Menu Iniciar. O antigo `DnDScribeCompanion.exe` não é usado, consultado ou modificado.

O MSI deste corte ainda não possui assinatura Authenticode configurada; a interface não deve afirmar que existe publisher assinado.

## Workbench de processamento

A tela segue a regra de que uma superfície operacional deve mostrar primeiro o trabalho. A primeira viewport prioriza:

1. computador local e estado da conexão;
2. CPU/RAM/GPU/VRAM quando conectadas;
3. resumo da fila;
4. trabalho em execução e progresso real;
5. próximos trabalhos e finalizados;
6. detalhes e log do trabalho observado;
7. estado de sincronização.

O título é compacto. A navegação própria do Edit é restrita a destinos de trabalho; o logo TDA é a saída intencional para a superfície pública.

O estado desconectado não deve inventar dados. Métricas desconhecidas usam `—`/estado vazio e o pareamento fica disponível. Quando conectado, o campo de pareamento deixa de dominar a tela e a faixa do computador passa a mostrar dados operacionais.

## Progresso e dados editoriais

A UI usa somente progresso que o companion realmente reporta. `completed/total/unit` pode ser convertido em porcentagem quando esses valores existem; ausência de medida não vira estimativa.

Antes da transcrição real chegar a 100%, a tela não inventa título, resumo, thumbnail ou classificação. Dados como duração, quantidade de arquivos, participantes, data e contagem de palavras entram quando a fonte real os fornecer.

Quando o ASR for conectado, o transcriber preservado já consegue fornecer contexto por track, incluindo `track`, `total_tracks`, `speaker` e `percent`. O engine atual processa tracks sequencialmente, então a interface não deve mostrar quatro arquivos avançando em paralelo quando isso não estiver acontecendo.

## Eventos e zueira

`GET /api/v1/jobs/{job_id}/events` fornece eventos factuais. A camada de apresentação pode adicionar comentários leves e engraçados, mas a telemetria original permanece separada.

Exemplos:

- `TRACK_PROGRESS` com speaker conhecido pode gerar uma segunda linha divertida sobre a voz daquele participante;
- redução de ruído só pode gerar piada sobre chiado se a etapa real existir;
- conversa ao fundo só aparece depois de uma detecção real;
- cachorro só aparece depois de um evento real correspondente.

O companion persiste fatos, não piadas. A interface nunca deve fingir que executou uma operação só para ficar engraçada.

## Telemetria

Quando `system.telemetry` é anunciada, a UI consulta `GET /api/v1/system` e recebe uma projeção limitada de SO, CPU, RAM e GPUs. CPU/RAM usam `psutil`; NVIDIA GPU/VRAM usam NVML através de `nvidia-ml-py`.

Ausência de GPU NVIDIA, driver incompatível ou falha do sensor resulta em telemetria parcial e não desconecta a fila.

## Pareamento e segurança

O painel começa desconectado e não sonda portas automaticamente. Após ação explícita, consulta health público mínimo, exige versão compatível e então usa o Bearer do pareamento em endpoints privados.

O token fica somente na memória da aba. Não há cookie, storage, query string, log ou envio cloud. Requests mantêm CORS, `credentials: omit`, `redirect: error`, `cache: no-store`, `referrerPolicy: no-referrer` e limites de payload/resposta.

O companion escuta somente loopback, exige Host correto, restringe Origin e não descobre outros PCs.

## Fila e ações

Falha recuperável/interrupção permite **Repetir trabalho**, sem prometer checkpoint exato. Cancelar exige confirmação. Retomar fila confirma que trabalhos pendentes podem voltar a executar; pausar impede novos claims sem interromper o trabalho já ativo.

O ensaio sintético existe apenas quando `synthetic.fixture` é anunciado e não usa áudio/modelo/GPU para produzir transcrição.

## Sincronização

A UI continua mostrando **Sincronização não configurada.** Conclusão local não significa envio, importação, revisão, canon ou publicação.

O handoff futuro permanece: artefato versionado → identidade server-side → autorização explícita → persistência durável → receipt consultável → revisão no Edit.

## Validação

Gates web:

```text
pnpm check
pnpm build
pnpm test:processing
```

Gates do Companion:

- pytest em Windows e Linux;
- build do wheel;
- build do `TDACompanion.exe`;
- build do `TDACompanion-x64.msi`;
- smoke do executável empacotado;
- instalação real do MSI no runner Windows;
- inicialização + health do app instalado;
- desinstalação real do MSI.

Esses testes não medem qualidade ASR, throughput do Whisper, diarização ou compatibilidade CUDA/modelo em uma GPU física.
