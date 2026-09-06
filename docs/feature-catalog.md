# Catálogo canônico de features

Este catálogo consolida a direção do TDA sem transformar automaticamente ideias históricas em schema. As referências históricas citadas abaixo vivem no legado `Faysk/dnd-scribe`.

Estados:

- **implementado no schema**: já há estrutura de dados real utilizável;
- **preparado**: o schema atual sustenta a feature, mas falta ingestão/UI/operação;
- **documentado, precisa de desenho**: intenção validada historicamente, sem contrato de dados definitivo no reboot;
- **não encontrado**: nenhum conceito canônico correspondente foi localizado.

| Feature | Estado no TDA | Base atual / decisão |
| --- | --- | --- |
| Perfis/jogadores | implementado no schema | `profiles`, Auth, campaign membership e RBAC |
| Personagens jogáveis (PCs) | preparado | `entities(type=pc)` + `profile_characters` + `participants.character_entity_id`; Astel, Dandelion e Screacky já canonicalizados |
| NPCs | preparado | `entities(type=npc)`; não precisam de profile humano |
| Lugares | preparado | `entities(type=location)` |
| Itens | preparado | `entities(type=item)` |
| Organizações | preparado | `entities(type=organization)` |
| Facções | preparado | `entities(type=faction)` |
| Arcos | preparado | `entities(type=arc)` |
| Conceitos/lore | preparado | `entities(type=concept)` + canon revisado |
| Músicas/performances | preparado | `entities(type=song)`; experiência/UI permanece futura |
| Quests/ganchos | preparado | `entities(type=quest)`; estados narrativos precisam ser definidos quando a feature entrar |
| Menções de entidades | implementado no schema | `entity_mentions` liga entity a sessão/segmento/evento; tabela ainda vazia |
| Canon consolidado | implementado no schema | `canon_entries`; só deve receber conteúdo aprovado; tabela ainda vazia |
| Candidatos a canon | implementado no schema | `canon_candidates` + fontes + revisão |
| Citações/outtakes | implementado no schema | candidatos e review flow já existem |
| Publicações | implementado no schema | `publications`; conteúdo publicado atual já existe |
| Relações entre entidades | documentado, precisa de desenho | grafo histórico prevê aliança, dívida, traição, família, segredo, conhecimento, conflito etc.; criar edges first-class apenas após fechar semântica |
| Grafo visual | documentado, precisa de desenho | React Flow é opção de visualização, não modelo de dados |
| Timeline por entidade | preparado | sessions/participants/mentions/canon já dão a base; UI/query ainda futuras |
| Conhecimento por audiência | documentado, precisa de desenho | distinguir jogador, personagem, público, rumor, mentira e segredo do mestre; não esconder em JSON genérico |
| Busca semântica | documentado, precisa de desenho | embeddings futuros devem manter referência a fonte/entity e nunca alterar canon |
| Mapas | documentado, precisa de desenho | lugares já cabem em `entities`; geografia/coords/map provider ainda não têm contrato canônico |
| Wiki/memória da campanha | documentado e parcialmente preparado | `entities`, mentions e canon formam a base; população e navegação são futuras |
| Discord para consulta narrativa | histórico/documentado | comandos como NPC/item/canon foram ideias do legado; revisar UX/autorização antes de reimplementar |
| Retcon/supersession | preparado | `canon_entries.status` e histórico de revisão dão base; experiência visual ainda futura |
| Intents / intenção | não encontrado | nenhuma tabela, coluna ou definição canônica localizada no schema ou documentação histórica revisada; não criar até o conceito ser definido |

## Fontes históricas revalidadas

- `Faysk/dnd-scribe/docs/09_modelo_de_dados_supabase.md`: separação entre pessoas e entidades; tipos PC/NPC/local/item/organização/facção/arco/conceito/música/quest.
- `Faysk/dnd-scribe/docs/08_classificacao_auditoria_canon.md`: fonte, classificação, revisão e canon.
- `Faysk/dnd-scribe/docs/16_ideias_futuras.md`: wiki viva, relações, mapas, knowledge layers, busca semântica, músicas e consultas via Discord.
- `Faysk/dnd-scribe/docs/35_roadmap_proximas_10_etapas.md`: entidades/canon/timeline e superfícies futuras.
- `Faysk/dnd-scribe/docs/49_resultado_etapa_21_entidades_canon_consolidado.md`: consolidator de canon aprovado.

Esses documentos são evidência histórica. A decisão vigente sempre é este catálogo, `data-model.md`, `architecture.md` e o roadmap do repositório TDA.

## Ordem recomendada de evolução

1. autenticação/capabilities do reboot;
2. Edit e revisão/publicação;
3. popular entities/mentions/canon somente a partir de fontes revisadas;
4. timeline/wiki por entity;
5. fechar modelo de relations e knowledge/audience;
6. só então grafo visual, mapas e busca semântica mais rica.
