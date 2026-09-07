# Operação — índice

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-07

Este diretório contém os procedimentos que devem ser executáveis por alguém que não estava na cabeça de quem implementou a feature.

## Runbooks

- [Ambientes e configuração](environments.md)
- [Release, deploy e rollback](release-runbook.md)
- [Operação do banco / Supabase](database-runbook.md)
- [Checklist de segurança operacional](security-checklist.md)
- [Política resumida de publicação](../releases.md)
- [Infraestrutura e estado](../infrastructure.md)

## Princípios operacionais

1. merge e deploy são eventos diferentes;
2. production não é sandbox;
3. secret não entra em Git/log/browser;
4. toda release conhece seu SHA;
5. migration e app precisam de compatibilidade coordenada;
6. rollback é pensado antes da promoção;
7. Preview não usa production irrestrita;
8. deploy não é forma de testar mudança em loop;
9. estado de fornecedor precisa ser verificado na conta correta;
10. incidentes e desvios viram documentação/ADR quando revelam regra nova.

## Matriz rápida

| Mudança | Precisa CI | Precisa migration | Precisa revisão segurança | Pode exigir deploy |
| --- | --- | --- | --- |
| docs | sim | não | normalmente não | não |
| UI estática | sim | não | se muda exposição | sim |
| query/API | sim | talvez | sim | sim |
| schema | sim | sim | sim | geralmente |
| RLS/RPC/grant | sim | sim | obrigatório | talvez |
| env/secret | validação | não | obrigatório | normalmente |
| DNS/domain | smoke | não | obrigatório | operação separada |

## Runbook incompleto é dívida

Toda feature que exige procedimento manual recorrente deve adicionar/atualizar runbook. Não deixar passos críticos apenas em chat, memória ou histórico de terminal.
