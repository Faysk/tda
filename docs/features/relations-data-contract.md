# Feature — contrato de dados para relações

> Status: proposta canônica para revisão; **nenhuma DDL aprovada/aplicada ainda**
> Owner: narrative-memory / database / security
> Última revisão: 2026-09-08

Este documento fecha o suficiente da semântica de relações para permitir o primeiro World Explorer com fixtures e preparar uma migration futura sem moldar o banco ao React Flow.

A decisão de visualização está em [ADR-0006](../adr/0006-react-flow-world-explorer.md). Este documento trata apenas do **domínio**.

## Objetivo

Representar vínculos persistentes ou historicamente relevantes entre duas `entities`, com:

- semântica explícita;
- direção/simetria;
- temporalidade;
- visibilidade;
- fonte canônica;
- auditabilidade;
- possibilidade de retcon/encerramento sem apagar história.

## Não é relação

Não criar `entity_relation` para:

- coocorrência em transcrição;
- simples menção;
- proximidade num embedding;
- duas entities no mesmo artwork;
- personagens na mesma sessão sem vínculo relevante;
- crença/rumor sobre outra entity;
- visibility do produto;
- status da entity (`deceased`, `inactive` etc.).

Esses conceitos pertencem a evidence, mentions, knowledge ou entity state.

## Fontes históricas revalidadas

O legado cita como necessidades:

- alianças;
- dívidas;
- traições;
- família;
- segredos;
- conflito;
- "quem conhece quem".

O reboot separa "quem sabe o quê" em [knowledge-audience.md](knowledge-audience.md), porque conhecimento/crença não é equivalente a um edge social.

## Entidades como endpoints

Toda relation canônica conecta `entities.id`.

Exemplos válidos:

```text
Dandelion (pc) -> Astel (pc)
Screacky (pc) -> Ivory (npc)
Astel (pc) -> Raven Queen (concept/organization conforme canon real)
Dandelion (pc) -> O Reino Vai Cantar (song)
NPC -> faction
item -> organization
location -> faction
```

A possibilidade técnica não significa que todo par de tipos precise ser permitido. `relation_types` pode restringir ou documentar combinações no futuro.

## Camadas de domínio propostas

```text
relation_types
entity_relations
entity_relation_sources
```

Essas três estruturas carregam semântica/provenance. A candidata #119 acrescenta `world_relation_styles` como armazenamento **de apresentação**, separado do contrato factual; essa tabela não transforma cor/espessura/traço em semântica de relation.

### `relation_types`

Catálogo estável da semântica.

Campos propostos:

| Campo | Papel |
| --- | --- |
| `slug text PK` | identificador estável, ex. `friend_of` |
| `label text` | label humano padrão |
| `inverse_slug text?` | relação inversa quando dirigida |
| `directionality text` | `directed` ou `symmetric` |
| `family text` | agrupamento semântico para filtros/UI |
| `description text` | contrato da relação |
| `is_system boolean` | distingue tipos base de customizações futuras |
| `created_at/updated_at` | auditoria técnica |

A #119 ainda não fecha a convenção de inversas; o schema candidato mantém apenas `directionality` + label canônica nesta fatia.

### `entity_relations`

Instância canônica/histórica do vínculo.

Campos propostos:

| Campo | Papel |
| --- | --- |
| `id uuid PK` | identidade do edge de domínio |
| `campaign_id uuid FK` | isolamento da campanha |
| `source_entity_id uuid FK` | endpoint origem |
| `target_entity_id uuid FK` | endpoint destino |
| `relation_type_slug text FK` | semântica |
| `status text` | lifecycle |
| `visibility text` | audience técnica/narrativa já usada no TDA |
| `started_session_id uuid?` | início narrativo quando conhecido |
| `ended_session_id uuid?` | fim narrativo quando conhecido |
| `started_at timestamptz?` | temporalidade adicional quando necessária |
| `ended_at timestamptz?` | temporalidade adicional quando necessária |
| `created_by uuid?` | profile que materializou/aprovou |
| `created_at/updated_at` | auditoria |
| `metadata jsonb` | extensão não estrutural |

