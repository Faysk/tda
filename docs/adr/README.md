# Architecture Decision Records

> Status: vigente
> Owner: arquitetura

ADRs registram **por que** decisões estruturais foram tomadas. Eles não substituem docs de implementação; evitam perder contexto e repetir debates.

## Estados

- `proposed` — em discussão;
- `accepted` — decisão vigente;
- `superseded` — substituída por ADR posterior;
- `rejected` — considerada e não adotada.

## Índice

| ADR | Status | Decisão |
| --- | --- | --- |
| [0001](0001-project-identity.md) | accepted | `tda` é reboot canônico; `dnd-scribe` é legado |
| [0002](0002-existing-supabase.md) | accepted | reutilizar Supabase existente como única base |
| [0003](0003-local-heavy-processing.md) | accepted | processamento pesado local, produto cloud |
| [0004](0004-canonical-entities.md) | accepted | PC/NPC/mundo na registry única `entities` |
| [0005](0005-canon-review-gate.md) | accepted | fonte → candidato → revisão → canon/publicação |

## Quando criar ADR

Criar quando a decisão:

- altera boundary do sistema;
- cria/remove banco/serviço principal;
- muda estratégia de Auth/security;
- muda ownership de dados;
- introduz compromisso difícil de reverter;
- altera processamento local vs cloud;
- substitui uma decisão accepted anterior.

Não criar ADR para detalhe puramente visual ou refactor local sem consequência arquitetural.

## Regra histórica

Não editar ADR antigo para fazer parecer que a decisão sempre foi outra. Criar novo ADR e marcar `superseded`.

Template: [adr-template.md](../documentation/adr-template.md).
