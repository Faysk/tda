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
| [0006](0006-react-flow-world-explorer.md) | accepted | React Flow visualiza o World Explorer sem definir domínio/schema |
| [0007](0007-edit-workbench.md) | accepted | Edit é workbench server-first, incremental e orientado a capabilities |
| [0008](0008-capability-authorization.md) | accepted | Auth novo autoriza por capability + scope, sem super-role implícita |
| [0009](0009-world-explorer-multihub-layout.md) | accepted | World Explorer abre multi-hub; foco é temporário e dragging é layout local |
| [0010](0010-world-explorer-editorial-layout-persistence.md) | accepted | layout editorial é snapshot versionado separado de canon/relations e filtrado por audience |

## Quando criar ADR

Criar quando a decisão:

- altera boundary do sistema;
- cria/remove banco/serviço principal;
- muda estratégia de Auth/security;
- muda ownership de dados;
- introduz compromisso difícil de reverter;
- escolhe tecnologia que vira boundary importante da experiência;
- altera processamento local vs cloud;
- substitui uma decisão accepted anterior.

Não criar ADR para detalhe puramente visual ou refactor local sem consequência arquitetural.

A adoção de React Flow recebeu ADR porque define a engine de uma superfície principal e estabelece explicitamente que a biblioteca fica isolada atrás de uma projection layer, evitando acoplamento de schema.

O Edit recebeu ADR porque define uma superfície administrativa principal, seu boundary de autorização, sua estratégia de migração do legado e a decisão de permanecer dentro do mesmo frontend/runtime do TDA.

Auth/capabilities recebeu ADR porque muda a estratégia de autorização do reboot: novas superfícies deixam de decidir acesso por nome de role e passam a exigir capability + scope + ownership explícitos.

O World Explorer multi-hub recebeu ADR porque substitui partes estruturais do primeiro slice do ADR-0006: a visão padrão deixa de ter um único foco central e o dragging público passa a ser reorganização visual local, sem virar dado de canon ou persistência implícita.

A persistência editorial do World Explorer recebeu ADR porque cria um novo ownership de estado: coordenadas podem ser salvas no futuro, mas continuam fora de canon/relations, exigem audience filtering, revision e autorização própria antes de qualquer storage físico.

## Regra histórica

Não editar ADR antigo para fazer parecer que a decisão sempre foi outra. Criar novo ADR e marcar `superseded`.

Template: [adr-template.md](../documentation/adr-template.md).
