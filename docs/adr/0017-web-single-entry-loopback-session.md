# ADR-0017 — Web como entrada única do processamento e sessão loopback automática

> Status: accepted
> Data: 2026-09-19
> Owner: local-companion / processing
> Relacionados: ADR-0003, ADR-0007, ADR-0013, ADR-0016, `docs/features/local-processing.md`, `docs/integrations/local-companion-v1.md`

## Contexto

O Companion 0.3.x passou a oferecer dois caminhos visíveis para iniciar a mesma transcrição Craig:

1. `/edit/processamento` no TDA Web;
2. a tela **Processar sessão** no aplicativo Desktop.

Os dois caminhos escolhiam ZIP, perfil, contexto/glossário e submetiam o mesmo `transcription.craig` ao Agent. O storage corretamente recusava trabalho concorrente equivalente, mas a UX apresentava duas portas de entrada e deixava incerto qual superfície era a autoridade.

O pareamento Web também exigia copiar manualmente o token mestre do Desktop para a página. Isso protegia o segredo, mas transformava uma credencial de implementação em tarefa recorrente do usuário. Como o Agent já limita transporte a `127.0.0.1`, valida Host e permite apenas Origins explícitas, é possível oferecer bootstrap automático sem entregar o token mestre ao navegador.

Durante aceitação física do Qwen também foi observado outro caso de falsa imobilidade: depois do gate/runtime rápido, o worker relia e calculava SHA-256 de todas as faixas Craig já verificadas no ingest. Em uma sessão de ~673 MB isso mantinha GPU ociosa e o estado aparente em validação por minutos, apesar de o worker continuar emitindo heartbeat.

## Decisão

### 1. TDA Web é a única entrada de produto para nova transcrição

A responsabilidade fica explícita:

| Superfície | Responsabilidade |
| --- | --- |
| **TDA Web / Edit** | selecionar ZIP, sessão/campanha, perfil, contexto e glossário; criar/cancelar/repetir jobs; acompanhar fila e resultado; revisão/publicação |
| **Agent** | loopback API, fila persistida, workers, staging, runtimes/modelos, checkpoints, telemetria e resultado local |
| **Companion Desktop** | saúde do Agent, execução local, fila/telemetria, logs, diagnóstico, runtimes, update/uninstall e configurações da máquina |

O Desktop não apresenta um segundo formulário editorial de ZIP/perfil. A tela **Execução local** é somente observabilidade/controle da máquina e encaminha novas sessões ao TDA Web.

Esta decisão reforça, e não substitui, a frase do ADR-0013: **a Web é o lugar principal para sessões e o Desktop não replica o Edit**.

### 2. Conexão do navegador é automática quando o Agent está aberto

`GET /api/v1/health` continua público e mínimo.

É adicionado `POST /api/v1/session`, permitido somente quando:

- Host é exatamente o loopback esperado;
- `Origin` pertence à allowlist do Agent;
- request usa JSON e passa CORS/Private Network Access.

O endpoint emite um token aleatório temporário:

- existe somente em memória do processo Agent;
- é armazenado internamente apenas como SHA-256;
- é vinculado à Origin exata que o criou;
- expira em horas, não é refresh token;
- deixa de valer quando o Agent reinicia;
- nunca substitui nem expõe o token mestre persistido.

Endpoints privados aceitam o token mestre para clientes nativos/técnicos ou a sessão temporária quando a Origin corresponde.

O site faz:

```text
health público
  -> POST /session
  -> Bearer temporário
  -> capabilities/jobs/system/events
```

Não há token em cookie, localStorage, sessionStorage, URL, log ou cloud.

### 3. Se o Companion estiver fechado, a UX pede para abri-lo

O MSI registra o protocolo por usuário:

```text
tda-companion://open
```

A tela Web pode oferecer **Abrir TDA Companion** por ação explícita do usuário e depois tentar o bootstrap novamente. Se o navegador bloquear protocolo externo, a tela continua com **Tentar novamente** e instrução direta.

Não há scanning de portas, LAN discovery ou dependência do computador para disponibilidade do site.

### 4. Ingest é o boundary criptográfico das faixas; execução usa validação barata

O ingest Craig continua:

- calculando identidade do ZIP;
- extraindo em staging seguro;
- registrando SHA-256/tamanho de cada faixa;
- rejeitando archive/path inválido.

Uma execução normal posterior não relê centenas de MB apenas para recalcular os mesmos hashes. O worker valida manifesto, paths permitidos e tamanhos com `verify_tracks=false`.

Full SHA-256 permanece disponível nos boundaries em que confiança criptográfica é necessária: ingest, verificação profunda/diagnóstico e futuras operações de publicação que confiem nos bytes.

A UX recebe imediatamente `source_validation`; heartbeats atualizam `updated_at` silenciosamente para mostrar liveness real sem poluir o event log.

### 5. Cancelamento forçado continua sendo cancelamento

Quando o usuário cancela um job, o supervisor solicita cancelamento cooperativo. Código nativo/CUDA pode não retornar ao loop Python dentro da janela curta. Após o grace period, o worker isolado pode ser encerrado.

Esse caso é terminal **cancelled**, com warning técnico `WORKER_CANCEL_FORCED`, e não uma falsa falha `WORKER_CANCEL_TIMEOUT`.

## Consequências

### Positivas

- uma única UX decide o que processar;
- Desktop e Web deixam de concorrer pelo mesmo trabalho;
- recarregar a página não exige copiar segredo;
- token mestre nunca precisa aparecer no fluxo normal;
- Agent fechado gera uma instrução simples em vez de formulário técnico;
- sessões grandes deixam de pagar rehash integral em todo dispatch;
- liveness do worker fica visível mesmo antes de CPU/GPU subir;
- cancelamento de worker preso em código nativo não aparece como falha do ASR.

### Custos e limites

- browser session aumenta o contrato local e exige testes de Origin/TTL;
- custom URL protocol adiciona uma integração de registro ao MSI;
- metadata/path/size no fast path não substitui hash criptográfico contra um atacante local capaz de preservar metadata; deep verification continua sendo o mecanismo de confiança forte;

## Não decisões

- não expor o Agent na LAN;
- não enviar áudio ou token ao cloud;
- não criar login separado no Companion;
- não transformar o Desktop em editor de sessão;
- não promover Stable sem gate físico do RC correspondente.