A primeira migration candidata #119 é deliberadamente menor que este desenho completo: persiste endpoints/tipo/status/visibility/audit e deixa temporalidade narrativa explícita para uma evolução posterior, em vez de inventar datas sem caso real validado.

`metadata` não deve receber listas de fontes, endpoints, directionality, audience ou campos que mereçam query/index.

### `entity_relation_sources`

Relação canônica precisa ser rastreável a memória revisada.

Primeira forma proposta:

| Campo | Papel |
| --- | --- |
| `relation_id uuid FK` | relation sustentada |
| `canon_entry_id uuid FK` | fonte canônica aprovada |
| `created_at` | auditoria |

PK/unique: `(relation_id, canon_entry_id)`.

O objetivo é permitir **mais de uma fonte** sem arrays de UUID.

Se uma relation manual não possuir `canon_entry` correspondente, o fluxo recomendado é criar/revisar a afirmação canônica primeiro, em vez de criar edge sem prova.

## Candidate flow

Não criar relation oficial a partir de IA diretamente.

O TDA já possui `canon_candidates.related_entity_ids` e `candidate_type` textual. Isso permite representar candidatos de relação sem tabela nova inicialmente.

Fluxo recomendado:

```text
evidence
 -> classificação/sugestão
 -> canon_candidate(candidate_type="relation", related_entity_ids=[A,B])
 -> revisão humana
 -> canon_entry aprovada
 -> entity_relation
 -> entity_relation_sources
```

A semântica específica (`friend_of`, `owes_debt_to` etc.) precisa estar explícita no candidato/decisão; não inferir apenas pela ordem do array.

Se essa reutilização de `canon_candidates` ficar ambígua em uso real, uma future ADR pode aprovar `relation_candidates`. Não criar agora sem necessidade observada.

## Candidato físico #119 — autoria manual sem atalho de canon

A PR #119 versiona `20260909215000_world_graph_authoring` como primeira implementação física candidata deste contrato. Na inspeção read-only de 2026-09-10, a migration **ainda não estava aplicada** no Supabase canônico.

A fatia introduz:

- `relation_types` por campaign;
- `entity_relations` first-class;
- `entity_relation_sources` para provenance;
- `world_relation_styles` para apresentação, sem misturar estilo com verdade narrativa;
- `world_graph_heads` + `world_graph_revisions` para revision/snapshot;
- draft factual privado acoplado ao lease exclusivo do World já existente.

### Separação semântica x apresentação

`relation_types.family`, directionality e label continuam semântica. Cor, espessura e traço ficam em `world_relation_styles` ou override de edge e são consumidos pela projection/React Flow como **apresentação editorial**.

Portanto o princípio "family não define cor física" permanece válido. O que muda em relação ao rascunho anterior deste contrato é que a apresentação pode ser persistida explicitamente em tabela própria, em vez de existir apenas em tokens de UI. Esse storage visual não pode ser usado para inferir relation type, canon, visibility ou audience.

### Capability e sessão

Autoria factual candidata exige:

- `campaign.content.edit` no scope correto; e
- lease vigente de `campaign.world.layout.edit` para a mesma identity/profile/campaign.

A capability de layout isolada **não** concede autoria factual. O lease é mecanismo de concorrência/sessão, não elevação de permissão.

### Draft e publish

A edição factual fica em `draft_graph` privado até publicação explícita. O publish candidato:

- valida revision do head;
- valida IDs/endpoints/tipos/status/visibility;
- normaliza endpoints simétricos antes de persistir;
- rejeita duplicata ativa incompatível;
- publica facts + layout na mesma transação SQL;
- cria snapshot append-only quando o grafo factual muda;
- grava `world_graph.publish` no audit;
- não promove candidate/IA automaticamente.

### Provenance ainda não concluída pela UI desta fatia

A #119 cria `entity_relation_sources`, mas **não cria ainda uma mutation para anexar uma nova `canon_entry` a uma relação**. O `service_role` recebe somente leitura nessa tabela nesta fatia.

Por isso o server boundary bloqueia uma relation ativa `public_campaign`/`public_web` sem source já existente e retorna `review_required` antes do RPC de publicação. Uma relation nova pode ser preparada como `private_*`/`review_only`, mas não ganha legitimidade pública só porque foi desenhada/editada no World.

