# Feature/conceito — Intents / intenção

> Status: **não definido / não encontrado como conceito canônico**
> Owner: não atribuído
> Última revisão: 2026-09-06

## Por que este documento existe

Durante o alinhamento foi citado "intent" junto de personagens/NPCs e features futuras. A revisão do schema real e das fontes históricas consultadas **não encontrou tabela, coluna ou definição canônica chamada `intent`/`intents`/`intenção`**.

Criar este placeholder documentado impede duas coisas:

1. esquecermos que o conceito foi mencionado;
2. alguém inventar uma tabela `intents` sem saber o que ela deveria representar.

## O que existe com nome parecido

### `item`

Existe e é um `entity_type` canônico. Se a intenção original era "item", não há feature `intent` separada.

### Possible hook / planning

`canon_candidates.status=possible_hook` representa possibilidade narrativa futura, mas não se chama intent e não deve ser renomeado sem motivo.

### Player action / table planning

Classificação histórica de evidência pode registrar ação/plano, mas isso também não define uma entity chamada intent.

## Possíveis significados — **hipóteses, não requisitos**

`intent` poderia significar futuramente:

- intenção de personagem;
- intenção do jogador detectada na fala;
- plano de NPC/DM;
- intent de comando/NLU para bot;
- objetivo/quest;
- intenção editorial/classificação.

Esses significados têm modelos e regras de privacidade completamente diferentes. Portanto não escolher um por adivinhação.

## Critério para promover a conceito real

O proprietário precisa fornecer pelo menos um exemplo concreto do que "intent" deve responder.

Então documentar:

- quem é o sujeito da intent;
- conteúdo/estado;
- temporalidade;
- é fato, plano ou inferência?;
- source/evidence;
- precisa review?;
- visibility/audience;
- relação com quest/hook/knowledge;
- queries/UX necessárias.

Só depois decidir se:

- reutiliza tabela/conceito existente;
- vira novo domínio/feature;
- exige migration.

## Guardrail

Até definição explícita:

- **não criar `intents` table**;
- não adicionar `entity_type=intent`;
- não usar JSONB `intent` como contrato informal;
- não assumir que `item` e `intent` são a mesma coisa no texto/documentação.
