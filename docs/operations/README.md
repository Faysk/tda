# Operação — índice

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-20

Este diretório contém procedimentos executáveis. Histórico explica o passado; runbook vigente governa a operação atual.

## Ordem de leitura

1. [ADR-0018](../adr/0018-portable-core-github-control-plane.md) — control plane, providers substituíveis, free-first e documentação obrigatória.
2. [CI/CD — operação, promoção e recuperação](ci-cd.md) — comportamento atual da esteira e drift conhecido.
3. [CI/CD — configuração administrativa](cicd-admin-setup.md) — Environments, secrets e providers.
4. [Ambientes e configuração](environments.md) — limites Development/Preview/Production.
5. [Media Storage — runbook](r2-media-runbook.md) — preparação, publicação, diagnóstico e recuperação.
6. [Release, deploy e rollback](release-runbook.md).
7. [Operação do banco](database-runbook.md).

## Fluxo web

```text
branch
  -> PR main
  -> CI seletivo
  -> Preview SHA exato
  -> required-ci
  -> merge
  -> Production CD
       -> baseline publicado
       -> migrations pendentes
       -> Media Storage pendente
       -> stage
       -> smoke
       -> promote
       -> canonical verification
       -> receipt
```

Preview é deployment de PR, não branch.

## Regras operacionais

1. GitHub é o control plane.
2. Vercel, Supabase e R2 são providers atuais e substituíveis.
3. Não usar provider de runtime como cofre indireto de secret usado pelo GitHub Actions.
4. Migration remota permanece pendente até Production alcançar o SHA correspondente.
5. Manifest de mídia ainda não publicado também permanece pendente até publicação/verificação ou decisão explícita de retirada.
6. Full audit global de Media Storage não bloqueia deploy web sem mídia pendente.
7. Production é staged antes do tráfego.
8. O mesmo artifact testado é promovido.
9. Rollback é operação normal de recuperação.
10. Secret não entra em Git, docs, logs, screenshot ou chat.
11. Mudança estrutural exige atualização documental na mesma PR.
12. Serviço/tier pago exige necessidade comprovada e decisão documentada.

## Drift conhecido

Em 2026-09-20 a documentação arquitetural já convergiu para ADR-0018, mas a implementação de publicação de mídia ainda precisa convergir:

- secrets R2 do publisher devem vir do GitHub Environment `production`;
- `vercel env run` não é o boundary canônico;
- publicação pendente deve ser calculada desde o baseline de Production, não esquecida após um merge seguinte.

Enquanto isso não estiver implementado e comprovado, releases com nova mídia podem falhar antes do promote e não devem ser contornadas manualmente.

## Runbooks

- [CI/CD](ci-cd.md)
- [Configuração administrativa](cicd-admin-setup.md)
- [Ambientes](environments.md)
- [Release/rollback](release-runbook.md)
- [Histórico de deployments](deployments.md)
- [Banco](database-runbook.md)
- [Media Storage / R2 atual](r2-media-runbook.md)
- [Segurança operacional](security-checklist.md)
- [Companion](local-companion.md)

## Histórico

Os documentos abaixo são evidência da migração da esteira e **não** definem comportamento atual:

- [baseline da simplificação](cicd-simplification-baseline.md);
- [plano de simplificação concluído](cicd-simplification-plan.md).

Evidências/auditorias especializadas do Companion continuam preservadas e navegáveis sem virar regra geral de CI/CD:

- [Companion 0.3.3 — auditoria pesada](companion-0.3.3-heavy-audit.md);
- [Companion — A-017 integridade dos modelos ASR](companion-a017-model-integrity.md);
- [Companion — Reliability R2 evidence](companion-reliability-r2-evidence.md).

Qualquer trecho histórico com branch permanente `Preview`, `Preview -> main`, full audit global R2 ou publisher baseado em Vercel deve ser lido no contexto da data registrada.

## Matriz rápida

| Mudança | CI | Mutação remota possível |
| --- | --- | --- |
| docs | fast | nenhuma |
| web/UI | fast + Preview | Vercel |
| migration | DB relevante | PostgreSQL/Supabase + Vercel |
| manifest canônico de mídia | mídia relevante | Media Storage + Vercel, quando publisher saudável |
| Companion | Companion relevante | fluxo próprio |

## Runbook incompleto é dívida

Procedimento recorrente não pode existir apenas em chat ou memória. Alterou workflow, secret, provider, migration boundary, Media Storage, provenance, promotion ou rollback: atualizar o documento dono na mesma PR.
