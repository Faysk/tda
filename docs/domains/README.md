# Domínios do TDA

> Status: vigente
> Owner: produto/arquitetura
> Última revisão: 2026-09-06

Domínios descrevem **regras do produto**, independentes da tela ou fornecedor externo que as implementa.

## Índice

1. [Identidade, Auth e autorização](identity-access.md)
2. [Campanhas, sessões e participantes](sessions.md)
3. [Evidências, transcrição e classificação](evidence.md)
4. [Entidades, personagens e mundo narrativo](entities.md)
5. [Canon, revisão e publicação](canon-review.md)
6. [Processamento, jobs e áudio](processing.md)

## Dependências entre domínios

```text
identity/access
      │
      ├──────────────┐
      ▼              ▼
sessions         authorization
      │
      ▼
evidence/transcription
      │
      ▼
classification/candidates
      │
      ▼
review/canon/publication
      │
      ▼
entities/memory
      │
      └─ futuro: relations / knowledge / timeline / maps / semantic search

processing/audio sustenta sessions/evidence sem possuir a autoridade narrativa.
```

## Regra de fronteira

- **Identidade** responde quem é a pessoa e o que ela pode fazer.
- **Sessão** responde quando/onde uma ocorrência da mesa pertence.
- **Evidência** responde o que foi capturado/derivado e de qual fonte.
- **Entity** responde qual objeto narrativo persistente está sendo referido.
- **Review/Canon** responde o que foi aceito como memória/publicação.
- **Processing** responde como trabalho técnico é executado, repetido e rastreado.

Uma tabela pode servir mais de um domínio, mas apenas um conceito deve ser dono da regra principal.

## Anti-acoplamentos

- UI não define canon.
- provedor de transcrição não define evidência final.
- Discord/Roll20 não definem identidade canônica.
- storage não define visibilidade.
- role label não define capability.
- participant não define profile global.
- nome textual não define entity global.

## Domínios futuros

Ainda não possuem contrato fechado próprio:

- relations/grafo;
- knowledge/audience;
- maps/geografia;
- semantic search;
- live session avançada;
- narrative clocks;
- rumor generation.

Quando um deles entrar no roadmap executável, deve ganhar um documento próprio antes do schema principal.
