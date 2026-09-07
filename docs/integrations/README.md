# Integrações — índice

> Status: vigente/parcialmente preparado
> Owner: integrations
> Última revisão: 2026-09-07

Integração é uma fronteira externa. Nenhum fornecedor deve redefinir o modelo de domínio do TDA.

## Índice

- [Supabase](supabase.md) — DB/Auth/RLS/RPC.
- [Cloudflare R2](r2.md) — objetos/binários, placement, keys, cache e migração.
- [Inventário de mídia — 2026-09-07](media-inventory-2026-09-07.md) — fotografia auditada das imagens/brand assets e origens ainda em uso.
- [Vercel](vercel.md) — hosting/deploy futuro.
- [Craig, Discord e Roll20](table-sources.md) — fontes da mesa.
- [Companion local](local-companion.md) — processamento pesado/sincronização.

## Contrato comum

Toda integração deve documentar:

- propósito;
- dados que entram/saem;
- identidade/autorização;
- secrets necessários e onde podem existir;
- idempotência/retry;
- rate/cost limits relevantes;
- failure modes;
- observabilidade;
- ambiente production/preview/local;
- condição de substituição/desativação.

## Regras

1. Secrets nunca entram no browser ou Git.
2. Provider-specific IDs são provenance, não identidade canônica do domínio.
3. Falha externa não deve promover estado parcial indevido.
4. Retries precisam evitar duplicação.
5. Integração nova deve receber capability mínima necessária.
6. Dados privados só saem do sistema quando a finalidade/autoridade permitir.
7. O produto deve degradar de forma explícita; não inventar dados de fallback.

## Estado atual resumido

| Integração | Papel | Estado |
| --- | --- | --- |
| Supabase | banco/Auth | produção existente, canônico |
| Cloudflare R2 | mídia/binários | buckets novos criados, ainda privados; governança e inventário inicial documentados |
| Vercel | hosting | projeto preparado; publicação segue runbook controlado |
| Craig | gravação multi-track | legado/pipeline local a modernizar |
| Discord | identidade/interactions/notas/Craig | parcialmente implementado |
| Roll20 | eventos da mesa | schema/import histórico, sem dados atuais observados |
| Companion local | processamento | preservar/modernizar |
