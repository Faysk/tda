# Feature — Modo sessão ao vivo

> Status: histórico/planejado; fora das entregas imediatas
> Owner: sessions/live
> Última revisão: 2026-09-06

## Valor

Apoiar a sessão enquanto ela acontece com contexto rápido, sem transformar o TDA num VTT concorrente.

## Ideias históricas revalidadas como possibilidades

- cena atual;
- timer;
- links;
- NPCs em cena;
- markers/notas rápidas;
- rolagens recentes;
- playlist;
- objetivos.

Isso é referência de produto, não backlog integral aprovado.

## Base existente

- sessions;
- participants;
- session_markers;
- table_notes;
- Roll20 events;
- entities;
- Discord interactions;
- future quests/relations.

## Boundary

TDA deve complementar Roll20/Discord/Craig, não replicar mapa, ficha, combate e voice stack de um VTT sem requisito específico.

## Persistência

Markers/notas de live são evidence/intenção. A UI precisa deixar claro o que vira:

- nota privada;
- marker;
- candidate;
- publicação/canon somente depois de review.

## Offline/failure

Uma queda do TDA durante a mesa não pode destruir a gravação Craig nem bloquear o jogo. Live mode deve ser conveniência resiliente.

## Security

Modo mestre e player podem ver painéis diferentes. Dados secret não devem ser enviados ao client de player apenas para serem ocultados.

## Critérios antes de execução

- Home/session/review/companion básicos estabilizados;
- necessidade real observada em sessões;
- fluxo de capture sem aumentar atrito;
- mobile/tablet definido;
- integration boundaries claros.

## Não objetivos

- substituir Roll20;
- sistema de combate próprio;
- voice/video;
- canon automático durante live.