A fatia seguinte de provenance/review precisa anexar source de forma autorizada e auditável, em vez de liberar write genérico em `entity_relation_sources`.

### Ativação pública separada

Mesmo com schema/autoria instalados, `/mundo` não deve trocar automaticamente do demo para dados reais. A projection canônica pública da #119 fica atrás de `TDA_WORLD_CANONICAL_ENABLED=true` e deve ser ativada somente depois de curadoria/review/visibility e validação visual do dataset real.

O preflight de 2026-09-10 encontrou 3 entities no banco, apenas 1 `active/public_web`, e 0 `canon_entries`; portanto ativação pública neste estado seria prematura e degradaria a experiência demonstrativa atual.

## Edição autorizada no grafo — rodada #99

A [issue #99](https://github.com/Faysk/tda/issues/99) prepara edição compreensível a partir do World Explorer, mas o grafo é apenas ponto de entrada da UX. **Selecionar, arrastar ou desenhar uma edge no cliente nunca é autoridade suficiente para criar/alterar fato narrativo.**

### Layout não é relation

- mover node altera somente layout editorial, conforme o owner do [World Explorer](world-explorer.md) e ADR-0010;
- posição, pan, zoom ou proximidade visual não são source, canon, relation type nem visibility;
- salvar layout e salvar relation são mutations distintas, com capabilities, revisions e feedback próprios;
- cancelar/reverter posição visual não deve sugerir rollback de relation já persistida.

### Fluxo de edição factual

Uma edição de relation deve começar por seleção explícita e apresentar formulário compreensível com source/target, tipo, direção quando aplicável, visibility, fonte/revisão necessária e temporalidade apenas quando suportada.

Antes de persistir, o boundary server-side precisa revalidar:

- identidade verificada;
- capability exata e scope/campaign/ownership;
- endpoints existentes e pertencentes à campanha;
- relation type permitido;
- visibility permitida ao ator e ao fluxo de publicação;
- provenance/canon source exigida por este contrato;
- `expectedRevision`/versão equivalente quando a migration definir concorrência otimista;
- ausência de conflito, duplicata simétrica ou transição de lifecycle inválida.

Login, role name exibido pela UI ou capability de layout não concedem edição factual por inferência.

### UX mínima sem criar contrato visual paralelo

A composição deve reutilizar Design System/Edit existentes:

- `Salvar` é ação explícita e só anuncia sucesso após confirmação durável;
- `Cancelar` descarta apenas rascunho local não persistido;
- validation error mantém campos e explica correção;
- dependency error mantém rascunho e não afirma save;
- conflict preserva rascunho, mostra que o dado mudou e exige refresh/reconciliação; não há retry cego;
- source/review/visibility ficam legíveis ao editor, mas detalhes privados não saem na projection pública.

Isso é requisito de comportamento, não aprovação de `DataTable`, modal, drawer ou biblioteca nova.

### Curadoria antes da relation

O primeiro dataset real da #99 deve seguir [canon/review](../domains/canon-review.md). Extração pode sugerir candidato com fonte, natureza da claim e visibility, mas somente revisão humana autorizada pode promover a relation necessária ao grafo. Inferência/conflict não vira edge factual para melhorar densidade visual.

## Directionality

### `symmetric`

A relação significa o mesmo nos dois sentidos.

Exemplos possíveis, sujeitos ao vocabulário real:

- `friend_of`;
- `sibling_of`;
- `allied_with`.

A UI pode renderizar uma única edge.

Na migration candidata #119, endpoints simétricos são normalizados no boundary de publish antes da persistência e duplicatas ativas são rejeitadas. Isso precisa continuar coberto por teste; não confiar na ordenação enviada pelo cliente.

### `directed`

Origem e destino importam.

Exemplos:

- `mentors`;
- `owes_debt_to`;
- `serves`;
- `controls`;
- `betrayed`;
- `originates_from`.

A UI pode apresentar label diferente no sentido inverso usando contrato futuro de inversa; a #119 não fecha `inverse_slug` nesta fatia.

## Inversas

Exemplo:

```text
mentor_of.inverse = student_of
student_of.inverse = mentor_of
```

Nem todo tipo precisa de duas rows se a UI consegue formar frase contextual, mas o catálogo deve evitar texto ambíguo.

Antes da seed final, escolher uma única convenção:

1. guardar ambos os slugs como tipos distintos; ou
2. guardar apenas tipo canônico + `inverse_label`.

**Decisão ainda aberta.**

## Relation families

`family` é classificação semântica útil para filtro, visual e analytics; não define cor física.

Famílias da primeira migration candidata:

- `affinity`;
- `family`;
- `conflict`;
- `authority`;
- `faction`;
- `origin`;
- `mystic`;
- `creative`;
- `context`.

A lista deve continuar validada contra relações reais da campanha antes de ser tratada como vocabulário definitivo.

A apresentação pode persistir hexadecimal/linha/espessura em `world_relation_styles` e overrides de edge, mas **as tabelas semânticas não usam esses valores para definir o significado da relação**.

## Lifecycle

Estados propostos/candidatos:

- `active`;
- `ended`;
- `superseded`;
- `retcon_pending`;
- `archived`.

### Regra

Mudança histórica não apaga a relation antiga.

Exemplo:

```text
sessão 10: A allied_with B
sessão 22: aliança termina
```

A relation pode passar para `ended`, preservando a timeline. A #119 ainda não adiciona `ended_session_id`/temporalidade detalhada; isso não autoriza hard delete para simular história.

Se a relação anterior era factual mas foi substituída por retcon, usar `superseded`/histórico apropriado, não DELETE como correção editorial comum.

## Visibility

Reutilizar o vocabulário já presente em `entities`, `canon_entries` e `publications` e adotado pela candidata #119:

- `private_master`;
- `private_players`;
- `review_only`;
- `public_campaign`;
- `public_web`.

Uma relation pode ser mais secreta que os dois endpoints.

Exemplo:

- NPC A é público;
- facção B é pública;
- relation `serves` é segredo do DM.

O World Explorer não pode revelar esse edge.

## Audience versus knowledge

`visibility` responde **quem pode receber o dado no produto**.

Não responde:

- quem sabe isso dentro da ficção;
- quem acredita nisso;
- se é rumor;
- se alguém esqueceu;
- se a memória foi roubada.

Esses conceitos continuam em [knowledge-audience.md](knowledge-audience.md).

## Relation com status de entity

Não modelar:

```text
Dandelion -> deceased
```

como edge.

Se uma entity morreu, isso é status/cronologia da entity ou canon event.

Relações anteriores permanecem consultáveis historicamente.

## Relation com evento/momento

O contrato principal conecta entity ↔ entity.

Um momento/evento é melhor representado por:

- canon entry;
- sessão;
- future moment model.

Para World Explorer, moment nodes podem ser projection sem virar endpoint permanente de `entity_relations` V1.

Se no futuro precisarmos relações first-class `entity -> event`, modelar um domínio de subject/object mais geral em ADR própria; não enfraquecer FK de entity hoje.

## Slugs e labels iniciais

Abaixo é **vocabulário de trabalho**, não seed aprovada:

| Slug candidato | Direção | Exemplo de label |
| --- | --- | --- |
| `friend_of` | symmetric | Amizade |
| `ally_of` | symmetric | Aliança |
| `family_of` | symmetric | Família |
| `rival_of` | symmetric ou directed a decidir | Rivalidade |
| `mentor_of` | directed | Mentor de |
| `companion_of` | symmetric | Companheiros |
| `owes_debt_to` | directed | Deve a |
| `serves` | directed | Serve a |
| `controls` | directed | Controla |
| `betrayed` | directed | Traiu |
| `originates_from` | directed | Origem |
| `member_of` | directed | Membro de |
| `devoted_to` | directed | Devoto de |
| `created` | directed | Criou |
| `performed` | directed | Performou |

Cada tipo precisa de exemplos reais antes de entrar na seed.

## Constraints obrigatórias no desenho físico

- source e target pertencem à mesma campanha da relation;
- source != target, salvo tipo explicitamente self-referential (nenhum previsto agora);
- relation type existe;
- datas/status coerentes quando temporalidade for adicionada;
- endpoints não são deletados silenciosamente;
- duplicata simétrica é impedida;
- índices suportam 1-hop por source e target;
- RLS/policies não vazam relation secreta;
- grants/RPCs revisados;
- mutation factual valida actor/capability/scope no servidor;
- concorrência evita last-write-wins silencioso;
- audit/source/review permanecem na mesma operação lógica conforme cada fatia ganhar suporte.

A #119 cobre o núcleo de endpoints/tipo/duplicata/authorization/revision/audit; provenance write e temporalidade detalhada continuam explicitamente fora desta primeira fatia.

## Índices esperados

No mínimo, avaliar:

```text
(campaign_id, source_entity_id, status)
(campaign_id, target_entity_id, status)
(campaign_id, relation_type_slug, status)
entity_relation_sources(canon_entry_id)
```

A forma final depende das queries reais e advisors após dados de teste. A candidata #119 cria índices para os principais caminhos source/target/type/status; advisors pós-migration continuam gate antes de chamar isso de otimizado.

## Delete policy

Preferência: relations canônicas/históricas não usam hard delete em operação editorial normal.

Hard delete fica para:

- dado inserido por erro técnico antes de publicação;
- fixture/teste;
- obrigação administrativa específica;
- rollback controlado de migration/backfill.

Retcon não é delete.

## Auditoria

Mudanças relevantes precisam entrar em `audit_log` ou mecanismo equivalente do Edit:

- create;
- change type;
- change visibility;
- end;
- supersede;
- restore;
- source attachment/removal.

A candidata #119 registra `world_graph.publish` por snapshot factual publicado. Auditoria granular de source attachment/removal pertence à fatia de provenance e não deve ser simulada por metadata.

## API/projection

O World Explorer não precisa receber a row completa.

Projection pública mínima:

```ts
{
  id,
  source,
  target,
  relationType,
  label,
  direction,
  family
}
```

Temporalidade, source e status detalhados entram apenas quando a experiência pedir. Estilo visual pode ser projetado separadamente sem expor provenance/review privado.

## Backfill

Não criar backfill automático de relations por NLP/coocorrência.

Primeiro conjunto real deve vir de:

- canon já aprovado;
- revisão manual das relations centrais;
- fonte identificável.

O dataset visual de referência pode gerar fixtures, mas não rows canônicas sem revisão.

## Open questions antes de declarar a V1 factual completa

1. convenção de inverse types;
2. `rival_of` é simétrica ou pode ser unilateral?;
3. relation type custom por campanha será permitido além do catálogo inicial?;
4. quais 8–12 relation types cobrem 90% da campanha real?;
5. uma relation histórica importada pode existir sem `canon_entry` e, se sim, sob qual estado/visibility sem escapar do review gate?;
6. como anexar/remover `entity_relation_sources` com capability, audit e conflito sem abrir CRUD genérico?;
7. como tratar pets/companions quando ainda não estiver claro se são PC/NPC/concept?;
8. como representar vínculo com divindade/patrono sem conflar pessoa, facção e conceito?;
9. quando temporalidade real exigir `started_session_id`/`ended_session_id`, qual migration compatível adiciona isso sem inventar história para relações existentes?;
10. qual UX de review/provenance permite promover uma relation privada/review para pública com receipt claro?

## Critério para aprovar/aplicar a migration candidata #119

- contrato físico e invariantes revisados contra o banco real;
- capability e boundary documentados em `database/security.md` + `rpc-inventory.md`;
- PostgreSQL sintético cobrindo autorização, draft/publish/recovery, conflito, duplicata simétrica e rollback;
- CI terminal no SHA exato, incluindo build/E2E;
- preflight read-only do Supabase, migration history e advisors imediatamente antes do DDL;
- aplicação controlada pelo database runbook;
- validação pós-migration de RLS/grants/RPCs, contagens existentes e migration history;
- `verification-log.md` atualizado somente com evidência realmente observada;
- nenhuma ativação de `TDA_WORLD_CANONICAL_ENABLED` até existir dataset real revisado suficiente e validação visual da experiência pública.

Até a aplicação deliberada dessa migration, o schema de relations de produção permanece inalterado. Mesmo depois da infraestrutura instalada, o World público continua demonstrativo até a ativação canônica ser explicitamente autorizada; a existência de tabelas novas não é aprovação de fatos nem publicação de dados reais.