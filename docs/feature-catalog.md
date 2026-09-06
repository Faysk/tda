# Catálogo canônico de features

Este catálogo consolida a direção do TDA sem transformar automaticamente ideias históricas em schema. As referências históricas citadas abaixo vivem no legado `Faysk/dnd-scribe`.

Estados:

- **implementado no schema**: já há estrutura de dados real utilizável;
- **preparado**: o schema atual sustenta a feature, mas falta ingestão/UI/operação;
- **arquitetura aprovada**: boundary/UX/tecnologia principal foram aceitos, mas implementação ainda não está concluída;
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
| Músicas/performances | preparado | `entities(type=song)`; performances específicas continuam em desenho |
| Quests/ganchos | preparado | `entities(type=quest)`; estados narrativos precisam ser definidos quando a feature entrar |
| Menções de entidades | implementado no schema | `entity_mentions` liga entity a sessão/segmento/evento; tabela ainda vazia |
| Canon consolidado | implementado no schema | `canon_entries`; só deve receber conteúdo aprovado; tabela ainda vazia |
| Candidatos a canon | implementado no schema | `canon_candidates` + fontes + revisão |
| Citações/outtakes | implementado no schema | candidatos e review flow já existem |
| Publicações | implementado no schema | `publications`; conteúdo publicado atual já existe |
| Perfis editoriais de entities | arquitetura aprovada | páginas tipadas por UX sobre registry única `entities`; spec em `features/entity-profiles.md` |
| Relações entre entities | documentado, schema em desenho | relation first-class com direção/simetria, lifecycle, visibility e fonte; proposta em `features/relations-data-contract.md` |
| World Explorer / Ecos da Jornada | arquitetura aprovada | React Flow escolhido para visualização; layout radial e projection autorizada; sem escrita no Supabase no primeiro slice |
| Grafo visual | arquitetura aprovada | `@xyflow/react` é engine de apresentação; não define schema nem autorização |
| Timeline por entidade | preparado | sessions/participants/mentions/canon já dão a base; UI/query ainda futuras |
| Conhecimento por audiência | documentado, precisa de desenho | distinguir jogador, personagem, público, rumor, mentira e segredo do mestre; não esconder em JSON genérico |
| Busca semântica | documentado, precisa de desenho | embeddings futuros devem manter referência a fonte/entity e nunca alterar canon |
| Mapas | documentado, precisa de desenho | lugares já cabem em `entities`; geografia/coords/map provider ainda não têm contrato canônico |
| Wiki/memória da campanha | documentado e parcialmente preparado | `entities`, mentions e canon formam a base; perfis editoriais agora têm contrato próprio |
| Discord para consulta narrativa | histórico/documentado | comandos como NPC/item/canon foram ideias do legado; revisar UX/autorização antes de reimplementar |
| Retcon/supersession | preparado | `canon_entries.status` e histórico de revisão dão base; experiência visual ainda futura |
| Intents / intenção | não encontrado | nenhuma tabela, coluna ou definição canônica localizada no schema ou documentação histórica revisada; não criar até o conceito ser definido |

## Fontes visuais oficiais

O projeto também possui agora duas fontes oficiais explicitamente aprovadas:

- **TDA Design System v1.0.0** — tokens, temas, tipografia, acessibilidade, governança e composição visual;
- **TDA Brand Pack (official)** — masters de marca, logo, pato, favicons, PWA e social cards.

A autoridade operacional está em [docs/design-system](design-system/README.md).

## World Explorer

A decisão de visualização foi fechada em [ADR-0006](adr/0006-react-flow-world-explorer.md):

- React Flow (`@xyflow/react`) para o canvas;
- custom nodes/edges;
- projection layer server-authorized;
- layout radial próprio no primeiro slice;
- 1-hop default;
- lista alternativa acessível;
- sem edição de relations no modo público;
- sem modelar o banco com conceitos da biblioteca.

O relation schema **ainda não foi migrado**. O primeiro slice usa fixtures explicitamente marcadas como demo até o contrato ser aprovado e relações reais terem fonte/canon.

## Fontes históricas revalidadas

- `Faysk/dnd-scribe/docs/01_objetivos_e_escopo.md`: objetivo de transformar sessões em memória auditável/publicável e futuro de wiki/grafo/timeline/busca.
- `Faysk/dnd-scribe/docs/02_contexto_da_campanha.md`: necessidade de separar canon, interpretação, rumor, mentira, piada e gancho.
- `Faysk/dnd-scribe/docs/02_mapa_de_telas.md`: entidades, segredos, "quem sabe o quê", canon e revisão como superfícies distintas.
- `Faysk/dnd-scribe/docs/03_regras_de_visibilidade.md` e `03_segredos_e_conhecimento.md`: separar quem vê no sistema de quem sabe na ficção.
- `Faysk/dnd-scribe/docs/09_modelo_de_dados_supabase.md`: separação entre pessoas e entidades; tipos PC/NPC/local/item/organização/facção/arco/conceito/música/quest.
- `Faysk/dnd-scribe/docs/08_classificacao_auditoria_canon.md`: fonte, classificação, revisão e canon.
- `Faysk/dnd-scribe/docs/16_ideias_futuras.md`: wiki viva, relações, mapas, knowledge layers, busca semântica, músicas e consultas via Discord.
- `Faysk/dnd-scribe/docs/35_roadmap_proximas_10_etapas.md`: entidades/canon/timeline e superfícies futuras.
- `Faysk/dnd-scribe/docs/49_resultado_etapa_21_entidades_canon_consolidado.md`: consolidator de canon aprovado.

Esses documentos são evidência histórica. A decisão vigente sempre é este catálogo, `data-model.md`, ADRs e o roadmap do repositório TDA.

## Ordem recomendada de evolução

1. autenticação/capabilities do reboot;
2. Design System/Brand Pack fisicamente integrados no frontend;
3. primeiro vertical slice do World Explorer com fixtures e Dandelion como foco;
4. Edit e revisão/publicação;
5. popular entities/mentions/canon somente a partir de fontes revisadas;
6. aprovar/migrar relations com sources e autorização;
7. ligar World Explorer a relations reais;
8. perfis editoriais + timeline/wiki por entity;
9. fechar modelo de knowledge/audience;
10. busca semântica, mapas e superfícies mais ricas.

Essa ordem permite validar a experiência visual sem promover fixture a canon nem antecipar uma migration incompleta.