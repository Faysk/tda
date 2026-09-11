# R2 — segurança e custos

> Status: vigente
> Owner: integrations/media + infraestrutura/operação
> Última revisão: 2026-09-11

Credenciais ficam somente em ambientes autorizados; nunca em browser, Git, screenshots ou docs. Erro 403 é falha de autorização/configuração, não prova de ausência. Bucket privado nunca vira fallback público. Exposição acidental de conteúdo restrito é incidente de segurança.

Acesso temporário a objeto privado, se necessário, deve ser gerado server-side após autorização, com escopo e expiração mínimos. Em browser, CORS deve ser explícito.

Usar R2 Standard como baseline. Infrequent Access e lifecycle automático exigem decisão explícita; não criar delete automático em namespaces canônicos sem política de retenção.

Pricing consultado em 2026-09-11 para Standard: 10 GB-mês, 1 milhão de operações Class A e 10 milhões de Class B incluídos por mês; egress para Internet sem cobrança de bandwidth segundo o fornecedor. Conferir antes de decisões: <https://developers.cloudflare.com/r2/pricing/>.

O TDA prioriza franquias gratuitas, monitora storage/operações e não habilita produto pago por conveniência.
