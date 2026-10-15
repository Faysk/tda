# 🧭 Decisões arquiteturais (ADRs)

**Para quem:** contribuidores e pessoas que querem entender **por que** o TDA foi construído dessa forma.

Uma **ADR** é um *Architecture Decision Record*: uma decisão relevante, com contexto, opções e consequências. Ela não substitui o código nem prova que um recurso foi publicado.

## Como ler o status de uma decisão

| Estado | Significado |
| --- | --- |
| **accepted** | Direção arquitetural aprovada |
| **proposed** | Ainda em avaliação |
| **superseded** | Substituída por decisão posterior |
| **rejected** | Considerada, mas não adotada |

**Exemplo importante:** a ADR-0014 é histórica e foi substituída pela ADR-0018, que define core portátil e providers substituíveis. A ADR-0021 substitui **apenas a parte de exclusão local** da ADR-0016: a exclusão confirmada do resultado local **não** oferece lixeira restaurável de sete dias. Isso não muda a publicação cloud, que possui ciclo separado.

## Mapa das decisões

| Assunto | ADRs |
| --- | --- |
| Identidade do reboot e banco | [0001](https://github.com/Faysk/tda/blob/main/docs/adr/0001-project-identity.md), [0002](https://github.com/Faysk/tda/blob/main/docs/adr/0002-existing-supabase.md) |
| ASR e Companion | [0003](https://github.com/Faysk/tda/blob/main/docs/adr/0003-local-heavy-processing.md), [0013](https://github.com/Faysk/tda/blob/main/docs/adr/0013-companion-agent-desktop-asr.md), [0017](https://github.com/Faysk/tda/blob/main/docs/adr/0017-web-single-entry-loopback-session.md) |
| Canon, entidades e revisão | [0004](https://github.com/Faysk/tda/blob/main/docs/adr/0004-canonical-entities.md), [0005](https://github.com/Faysk/tda/blob/main/docs/adr/0005-canon-review-gate.md), [0016](https://github.com/Faysk/tda/blob/main/docs/adr/0016-transcript-runs-review-publication.md) |
| World Explorer e layout | [0006](https://github.com/Faysk/tda/blob/main/docs/adr/0006-react-flow-world-explorer.md), [0009](https://github.com/Faysk/tda/blob/main/docs/adr/0009-world-explorer-multihub-layout.md), [0010](https://github.com/Faysk/tda/blob/main/docs/adr/0010-world-explorer-editorial-layout-persistence.md), [0011](https://github.com/Faysk/tda/blob/main/docs/adr/0011-world-explorer-layout-physical-persistence.md) |
| Autorização e campanhas | [0008](https://github.com/Faysk/tda/blob/main/docs/adr/0008-capability-authorization.md), [0020](https://github.com/Faysk/tda/blob/main/docs/adr/0020-first-class-campaigns.md) |
| Entrega e recuperação | [0012](https://github.com/Faysk/tda/blob/main/docs/adr/0012-github-actions-controlled-delivery.md), [0015](https://github.com/Faysk/tda/blob/main/docs/adr/0015-recovery-oriented-delivery.md), [0021](https://github.com/Faysk/tda/blob/main/docs/adr/0021-local-run-delete-tombstone.md) |
| Arquitetura de provedores | [0018](https://github.com/Faysk/tda/blob/main/docs/adr/0018-portable-core-github-control-plane.md) |
| Múltiplas gravações e overlaps | [0019](https://github.com/Faysk/tda/blob/main/docs/adr/0019-multi-recording-session-assembly.md), [0022](https://github.com/Faysk/tda/blob/main/docs/adr/0022-conservative-overlap-resolution.md) |

O índice técnico canônico enumera as **22 ADRs** e explica seus estados: [Índice completo das decisões](https://github.com/Faysk/tda/blob/main/docs/adr/README.md).

## Quando é necessário criar outra ADR?

Quando uma mudança altera fronteira de segurança, identidade, estratégia de dados, tecnologia estrutural, provedor principal ou contradiz decisão aceita. Para evoluções pontuais de tela, podem bastar documentação da feature, PR e testes.

**Regra de ouro:** nunca editar o texto de uma ADR antiga para fingir que a decisão nunca existiu. Uma nova decisão pode corrigir ou substituir a anterior, preservando o histórico.

Continue: [Arquitetura](https://github.com/Faysk/tda/wiki/Arquitetura) · [Desenvolvimento](https://github.com/Faysk/tda/wiki/Desenvolvimento) · [Releases](https://github.com/Faysk/tda/wiki/Operacoes-e-releases).
