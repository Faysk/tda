# Companion local

> Status: base sintética implementada em branch/PR; ASR real legado preservado
> Owner: local-companion/processing
> Última revisão: 2026-09-07

## Base executável candidata

`local-companion/` entrega supervisor por usuário, fila SQLite, API autenticada e fixtures. Contrato dono: [API v1](local-companion-v1.md). Instalação, stack revalidada, inventário legado e gates de migração/rollback: [runbook](../operations/local-companion.md). Não há instalação, processamento real ou sync cloud realizado por este corte. Requisitos abaixo continuam sendo alvo de modernização onde o contrato v1 declara capacidade indisponível.

## Objetivo

Executar tarefas pesadas/local-only e sincronizar resultados com o TDA sem transformar o PC em servidor obrigatório para o site.

## Responsabilidades

- ingestão de fontes Craig/arquivos;
- inspeção/manifest;
- extração e preparação de áudio;
- detecção de silêncio/fala;
- transcrição;
- classificação/derivações pesadas quando apropriado;
- cache e accounting;
- sincronização de resultados/metadados;
- cleanup local conforme retenção.

## Não responsabilidades

- servir o site público;
- decidir canon automaticamente;
- ser banco canônico;
- guardar secret administrativo irrestrito distribuído a qualquer máquina;
- obrigar que o PC fique ligado para consultar conteúdo já sincronizado.

## Princípio de modernização

Preservar o fluxo que funciona e medir antes de reescrever.

Baseline deve incluir:

- qualidade de transcrição;
- tempo;
- VRAM/RAM;
- uso CPU/GPU;
- tamanho de intermediários;
- custo externo;
- taxa de retry/falha.

## Contrato futuro de sync

O [consumer de importação versionado](transcript-import.md) define o primeiro candidato de transporte, validação e recibo durável. A ativação continua negada até os gates documentados.

Cada operação deve carregar suficiente identity/provenance para idempotência:

- campaign/session;
- source IDs/hashes;
- run/job ID;
- schema/protocol version;
- tipo de payload;
- checksum quando útil.

Servidor deve confirmar acceptance e rejeitar scope inválido.

## Auth

Companion é actor técnico. Preferir credencial própria com capabilities limitadas em scope de integração/projeto.

Não embutir service role ampla em pacote redistribuível.

## Offline

O companion pode processar localmente sem conectividade em etapas que não exigem API externa. Sync pendente deve ser retomável posteriormente.

## Queue/retry

- fila persistente;
- exponential/backoff razoável;
- retries idempotentes;
- failed state visível;
- ação manual de retry/cancel quando necessário;
- não perder job ao reiniciar processo.

## Atualização/distribuição

Feature futura precisa definir:

- versão do companion;
- compatibilidade de protocolo;
- mecanismo de update;
- assinatura/hash de pacote;
- rollback;
- migração de config/cache;
- capability de distribuição já existente no histórico de RBAC.

## Filesystem local

Separar:

- source/raw;
- work/temp;
- cache;
- outputs persistentes;
- logs;
- config/secrets.

Não usar paths absolutos pessoais como contrato do projeto.

## Privacy

Raw audio/transcript local pode conter informação sensível. Logs não devem despejar transcript completo ou secrets por padrão.

## Observabilidade

Companion deve expor localmente:

- versão;
- health;
- queue size;
- jobs ativos/falhos;
- etapa/progresso;
- última sync;
- uso/custo de provider;
- espaço de disco/cleanup quando relevante.

## Compatibilidade com schema

Antes de enviar payload novo, companion e servidor precisam negociar/validar versão. Mudança de schema remoto não deve quebrar silenciosamente uma versão local antiga.

## Failure modes

### App/PC reinicia

Jobs retornam de estado persistido.

### Supabase indisponível

Resultados locais permanecem pendentes de sync.

### Provider de transcrição falha

Retry/alternativa sem duplicar transcript remoto.

### Schema/protocol mismatch

Bloquear sync incompatível e informar upgrade necessário.

### Disco cheio

Parar criação de intermediários com erro explícito antes de corromper fonte.

## Critério de pronto da modernização

- ingest real funciona sem comandos manuais frágeis;
- processing é retomável;
- sync autenticado/idempotente;
- PC desligado não afeta site já sincronizado;
- secrets mínimos;
- qualidade/tempo/memória medidos;
- cleanup seguro;
- distribuição/versionamento documentados.
