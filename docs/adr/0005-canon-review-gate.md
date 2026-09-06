# ADR-0005 — Canon exige fonte e revisão

> Status: accepted
> Data: 2026-09-06

## Contexto

O TDA processa transcrições e saídas de IA que misturam narração, ações, mecânica, piadas, planos, hipóteses e informação privada. Promover automaticamente texto/IA para memória oficial criaria retcons e vazamentos.

## Decisão

Adotar pipeline explícito:

```text
source/evidence
 -> classification/derivation
 -> candidate
 -> human review
 -> canon entry / publication
```

- evidence nunca é canon automaticamente;
- candidate possui estados para interpretação/hook/retcon/private;
- `canon_entries` consolida apenas decisões aprovadas;
- publication possui lifecycle/audience próprio;
- source/provenance é preservada.

## Consequências positivas

- reduz lore inventado;
- permite auditoria;
- preserva interpretação como interpretação;
- retcon pode ser tratado explicitamente;
- IA continua útil sem ganhar autoridade indevida.

## Trade-offs

- exige trabalho de revisão humana;
- UI de review é feature central;
- ingest/classification não produz automaticamente wiki completa;
- memória pode ficar vazia até revisão real ocorrer.

## Guardrails

- migration não popula canon para "completar" tabela;
- reprocessamento não sobrescreve decisão humana;
- embedding/search não muda status canônico;
- Roll20/Discord marker de canon é evidência/intenção forte, não bypass oculto;
- outtake/public approval é separado de canon.

## Condição de revisão

Automação pode aumentar quando métricas e workflows permitirem auto-triage confiável, mas promoção para canon sem gate humano exige novo ADR explícito e análise de risco.
