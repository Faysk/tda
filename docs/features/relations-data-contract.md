# Feature — contrato de dados para relações

> Status: proposta canônica para revisão; **nenhuma DDL aprovada/aplicada ainda**
> Owner: narrative-memory / database / security
> Última revisão: 2026-09-06

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

## Duas camadas propostas

```text
relation_types
entity_relations
entity_relation_sources
```

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

## Directionality

### `symmetric`

A relação significa o mesmo nos dois sentidos.

Exemplos possíveis, sujeitos ao vocabulário real:

- `friend_of`;
- `sibling_of`;
- `allied_with`.

A UI pode renderizar uma única edge.

No banco, endpoints devem ser normalizados para impedir duplicatas `A-B` e `B-A`.

**Detalhe de implementação da normalização ainda precisa ser definido antes da DDL** porque depende de constraint/function e do catálogo `relation_types`.

### `directed`

Origem e destino importam.

Exemplos:

- `mentors`;
- `owes_debt_to`;
- `serves`;
- `controls`;
- `betrayed`;
- `originates_from`.

A UI pode apresentar label diferente no sentido inverso usando `inverse_slug`.

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

Famílias candidatas:

- `affinity`;
- `family`;
- `conflict`;
- `authority`;
- `faction`;
- `origin`;
- `mystic`;
- `creative`;
- `other`.

A lista só deve ser fechada depois de testar relações reais da campanha.

A UI converte family/type em tokens visuais. Banco **não guarda hexadecimal**.

## Lifecycle

Estados propostos:

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

A relation pode passar para `ended` com `ended_session_id`, preservando a timeline.

Se a relação anterior era factual mas foi substituída por retcon, usar `superseded`/histórico apropriado, não DELETE como correção editorial comum.

## Visibility

Reutilizar, se confirmado na migration, o vocabulário já presente em `entities`, `canon_entries` e `publications`:

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

## Constraints obrigatórias a desenhar na migration

- source e target pertencem à mesma campanha da relation;
- source != target, salvo tipo explicitamente self-referential (nenhum previsto agora);
- relation type existe;
- datas/status coerentes;
- endpoints não são deletados silenciosamente;
- duplicata simétrica é impedida;
- índices suportam 1-hop por source e target;
- RLS/policies não vazam relation secreta;
- grants/RPCs revisados.

## Índices esperados

No mínimo, avaliar:

```text
(campaign_id, source_entity_id, status)
(campaign_id, target_entity_id, status)
(campaign_id, relation_type_slug, status)
entity_relation_sources(canon_entry_id)
```

A forma final depende das queries reais e advisors após dados de teste.

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

A estratégia exata de trigger vs application log será definida na migration/feature do Edit.

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

Temporalidade, source e status detalhados entram apenas quando a experiência pedir.

## Backfill

Não criar backfill automático de relations por NLP/coocorrência.

Primeiro conjunto real deve vir de:

- canon já aprovado;
- revisão manual das relations centrais;
- fonte identificável.

O dataset visual de referência pode gerar fixtures, mas não rows canônicas sem revisão.

## Open questions antes da DDL

1. convenção de inverse types;
2. `rival_of` é simétrica ou pode ser unilateral?;
3. relation type custom por campanha será permitido na V1?;
4. `visibility` exatamente reaproveita enum/check atual ou ganha domínio compartilhado?;
5. como normalizar endpoints simétricos em constraint segura?;
6. `created_by` aponta profile ou decisão de review?;
7. uma relation pode existir sem `canon_entry` por import histórico manual?;
8. quais 8–12 relation types cobrem 90% da campanha real?;
9. como tratar pets/companions quando ainda não estiver claro se são PC/NPC/concept?;
10. como representar vínculo com divindade/patrono sem conflar pessoa, facção e conceito?

## Critério para aprovar migration

- responder as open questions necessárias para V1;
- validar o vocabulário com exemplos reais de Dandelion/Screacky/Astel;
- desenhar RLS/RPC/capabilities;
- escrever migration + rollback lógico;
- criar queries de teste para 1-hop e visibilidade;
- criar seed mínimo apenas de tipos aprovados;
- rodar advisors pós-migration;
- documentar resultado real em `database/`.

Até isso acontecer, o World Explorer usa fixtures/projection demo e o schema de produção permanece inalterado.