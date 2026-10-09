# Publicação controlada

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-10-09
> Fonte de verdade: [runbook de CI/CD](operations/ci-cd.md) e [runbook de release](operations/release-runbook.md)

A publicação do TDA é controlada pelo GitHub Actions.

## Política atual

- `main` é a única branch longa necessária para a entrega web;
- Preview é deployment do SHA exato de uma PR;
- Vercel Git auto-deploy permanece desligado;
- merge em `main` não é prova de publicação concluída;
- Production é staged, recebe smoke e só então é promovida;
- migrations e Media Storage participam quando houver trabalho remoto pendente;
- rollback é mecanismo normal de recuperação.

Providers atuais:

- runtime/deploy: Vercel;
- dados: PostgreSQL via Supabase;
- Media Storage: Cloudflare R2.

Eles são substituíveis conforme ADR-0018.

## Releases Web versionadas (sem duplicar os runtimes)

A partir de 2026-10-09, **somente a aplicação Web** usa duas sequências de
GitHub Releases com formato exato:

| Canal | Tag/Release inicial | Próxima publicação | Condição |
| --- | --- | --- | --- |
| Main Preview | `Pre_1.0.0` (GitHub prerelease) | `Pre_1.0.1` | CI main + staged Production sem domínio + smoke read-only |
| Production | `Prod_1.0.0` (GitHub latest Stable) | `Prod_1.0.1` | Aprovação + Production CD + canonical smoke depois do promote |

Cada canal incrementa o terceiro componente da sua própria sequência. Reexecutar
um workflow para o **mesmo SHA** reutiliza a mesma tag: nunca renomear ou mover
tags existentes. O `Prod_1.0.0` inicial é um **receipt do SHA que já está no ar**
no momento do bootstrap e não dispara novo deploy. Antes de criar, o bootstrap
exige que exista o recibo `prod-<sha>` exato da Production canônica.

Após uma versão Web nova validada, o release helper retém somente a mais recente
`Pre_*` e `Prod_*` (remove **somente** versões Web numeradas anteriores).
Os registros de deployment do GitHub/Vercel permanecem como evidência histórica.
O release receipt mantém SHA, PR, deployment e histórico de migrations/mídia.

`companion-v*`, `companion-rc-*`, `companion-qwen-runtime-*` e
`companion-whisper-runtime-*` não participam desta retenção. Instaladores,
updaters e rollback version-locked dependem deles. Da mesma forma, os
`prod-<sha>` **legados** permanecem até inventário/limpeza separada, sem
alterar retroativamente o registro de publicação.

## Antes de publicar

Confirmar:

- escopo fechado;
- PR/CI do SHA exato;
- Preview revisado quando aplicável;
- documentação atualizada;
- migrations identificadas;
- mídia pendente identificada;
- secrets necessários no boundary correto;
- rollback conhecido.

Não usar deployments repetidos como ferramenta de desenvolvimento.

## Depois de publicar

Comprovar:

- `/api/health`;
- `/api/version`;
- SHA/release esperados;
- superfícies alteradas;
- migration aplicada quando necessária;
- Media Storage publicado/verificado quando necessário;
- receipt da release.

Um step verde com zero assets não prova publicação de mídia.

## Histórico

Os primeiros deployments manuais de 2026-09-07 e seus IDs permanecem preservados em [Histórico de deployments](operations/deployments.md). Eles não descrevem a topologia operacional atual.

A antiga branch permanente `Preview` e promoção `Preview -> main` são históricas e não devem reaparecer em procedimentos novos.
