# Integrações — índice

> Status: vigente/parcialmente preparado
> Owner: integrations
> Última revisão: 2026-09-11

Integração é uma fronteira externa. Nenhum fornecedor deve redefinir o modelo de domínio do TDA.

## Índice

- [Supabase](supabase.md) — DB/Auth/RLS/RPC.
- [Cloudflare R2](r2.md) — contrato principal de objetos/binários.
- [R2 — governança](r2-governance.md).
- [R2 — índice detalhado](r2/README.md).
- [R2 — placement](r2/placement.md).
- [R2 — identidade e keys](r2/identity-and-keys.md).
- [R2 — variantes e crops](r2/variants-and-crops.md).
- [R2 — lifecycle](r2/lifecycle.md).
- [R2 — publicação e social](r2/publication-and-social.md).
- [R2 — segurança e custos](r2/security-and-costs.md).
- [R2 — runbook operacional](../operations/r2-media-runbook.md).
- [R2 — checklists](../operations/r2-media-checklists.md).
- [Inventário de mídia — 2026-09-07](media-inventory-2026-09-07.md) — fotografia histórica auditada.
- [Vercel](vercel.md) — hosting/deploy.
- [Craig, Discord e Roll20](table-sources.md) — fontes da mesa.
- [Companion local](local-companion.md) — processamento pesado/sincronização.

## Contrato comum

Toda integração documenta propósito, dados, identidade/autorização, secrets e limites, idempotência/retry, custo, falhas, observabilidade, ambientes e retirada.

## Regras

1. Secrets nunca entram no browser ou Git.
2. IDs de provider são provenance, não identidade canônica.
3. Falha externa não promove estado parcial.
4. Retries evitam duplicação.
5. Integração nova recebe capability mínima.
6. Dados privados só saem quando finalidade e autoridade permitirem.
7. O produto degrada explicitamente; não inventa dados de fallback.
