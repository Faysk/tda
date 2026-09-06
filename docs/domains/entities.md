# Entidades, personagens e mundo narrativo

> Status: preparado
> Owner: narrative-memory/entities
> Última revisão: 2026-09-06

## Objetivo

Ter uma identidade única e navegável para qualquer objeto narrativo persistente da campanha, permitindo memória, mentions, timeline, relações e exploração futura sem criar uma tabela isolada para cada tipo.

## Registry canônica

`entities` é a registry única.

Tipos físicos atuais:

- `pc` — player character;
- `npc` — non-player character;
- `location`;
- `item`;
- `organization`;
- `faction`;
- `arc`;
- `concept`;
- `song`;
- `quest`;
- `other`.

## PC

PC é uma entity `type=pc`.

Relações típicas:

```text
profile -> profile_characters -> entity(pc)
                                ↑
participant(session) -----------┘
```

Isso permite que o mesmo PC apareça em múltiplas sessões e seja navegado independentemente da conta humana.

## NPC

NPC é `entity(type=npc)` e não precisa de profile.

Se alguém interpretar um NPC temporariamente, isso não deve transformar o NPC em profile. A occurrence pode ser registrada em participant/event/evidence conforme necessidade.

## Name, slug e aliases

### UUID

Identidade técnica canônica.

### Slug

Identificador estável legível para navegação futura. Único por campaign quando presente.

### Name

Nome de apresentação canônico atual.

### Aliases

Nomes alternativos conhecidos para resolução/busca.

### Compatibilidade atual

O legado ainda usa `ON CONFLICT (campaign_id, name)` no consolidator. Por isso, nomes idênticos na mesma campaign continuam temporariamente bloqueados pela constraint histórica.

**Direção:** migrar consolidator para UUID/slug e só depois permitir entities homônimas.

## Estado atual

Três entities PC foram canonicalizadas:

- Astel;
- Dandelion;
- Screacky.

Os respectivos `profile_characters` e 12 participações históricas estão vinculados.

### Grafia Screacky/Screaky

Existe divergência histórica entre `Screacky` no banco e `Screaky` em material legado. Não corrigir silenciosamente. Confirmar nome canônico com o proprietário e registrar a grafia alternativa em aliases.

## Visibility

Valores atuais:

- `private_master`;
- `private_players`;
- `review_only`;
- `public_campaign`;
- `public_web`.

Visibility da entity é uma base de audiência. Canon entries, publications e knowledge futuro ainda podem exigir regras mais específicas.

## Summary

`entities.summary` é apresentação consolidada, não local para despejar todas as fontes. Fatos detalhados devem continuar rastreáveis por canon entries/evidence.

## Mentions

`entity_mentions` liga entity a session/segment/Roll20 event.

Use para:

- timeline de aparições;
- busca;
- entity resolution auditável;
- contexto de fonte.

Não use mention como:

- relation edge;
- canon automático;
- prova de presença física do personagem (alguém pode apenas mencioná-lo).

## Canon por entity

`canon_entries.entity_id` permite organizar memória consolidada por entity. Entrada pode não ter entity quando o fato é global ou ainda não foi resolvido.

## Features sustentadas sem schema novo

Com a registry atual já é possível construir progressivamente:

- páginas de PC/NPC;
- páginas de lugares/itens/facções;
- timeline por entity;
- mentions por session;
- canon por entity;
- aliases/resolução;
- músicas/quests como objects narrativos.

## Features que exigem desenho novo

### Relations

Edge first-class entre entities. Deve suportar relação/direção/status/evidence/audience.

Exemplos históricos:

- família;
- aliança;
- dívida;
- traição;
- conflito;
- segredo.

### Knowledge

"A conhece B" pode ser relation. "A sabe o segredo X" provavelmente exige knowledge claim/audience mais rico.

### Geografia

`location` existe, mas coordenadas, mapa, regiões e geometry ainda não têm contrato.

### Narrative clocks

Ideia histórica de relógios para riscos/planos/eventos. Pode envolver entity/arc/quest, mas não está modelada.

## Criação de entity

Não criar entity automaticamente para todo token detectado pela IA.

Pipeline futuro recomendado:

```text
mention/candidate
 -> resolver contra name/slug/aliases
 -> confidence + sugestões
 -> revisão quando ambíguo
 -> link existente OU criação controlada
```

## Merge e duplicatas

Antes de implementar merge:

- decidir entity vencedora;
- remapear FKs/mentions/canon/relations futuras;
- preservar aliases e provenance;
- registrar audit;
- não apagar histórico silenciosamente.

## Retcon

Retcon altera facts/canon, não necessariamente identity. Uma entity normalmente continua a mesma mesmo quando sua história é corrigida.

## Referência histórica revalidada

O `dnd-scribe` já previa wiki viva, NPCs, lugares, itens, músicas, relações, quests, mapas e busca semântica. O reboot mantém a direção, mas só transforma uma ideia em contrato/schema quando documentada aqui/feature catalog/roadmap.
