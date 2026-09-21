# Companion local

> Status: integração local vigente; ASR Craig real implementado; sync cloud desativado
> Owner: local-companion/processing
> Última revisão: 2026-09-21
> Fonte de verdade: `local-companion/tda_companion`, [protocolo local v1](local-companion-v1.md), [processamento local](../features/local-processing.md) e [runbook operacional](../operations/local-companion.md)

O TDA Companion é o runtime local do processamento pesado do Edit. Esta página é um **entrypoint curto**: contratos de API, lifecycle, distribuição, processamento e publicação pertencem aos documentos donos ligados acima e não devem ser duplicados aqui em snapshots que envelhecem separados do código.

## Estado vigente

A linha atual implementa:

- Agent local em loopback com API v1, sessão Web temporária origin-bound e fila persistente;
- aplicativo Desktop `TDACompanion.exe` e instalador Windows por usuário `TDACompanion-x64.msi`;
- ingest local e content-addressed de ZIP Craig;
- preparação de runtime/modelos e perfis `qwen-quality`, `qwen-fast`, `whisper-detailed` e `whisper-turbo`;
- job real `transcription.craig` em worker isolado quando o perfil está pronto;
- progresso/eventos, telemetria best-effort, cancel/retry e recuperação local;
- runs concluídos locais e imutáveis por source/job/attempt, sem transformar conclusão de ASR em publicação cloud;
- manutenção/update local com hashes e candidatos versionados.

`synthetic.fixture` continua existindo como fixture de teste, mas **não descreve mais o estado do produto** e não substitui o pipeline Craig real.

A arquitetura e os invariantes detalhados do Workbench ficam em [Processamento local no Edit](../features/local-processing.md). Wire contract, capabilities e segurança loopback ficam em [Companion — protocolo local v1](local-companion-v1.md). Instalação, upgrade, rollback e recuperação ficam no [runbook do Companion](../operations/local-companion.md).

## Limites deliberados

- **Sync/import cloud não está ativado.** O Companion anuncia `sync:false`; processamento concluído permanece local até um fluxo editorial explícito autorizado.
- O importador server-side existe como trabalho futuro/negado por padrão; não deve ser habilitado como atalho para “terminar” processamento.
- Revisão, canon e publicação são decisões editoriais separadas do worker. A direção dona está em [Transcrição — runs locais, revisão, comparação e publicação versionada](../features/transcript-review-publication.md).
- O MSI atual ainda não possui assinatura Authenticode configurada; não afirmar publisher assinado antes do gate de segurança correspondente.
- CI sintética/MSI prova contrato e empacotamento, não substitui o aceite físico dos perfis que exigem GPU real.

## Fronteiras de responsabilidade

O Companion pode:

- ingerir e validar fontes locais;
- preparar runtime/modelos;
- executar ASR e alinhamento local;
- persistir fila, checkpoints técnicos, runs e logs sanitizados;
- expor health, capabilities, progresso e diagnóstico local;
- manter resultados locais quando a rede/cloud estiver indisponível.

O Companion não pode:

- servir o site público;
- decidir canon ou publicar automaticamente;
- transformar token local em autorização cloud;
- embutir service role ampla no pacote;
- exigir que o PC fique ligado para consultar conteúdo já publicado no site;
- expor paths pessoais, áudio bruto, transcript integral ou secrets como telemetria/log padrão.

## Identidade e provenance

Operações locais preservam campaign/session/source, job/attempt, perfil/model revision, hashes e demais provenance necessários ao contrato do run. Uma futura publicação deve consumir uma revision aprovada e produzir receipt/readback server-side; **o evento terminal do ASR não é receipt de publicação**.

## Falhas e recuperação

Fila e estado operacional são persistentes. Restart do processo reconcilia trabalho interrompido conforme o contrato vigente; retries criam nova attempt e podem reutilizar somente checkpoints compatíveis. Source, run concluído e dados do usuário não devem ser apagados implicitamente para reparar lifecycle/update.

Detalhes de cancelamento, commit de run, BITS, manutenção e rollback pertencem aos documentos donos citados no cabeçalho.

## Critério para evoluir este entrypoint

Atualize esta página somente quando mudar uma fronteira de produto de alto nível. Versões exatas, schemas, endpoints, perfis, gates físicos e passos operacionais devem ser atualizados no documento dono correspondente e apenas resumidos aqui quando necessário.
