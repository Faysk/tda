# Feature — Relações entre entidades e grafo

> Status: arquitetura visual aprovada; schema de relations em desenho
> Owner: narrative-memory
> Última revisão: 2026-09-06

## Valor

Responder e visualizar relações narrativas como família, aliança, dívida, traição, conflito, origem, autoridade e vínculos políticos sem depender de texto livre.

## Fonte histórica

O `dnd-scribe` previa grafo com "quem conhece quem", alianças, dívidas, traições, família, segredos e "quem sabe o quê".

O reboot revalida **relations** como direção, mas separa knowledge/segredos quando a semântica exigir. O legado também separava explicitamente "quem vê no sistema" de "quem sabe na ficção", distinção preservada em [knowledge-audience.md](knowledge-audience.md).

## Base existente

- registry `entities`;
- canon/evidence;
- visibility;
- mentions/timeline;
- RBAC/capabilities;
- World Explorer documentado;
- Design System/Brand Pack oficiais.

Não existe tabela de relation aprovada atualmente.

## Decisão de visualização

React Flow (`@xyflow/react`) foi promovido de candidato histórico para **engine aprovada de visualização** em [ADR-0006](../adr/0006-react-flow-world-explorer.md).

Boundary:

```text
relation/domain data
  -> authorization/audience filter
  -> projection DTO
  -> React Flow
```

React Flow não define:

- relation types;
- directionality;
- canon;
- sources;
- visibility;
- schema;
- status narrativo.

A visualização oficial da feature está descrita em [World Explorer](world-explorer.md) e [world-explorer-ui.md](../design-system/world-explorer-ui.md).

## Contrato de domínio

A proposta detalhada para revisão está em [relations-data-contract.md](relations-data-contract.md).

Uma relation first-class precisa definir pelo menos:

- source entity;
- target entity;
- relation type;
- direção ou simetria;
- status/lifecycle;
- início/fim temporal quando aplicável;
- visibility/audience;
- canon source;
- review/provenance;
- auditabilidade.

## Exemplos de semântica

### Simétrica

Possíveis exemplos:

- amizade;
- aliança;
- família;
- companheirismo.

A simetria precisa ser propriedade do tipo de relation, não inferida pela UI.

### Direcionada

Exemplos:

- mentor de;
- deve a;
- serve a;
- controla;
- traiu;
- membro de;
- origem.

### Temporal

Aliança, rivalidade, serviço e outros vínculos podem começar/terminar. Relação histórica não deve ser sobrescrita/apagada só porque deixou de estar ativa.

## Relation candidate vs relation canônica

IA pode sugerir relações a partir de evidence sem criar edge oficial diretamente.

Direção:

```text
evidence
 -> canon candidate do tipo relation
 -> revisão humana
 -> canon entry
 -> entity relation
```

O schema existente de `canon_candidates` possui `candidate_type` textual e `related_entity_ids`, portanto pode sustentar a fase de candidate inicialmente. Se uso real revelar ambiguidade, uma tabela `relation_candidates` exigirá nova decisão/documentação.

## Mention não é relation

`entity_mentions` registra presença/referência em evidence.

Duas entities no mesmo segmento **não** provam amizade, conflito ou qualquer outro vínculo.

Coocorrência pode ajudar a gerar sugestão de revisão, nunca edge canônico automático.

## Knowledge não é automaticamente relation

"Dandelion conhece NPC X" pode ser um vínculo social dependendo do significado real.

"Dandelion sabe que X é traidor" envolve **claim + sujeito + estado de crença/conhecimento + audience + temporalidade**, tratado em [knowledge-audience.md](knowledge-audience.md).

Também é possível que a própria relation seja secreta, mesmo com os dois endpoints visíveis.

## Status de entity não é relation

`deceased`, `missing`, `inactive` etc. são estados da entity/cronologia.

Não criar uma família de edges para representar estados só porque a legenda visual da referência usa cores diferentes.

## Event/moment não precisa virar entity

O World Explorer pode projetar sessões/canon/momentos como nodes sem adicionar `event` à registry `entities`.

O contrato principal de relation V1 continua entity ↔ entity.

## Visualização V1

### Layout

- radial;
- entity focada no centro;
- 1-hop default;
- 2-hop sob ação explícita;
- sem grafo inteiro por padrão.

### Interação

- pan/zoom;
- seleção;
- trocar foco;
- filtros;
- inspector;
- lista textual alternativa;
- sem criar/deletar edges no modo público.

### Custom nodes/edges

A identidade visual vem do TDA Design System. Cores da relation são derivadas de semântica/tokens na UI, nunca persistidas como hex no banco.

## Primeiro vertical slice

Foco: **Dandelion**.

O slice usa fixtures quando a relação real ainda não possuir fonte/revisão. Fixtures são explicitamente demo e não entram no Supabase como canon.

Objetivos:

- validar custom nodes;
- validar edge labels;
- validar layout radial;
- validar inspector;
- validar light/dark;
- validar mobile;
- validar keyboard/list fallback;
- validar projection boundary.

## Critérios de aceite do modelo

Antes da migration real:

- homônimos resolvidos por UUID/slug;
- relation tem canon source ou origem manual revisada transformada em canon;
- player não recebe edge secreto;
- directed/symmetric sem ambiguidade;
- retcon/end não apaga histórico;
- queries 1-hop são indexáveis;
- endpoints pertencem à mesma campanha;
- relation type é catálogo estruturado;
- fontes não ficam em array JSON sem FK;
- UI visual não é única forma de consumir dados;
- advisors/RLS/grants são revisados após migration.

## Não fazer agora

- `relations` em JSON dentro de `entities.metadata`;
- edge canônico por simples coocorrência de mentions;
- schema com `x`, `y`, handle ou propriedades específicas de React Flow;
- cor física no banco;
- misturar rumor/mentira/knowledge sem semântica;
- aplicar migration antes de fechar as open questions da [spec de dados](relations-data-contract.md).