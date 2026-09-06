# Feature — Quests e ganchos

> Status: preparado/em desenho
> Owner: narrative-memory
> Última revisão: 2026-09-06

## Valor

Organizar objetivos, promessas, ameaças e ganchos narrativos sem confundir uma possibilidade futura com evento já ocorrido.

## Base existente

- `entities(type=quest)`;
- `canon_candidates.status=possible_hook`;
- sessions/evidence/canon;
- relations futuras;
- visibility.

## Diferença fundamental

### Hook

Possibilidade, pista ou oportunidade. Pode nunca acontecer.

### Quest

Objeto narrativo acompanhado explicitamente, potencialmente com lifecycle/objetivo.

### Canon event

Algo que efetivamente aconteceu.

Um `possible_hook` não vira canon só porque foi salvo.

## Lifecycle a decidir

Antes de enum/schema adicional, validar necessidades reais. Possíveis estados:

- discovered;
- active;
- blocked;
- completed;
- failed;
- abandoned;
- hidden.

Não aprovar esses valores sem exemplos da campanha.

## Dados possíveis

- quest entity;
- title/summary;
- source/evidence;
- related entities/locations/factions;
- responsible/affected characters;
- status history;
- visibility;
- discovered/resolved session;
- related canon entries.

## Mestre vs jogadores

Uma quest pode possuir:

- objetivo conhecido pelos jogadores;
- causa/verdade secreta do mestre;
- progresso visível;
- consequência ainda oculta.

Não colocar tudo no mesmo summary enviado ao client.

## Critérios de aceite futuro

- diferenciar hook de quest/fact;
- histórico de estado;
- links para entities/sessions;
- audience correta;
- conclusão não apaga origem;
- busca/timeline podem encontrar quest por fonte.

## Não fazer agora

- gerar quests automaticamente como compromisso do mestre;
- transformar todo `possible_hook` em `entity(type=quest)`;
- esconder state machine complexo em metadata sem contrato.
