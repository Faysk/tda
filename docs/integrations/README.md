# Integrações — índice

> Status: vigente/parcialmente preparado
> Owner: integrations
> Última revisão: 2026-09-11

Integração é uma fronteira externa. Nenhum fornecedor deve redefinir o modelo de domínio do TDA.

## Índice

- [Supabase](supabase.md) — DB/Auth/RLS/RPC.
- [Cloudflare R2](r2.md) — contrato principal de objetos/binários, placement, keys, cache e migração.
- [R2 — governança detalhada](r2-governance.md) — lifecycle, organização e operação da mídia.
- [Inventário de mídia — 2026-09-07](media-inventory-2026-09-07.md) — fotografia auditada das imagens/brand assets e origens ainda em uso.
- [Vercel](vercel.md) — hosting/deploy.
- [Craig, Discord e Roll20](table-sources.md) — fontes da mesa.
- [Companion local](local-companion.md) — processamento pesado/sincronização.

## Contrato comum

Toda integração deve documentar propósito, dados de entrada/saída, identidade/autorização, secrets e limites, idempotência/retry, custo, failure modes, observabilidade, ambientes e condição de retirada.

## Regras

1. Secrets nunca entram no browser ou Git.
2. IDs de provider são provenance, não identidade canônica.
3. Falha externa não promove estado parcial.
4. Retries evitam duplicação.
5. Integração nova recebe capability mínima.
6. Dados privados só saem quando finalidade e autoridade permitirem.
7. O produto degrada explicitamente; não inventa dados de fallback.
