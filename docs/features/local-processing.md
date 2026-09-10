# Processamento local no Edit

> Status: preparado / implementação candidata
> Owner: Processamento UI/adapters (Painelzinho); API/export local: Motorzinho; importação cloud: Carteiro
> Última revisão: 2026-09-10
> Fonte de verdade: `src/features/edit/processing`, `src/app/edit/processamento`, `local-companion/tda_companion` e testes associados

A evolução corrente está na branch `codex/processing-workbench-v2`. O recorte transforma `/edit/processamento` em uma superfície operacional compacta, adiciona telemetria local best-effort e expõe eventos estruturados do companion para o log da interface. **Ainda não é transcrição ASR completa, instalação Windows, sincronização cloud ou publicação.** O job HTTP executável continua sendo `synthetic.fixture`; o ASR preservado permanece uma referência de integração para a próxima etapa.

## Contratos e ownership

- [Fluxos de dados](../architecture/data-flows.md), [domínio de processamento](../domains/processing.md) e [companion](../integrations/local-companion.md) preservam site/Edit cloud e áudio/processamento pesado local.
- API do companion permanece em `/api/v1`, versão wire `"1"`, destino fixo `http://127.0.0.1:8765/api/v1`; não há URL arbitrária, proxy cloud nem descoberta de outros PCs.
- `/edit/processamento` continua protegido por `requireCapability(EDIT_CAPABILITIES.localProcess)` e pela action `campaign.local.process` no scope permitido. O usuário Windows não concede autorização cloud e o token do companion é uma autorização local distinta.
- O Edit continua sendo um workbench dentro do mesmo Next.js e do mesmo Design System. A navegação própria do Edit é compacta; o logo TDA é a saída intencional para a superfície pública.
- Ler/editar transcrição, processar localmente, importar e publicar continuam capabilities distintas. Nenhuma nova grant, DDL de Supabase ou escrita em produção faz parte deste recorte.

## Workbench de processamento

A tela segue a diretriz de que uma superfície operacional deve mostrar primeiro o trabalho, não uma apresentação da página. O título é compacto e a primeira viewport prioriza:

1. conexão e recursos do computador local;
2. resumo da fila;
3. trabalho em execução e progresso real;
4. próximos trabalhos e concluídos recentes;
5. detalhes e log do trabalho observado;
6. estado de sincronização.

O pareamento ocupa espaço somente enquanto for necessário. Depois de conectado, a área vira uma faixa compacta com serviço, versão, sistema e ações operacionais. A fila diferencia trabalho ativo, aguardando, concluído e falha/interrupção sem transformar toda informação em cards grandes.

O progresso continua usando **somente** `completed/total/unit` aceito pelo protocolo. `null` significa ausência de medida; a UI não fabrica porcentagem, ETA, nome de participante, título de sessão, resumo ou artwork.

Antes de ASR real estar conectado, um `synthetic.fixture` é apresentado como ensaio sintético. Informações editoriais que normalmente nascem depois da transcrição — título narrativo, resumo, classificação e imagem — não são inventadas na fase técnica.

## Shell do Edit

O nested layout de `/edit` agora possui uma navegação de workbench própria. A superfície pública continua existindo no root app, mas seu header/footer são removidos da composição visual quando o subtree do Edit está ativo. Dentro do workbench, o logo oficial TDA aponta para `/` e é a única navegação deliberada para o site público.

A rail inicial contém apenas destinos que já existem no reboot: Sessões, Processamento e Mundo. Não são criadas rotas fictícias para reproduzir mockups. Em telas menores, a rail se converte em uma barra horizontal compacta para preservar largura de trabalho.

## Telemetria do computador local

Quando o companion anuncia `system.telemetry`, a UI consulta `GET /api/v1/system` junto da atualização normal do painel. O endpoint é autenticado e retorna somente uma projeção operacional limitada:

```json
{
  "sampled_at": "2026-09-10T20:00:00Z",
  "host": {
    "os": "Windows 11",
    "cpu": "Intel Core i7-14700HX"
  },
  "cpu": { "utilization_percent": 32.0 },
  "memory": {
    "used_bytes": 19327352832,
    "total_bytes": 68719476736,
    "percent": 28.1
  },
  "gpus": [
    {
      "index": 0,
      "name": "NVIDIA GeForce RTX 4070 Laptop GPU",
      "utilization_percent": 78,
      "memory_used_bytes": 6871947673,
      "memory_total_bytes": 8589934592
    }
  ]
}
```

CPU/RAM usam `psutil`; NVIDIA GPU/VRAM usam NVML através de `nvidia-ml-py`. O sampler não envia hostname, path, token, áudio ou conteúdo transcrito. NVML é opcional em runtime: ausência de GPU NVIDIA, driver indisponível ou erro de sensor produz lista de GPUs vazia e **não torna a fila indisponível**.

O mesmo isolamento existe no browser: falha de `/system` apenas remove a projeção de telemetria daquela leitura. Health, capabilities e jobs continuam sendo a fronteira que decide se o serviço está conectado.

## Eventos e log operacional

`GET /api/v1/jobs/{job_id}/events` já era uma fronteira do companion. O schema local de eventos evolui para uma forma aditiva e estruturada:

```json
{
  "seq": 32,
  "code": "TRACK_PROGRESS",
  "at": "2026-09-10T20:14:18Z",
  "level": "info",
  "data": {
    "track": 1,
    "total_tracks": 4,
    "speaker": "Yuhara",
    "percent": 82
  }
}
```

A tabela SQLite local `events` passa de `seq/job_id/code/at` para também aceitar `level` e `data`. A abertura de uma base v1 migra aditivamente para `user_version=2`; jobs existentes não são descartados. Os eventos sintéticos já registram contexto factual de fila, tentativa e unidades concluídas.

O painel observa prioritariamente o job em execução, depois um job aguardando e por fim o mais recente. Se `job.events` estiver disponível, carrega até os eventos validados pelo protocolo e apresenta o histórico em uma região `role="log"`.

### Zueira sem telemetria falsa

O companion persiste **fatos**, não frases engraçadas. A camada `presentation.ts` pode anexar uma mensagem leve a códigos conhecidos, sem alterar o fato original.

Exemplos permitidos somente quando o evento correspondente existir:

- `TRACK_PROGRESS` com `speaker=Yuhara` → “A voizinha de Yuhara está rendendo serviço hoje 👀”;
- `NOISE_REDUCTION_PROGRESS` → comentário sobre chiado somente porque redução de ruído está realmente ocorrendo;
- `BACKGROUND_SPEECH_DETECTED` → comentário sobre conversa ao fundo somente após detecção real;
- `DOG_BARK_IGNORED` → comentário sobre cachorro somente após esse evento real.

A UI **não** pode emitir “removendo chiado”, “ignorando cachorro”, “família falando ao fundo” ou equivalentes apenas para entretenimento. Se o pipeline não reportou a atividade, ela não aconteceu para fins de interface.

## Relação com o ASR preservado

`local-companion/tda_companion/legacy/transcriber.py` já possui `progress_update` com eventos úteis para a próxima integração: verificação/download/carregamento do modelo, fallback CUDA, retomada de checkpoint, `track`, `total_tracks`, `speaker`, `percent` e conclusão.

Esse transcriber processa tracks sequencialmente. Portanto a UI final deve representar, por exemplo:

```text
✓ Fehh       concluído
● Yuhara     transcrevendo · 82%
○ Noah       aguardando
○ Allya      aguardando
```

Não mostrar quatro barras avançando em paralelo quando o engine está executando uma track por vez.

A próxima etapa de backend é adaptar esse callback para o supervisor moderno e para eventos estruturados, criando um job real de transcrição sem tornar o módulo legado a arquitetura normativa.

## Comportamento e segurança preservados

O painel começa desconectado e não sonda portas automaticamente. Após ação explícita, consulta health público mínimo, exige versão compatível e só então envia o bearer de pareamento para endpoints autenticados.

Enquanto conectada e visível, a aba atualiza em ciclo de três segundos, sem chamadas concorrentes. Ocultar a aba suspende a atualização; voltar consulta novamente. Desconectar aborta requests e respostas tardias, limpa token e projeções da tela, mas não cancela jobs persistidos.

Token manual URL-safe fica somente na memória, sem cookie, storage, query string, log ou envio cloud. Requests mantêm CORS, `credentials:omit`, `redirect:error`, `cache:no-store`, `referrerPolicy:no-referrer`, limite de resposta e validação de IDs. O companion continua exigindo Host loopback, Origin autorizada e bearer em todas as rotas privadas.

Falha recuperável/interrupção permite **Repetir trabalho**, sem prometer checkpoint exato. Cancelar exige confirmação. **Retomar fila** confirma que trabalhos pendentes podem voltar a executar; pausar impede novos claims sem interromper o trabalho ativo.

O ensaio sintético continua disponível apenas quando a capability `synthetic.fixture` é anunciada e o lifecycle está pronto. Ele não usa áudio, modelo ou GPU para produzir transcrição.

## Sincronização

Resultados continuam validados por versão, job ID e identidade do pacote. A UI retém somente a projeção necessária. Este recorte continua mostrando **Sincronização não configurada.** Conclusão local não significa envio, importação, revisão, canon ou publicação.

O próximo contrato de handoff permanece: artefato versionado → identidade server-side → autorização explícita de importação → persistência durável → receipt consultável → leitura/revisão no Edit.

## Validação

Comandos de gate do repositório:

```text
pnpm check
pnpm build
pnpm test:processing
```

O companion é validado em Windows e Linux pelo workflow `.github/workflows/companion.yml`. A branch adiciona testes específicos para autenticação/forma da telemetria, migração SQLite v1→v2, eventos estruturados e apresentação de GPU/VRAM + log factual no harness do painel.

**Estado desta revisão:** código em branch candidata; CI/PR ainda são a evidência necessária antes de declarar o recorte validado, integrado à `main` ou publicado.

Os testes deste marco não medem qualidade ASR, throughput real de Whisper, precisão de diarização, retomada de uma transcrição pesada nem desempenho de uma GPU física. Nenhum áudio pessoal, deployment, grant, DDL de Supabase ou publicação faz parte da entrega.
