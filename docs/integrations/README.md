# Integrações — índice

> Status: vigente/parcialmente preparado
> Owner: integrations
> Última revisão: 2026-09-20

Integração é uma fronteira externa. Nenhum fornecedor deve redefinir o modelo de domínio do TDA.

[ADR-0018](../adr/0018-portable-core-github-control-plane.md) governa essas fronteiras: GitHub é o control plane e Vercel, Supabase e Cloudflare R2 são providers atuais/substituíveis.

## Índice

- [Supabase](supabase.md) — provider atual de PostgreSQL/Auth.
- [Cloudflare R2 / Media Storage](r2.md) — provider atual do boundary de mídia.
- [R2 — governança](r2-governance.md) — ownership e separação entre política permanente e evidência operacional.
- [R2 — índice detalhado](r2/README.md).
- [R2 — placement](r2/placement.md).
- [R2 — identidade e keys](r2/identity-and-keys.md).
- [R2 — variantes e crops](r2/variants-and-crops.md).
- [R2 — lifecycle](r2/lifecycle.md).
- [R2 — publicação e social](r2/publication-and-social.md).
- [R2 — segurança e custos](r2/security-and-costs.md).
- [R2 — runbook operacional](../operations/r2-media-runbook.md).
- [R2 — checklists](../operations/r2-media-checklists.md).
- [Inventário de mídia — 2026-09-07](media-inventory-2026-09-07.md) — fotografia histórica auditada, não estado corrente automático.
- [Vercel](vercel.md) — provider atual de runtime/deploy.
- [Craig, Discord e Roll20](table-sources.md) — fontes da mesa.
- [Companion local](local-companion.md) — processamento pesado/sincronização.

## Contrato comum

Toda integração deve documentar:

- propósito;
- dados que entram e saem;
- identidade e autorização;
- secrets necessários e onde podem existir;
- idempotência e retry;
- rate/cost limits relevantes;
- failure modes;
- observabilidade e evidências;
- limites entre Production, Preview e local;
- condição de substituição, rollback e desativação.

## Regras

1. Secrets nunca entram no browser ou Git.
2. Providers e seus IDs são configuração/provenance, não identidade canônica do domínio.
3. Falha externa não promove estado parcial indevido.
4. Retries precisam evitar duplicação e overwrite silencioso.
5. Integração nova recebe somente a capability mínima necessária.
6. Dados privados só saem do sistema quando finalidade e autoridade permitirem.
7. O produto degrada de forma explícita; não inventa dados de fallback.
8. Snapshot datado é evidência daquele momento, não monitoramento contínuo.
9. Estado operacional corrente deve ser consultado em [Infraestrutura e estado](../infrastructure.md) e nos runbooks/receipts donos, não duplicado neste índice.
10. Secret operacional usado pelo GitHub Actions pertence preferencialmente ao GitHub Environment que executa a operação; runtime recebe apenas o que usa em execução.
11. Serviço/tier pago exige necessidade comprovada e decisão documentada.
