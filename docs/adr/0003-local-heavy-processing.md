# ADR-0003 — Processamento pesado local; produto cloud

> Status: accepted
> Data: 2026-09-06

## Contexto

Transcrição e processamento de áudio consomem CPU/GPU, storage e/ou APIs pagas. O produto web precisa continuar disponível sem exigir uma máquina pessoal ligada continuamente.

O legado já possui companion/pipeline local funcional que pode ser modernizado.

## Decisão

- site e futuro Edit operam em cloud;
- processamento pesado de áudio/transcrição permanece local;
- companion sincroniza resultados/metadados necessários;
- conteúdo sincronizado funciona com PC desligado;
- raw audio não é requisito de retenção cloud;
- jobs/sync devem ser retomáveis e idempotentes.

## Consequências positivas

- aproveita hardware local;
- reduz custo cloud;
- reduz retenção de áudio sensível;
- site não depende de worker doméstico online.

## Trade-offs

- exige protocolo de sync;
- distribuição/update do companion vira responsabilidade;
- offline/retry e compatibilidade de versão precisam ser tratados;
- observabilidade fica distribuída entre local e cloud.

## Guardrails

- companion não recebe secret administrativo irrestrito distribuível;
- cloud não promove derivação para canon automaticamente;
- processamento novo é comparado com baseline antes de substituir fluxo funcional;
- cache/hashes preservam deduplicação e lineage.

## Condição de revisão

Reavaliar se custo/complexidade operacional local superar benefício comprovado ou se uma solução cloud ficar claramente superior em custo, privacidade, confiabilidade e manutenção para a carga real.
