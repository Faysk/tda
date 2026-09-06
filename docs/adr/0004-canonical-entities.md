# ADR-0004 — Registry única de entities para PC, NPC e mundo

> Status: accepted
> Data: 2026-09-06

## Contexto

O schema possuía `profile_characters` com PCs e uma `entities` vazia que já previa `pc`, `npc`, location, item etc. Manter PC fora da registry faria NPC/PC terem identidades e features diferentes artificialmente.

## Opções

1. tabela `characters` separada e tabelas próprias por tipo;
2. PC em `profile_characters` e NPC em `entities`;
3. `entities` como registry narrativa universal, com vínculos especializados.

## Decisão

Adotar opção 3.

- `entities` identifica objetos narrativos persistentes;
- PC é `entity(type=pc)`;
- NPC é `entity(type=npc)`;
- `profile_characters` associa profile ao PC;
- `participants` aponta para entity representada na session;
- mentions/canon/relations futuras trabalham sobre entity UUID.

## Consequências positivas

- timeline/wiki/grafo uniformes;
- NPC não precisa de conta humana;
- PC pode existir em múltiplas sessions;
- aliases/resolução centralizados;
- features futuras não duplicam tabelas por tipo.

## Trade-offs

- legado ainda possui name/status textual em `profile_characters`;
- consolidator antigo usa entity name como conflict key;
- schema futuro pode exigir campos específicos por tipo, que devem ser modelados sem destruir registry base.

## Migração inicial

Em 2026-09-06, Astel, Dandelion e Screacky foram criados/vinculados como PCs; 3/3 profile characters e 12/12 participações conhecidas desses PCs passaram a apontar para entities.

Nenhum profile humano ausente foi inventado.

## Guardrails

- não criar tabela `npcs` paralela sem necessidade estrutural comprovada;
- não usar `profile` para representar NPC;
- não criar entity automaticamente para toda menção;
- relation/knowledge não ficam escondidos em metadata.

## Condição de revisão

Tipos extremamente especializados podem ganhar tabelas de extensão 1:1/1:N no futuro, mas `entities.id` continua a identidade narrativa comum salvo novo ADR.
