# Feature — Relações entre entidades e grafo

> Status: em desenho
> Owner: narrative-memory
> Última revisão: 2026-09-06

## Valor

Responder e visualizar relações narrativas como família, aliança, dívida, traição, conflito e vínculos políticos sem depender de texto livre.

## Fonte histórica

O `dnd-scribe` previa grafo com "quem conhece quem", alianças, dívidas, traições, família, segredos e "quem sabe o quê". O reboot revalida **relations** como direção, mas separa knowledge/segredos quando a semântica exigir.

## Base existente

- registry `entities`;
- canon/evidence;
- visibility;
- mentions/timeline.

Não existe tabela de relation aprovada atualmente.

## Contrato mínimo antes de migration

Uma relation first-class precisa definir pelo menos:

- source entity;
- target entity;
- relation type;
- direção ou simetria;
- status/lifecycle;
- início/fim temporal quando aplicável;
- visibility/audience;
- evidence/canon source;
- confidence somente para proposta, nunca como canon automático;
- review state/provenance.

## Exemplos de semântica

### Simétrica

`family_of`, `allied_with` podem ser simétricas dependendo do vocabulário.

### Direcionada

`owes_debt_to`, `betrayed`, `serves`, `controls` normalmente têm direção.

### Temporal

Aliança pode ter começado/terminado; relação não deve ser sobrescrita sem histórico.

## Relation candidate vs relation canônica

A arquitetura deve permitir que IA sugira relações a partir de evidence sem criar edge oficial diretamente.

Direção recomendada:

```text
evidence -> relation candidate/review -> active relation
```

Se o modelo geral de `canon_candidates` puder representar isso sem ambiguidade, reutilizá-lo; se não, desenhar contrato próprio antes da DDL.

## Knowledge não é automaticamente relation

"Dandelion conhece NPC X" pode ser relation social.

"Dandelion sabe que X é traidor" envolve **claim/conhecimento + sujeito + audience + verdade percebida**, tratado em [knowledge-audience.md](knowledge-audience.md).

## Visualização

React Flow é candidato histórico para UI, não decisão arquitetural.

Antes de escolher biblioteca:

- medir quantidade de nodes/edges;
- mobile/zoom/keyboard/accessibility;
- lista/detalhe alternativo acessível;
- layout persistente vs calculado;
- filtros por tipo/audience/time;
- versão/licença/dependências atualizadas no momento da implementação.

## Critérios de aceite do modelo

- homônimos resolvidos por UUID;
- relation tem evidence ou origem manual auditável;
- player não recebe edge secreto;
- directed/symmetric sem ambiguidade;
- retcon/end não apaga histórico;
- queries de vizinhança são indexáveis;
- UI visual não é única forma de consumir dados.

## Não fazer agora

- `relations` em JSON dentro de `entities.metadata`;
- edge por simples coocorrência de mentions;
- schema moldado especificamente para React Flow;
- misturar rumor/mentira/knowledge sem semântica.
