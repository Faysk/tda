# Craig, Discord e Roll20

> Status: legado funcional/parcialmente implementado
> Owner: integrations/table-sources
> Última revisão: 2026-09-06

Essas integrações representam **fontes da mesa e identidade operacional**, não autoridade narrativa automática.

# Craig

## Papel

Fonte principal histórica de gravação multi-track das sessões.

Pipeline modelado:

```text
Craig ZIP/info
 -> craig_manifests
 -> validation
 -> craig_track_extraction_steps
 -> recording_files + participants
 -> chunks/speech slices
 -> transcription
```

## Track mapping

Track/Discord nick pode ajudar a identificar participant, mas mapping deve suportar convidados, aliases e revisão. Não inferir profile global de modo irreversível apenas pelo nome da track.

## Manifest

`craig_manifests` guarda informações temporais, recording ID, guild/channel/requester, contagem de tracks/participants e erros de validação.

Esse manifesto é contrato de ingestão, não canon.

# Discord

## Papéis históricos

- identidade/handle associado a profile/participant;
- origem do Craig;
- interactions/comandos;
- notas de mesa;
- futura consulta narrativa.

## Interactions

`discord_interactions` registra payload/response e contexto de campaign/session.

Não confiar no payload bruto para autorização. Resolver user/profile e capabilities.

## Table notes

Notas podem indicar `canon`, `npc`, `item`, etc., mas entram em review. Um comando de Discord não deve pular o gate de canon.

## Bot futuro

Ideias históricas revalidadas como possíveis superfícies:

- recap;
- onde estamos;
- NPC;
- item;
- gancho;
- fala;
- bastidor;
- canon;
- session.

UX/comandos não estão congelados. Antes de reimplementar, definir authorization/audience e consultas que não vazem conteúdo de mestre.

# Roll20

## Papel

Fonte de eventos/marcadores de jogo que pode ajudar a alinhar timeline e revisão.

Eventos históricos previstos incluem:

- scene;
- canon marker;
- quote/OOC marker;
- roll;
- combat start/end;
- turn/page change;
- sync.

`roll20_events` atual aceita `event_type` textual e provenance completa suficiente para evolução.

## Autoridade

Um evento marcado `canon` no Roll20 deve ser tratado como forte intenção/marcador humano, mas ainda passar pelo pipeline de revisão antes de `canon_entries` quando esse for o contrato vigente.

## Timing

`approx_start_ms` pode alinhar evento a transcript/áudio. Timing aproximado não deve ser tratado como precisão frame-perfect.

# Regras compartilhadas

1. preservar ID/timestamp/raw provenance quando seguro;
2. retries/imports não duplicam evento;
3. identidade externa não substitui UUID interno;
4. fonte não publica conteúdo sozinha;
5. source text/payload pode conter conteúdo privado;
6. integração precisa de capability mínima;
7. falha de uma fonte não invalida as demais evidências da sessão.

# Futuro

- checklist pré-sessão;
- detecção/revisão de convidados;
- mapping de nick/track integrado ao Edit;
- import Roll20 mais simples;
- bot Discord autenticado por capabilities;
- correlação temporal de múltiplas fontes;
- provenance unificada sem apagar raw/source IDs.
