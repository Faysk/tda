# Feature — Personagens e NPCs

> Status: preparado
> Owner: entities/narrative-memory
> Última revisão: 2026-09-06

## Valor

Transformar PCs e NPCs em páginas navegáveis de memória da campanha, com identidade consistente, aliases, aparições, canon e futuramente relações/knowledge.

## Base existente

- `entities(type=pc|npc)`;
- `profile_characters` para vínculo jogador ↔ PC;
- `participants.character_entity_id` para aparições;
- `entity_mentions` para evidências;
- `canon_entries` para memória aprovada;
- visibility por entity/canon.

PCs atuais canonicalizados: Astel, Dandelion e Screacky.

## Contrato

PC e NPC compartilham `entities`. Diferenças específicas vêm de vínculos/atributos, não de registries paralelas.

### Página mínima de entity

Pode exibir conforme audience:

- nome/tipo/aliases;
- resumo aprovado;
- sessões/aparições;
- canon entries;
- mentions com contexto permitido;
- links para relations/timeline futuras.

## Criação/edição

Criação manual/revisada deve escolher campaign, type, canonical name e visibility. Slug deve ser estável/único por campaign.

Entity resolution assistida pode sugerir existing/new, mas criação automática em massa por IA não é requisito.

## Segurança

- `private_master` nunca vai para player/public;
- mentions podem apontar para transcript privado, portanto página pública não deve simplesmente expandir source text;
- NPC secret/plan futuro deve usar audience adequada, não summary pública.

## Decisões pendentes

- ficha estruturada específica para PC/NPC (raça/classe/etc.) é necessária ou metadata/fonte externa basta?
- lifecycle de entity além de `status` atual;
- avatar/gallery/media contract;
- merge de duplicatas;
- nome canônico Screacky vs Screaky.

## Critérios de aceite da primeira UI

- listar PCs/NPCs autorizados;
- abrir detalhe por slug/UUID estável;
- PC mostra vínculo/aparições corretas sem vazar profile privado;
- NPC não exige profile;
- canon exibido é somente aprovado/permitido;
- empty states funcionam para NPC sem canon/mentions;
- mobile/acessibilidade.

## Não objetivos iniciais

- ficha completa de D&D;
- grafo de relações completo;
- edição livre de canon sem review;
- geração automática de NPC como canon.
