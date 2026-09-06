# ADR-0002 — Reutilizar o Supabase existente como única base

> Status: accepted
> Data: 2026-09-06

## Contexto

O projeto existente `dmrqnbdvbkfqzctcerbx` contém sessões, transcrições, candidates, jobs, RBAC e demais dados reais. Criar uma base nova para o reboot aumentaria migração, duplicação, drift e risco de perda/inconsistência.

## Opções

1. criar Supabase novo e migrar tudo;
2. manter banco antigo e criar camada de proxy obrigatória;
3. reutilizar banco existente, evoluindo por migrations revisadas.

## Decisão

Adotar opção 3.

- Supabase existente é a única base canônica;
- reboot consulta/escreve somente contratos necessários;
- novas DDL entram por migrations TDA;
- legado continua compatível durante transição;
- production não é resetável por conveniência.

## Consequências positivas

- preserva dados reais;
- reduz migração e custo;
- permite entrega incremental;
- mantém provenance/history.

## Trade-offs

- schema contém dívida/estruturas legadas;
- autorização possui modelos coexistentes;
- migrations novas precisam considerar consumidores antigos;
- documentação deve separar físico vigente de intenção histórica.

## Guardrails

- nenhuma tabela nova só para duplicar dados existentes;
- nenhuma remoção destrutiva sem dependências mapeadas;
- RLS/grants/RPCs tratados como contrato;
- auditoria de schema antes de grandes mudanças.

## Condição de revisão

Reavaliar apenas se limitações comprovadas do projeto existente tornarem impossível atender requisito central de segurança/escala/operação e houver plano formal de migração.
