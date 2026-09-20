# Publicação controlada

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-09-20
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
