# Integração Supabase — provider atual de PostgreSQL e Auth

> Status: vigente; provider atual
> Owner: dados / identity-access
> Última revisão: 2026-09-20
> Fonte de verdade: ADR-0002 + ADR-0018 + documentação de banco

Supabase é o provider atual da plataforma de dados do TDA.

O contrato relacional principal é **PostgreSQL com migrations versionadas**. ADR-0002 continua válido para reutilizar a base existente enquanto ela atende ao projeto; ADR-0018 esclarece que Supabase pode ser substituído futuramente.

## Projeto atual

```text
dmrqnbdvbkfqzctcerbx
```

Não criar segunda base para contornar migration, legado ou dívida técnica.

## Responsabilidades atuais

O provider atual entrega, conforme cada domínio:

- PostgreSQL;
- Auth;
- RLS;
- RPC/functions PostgreSQL;
- APIs/integrações auxiliares do Supabase.

Dependência específica do Supabase é permitida quando agrega valor, mas deve ser identificável para que o custo de migração seja conhecido.

## Persistência

Toda DDL/grant/policy/function nova:

- entra por migration versionada;
- preserva compatibilidade quando necessária;
- passa pelos checks de segurança;
- é verificada após aplicação remota;
- atualiza documentação na mesma PR.

Migration em Git não prova aplicação remota.

## Boundaries

Features devem preferir repositories/adapters do domínio em vez de espalhar `SupabaseClient` quando um boundary pequeno resolve a necessidade.

Isso não exige construir outro provider antecipadamente. O objetivo é isolar o edge real, não criar abstração hipotética.

## Auth e segurança

Secrets/service keys ficam server-side.

Nunca:

- expor service/secret key ao browser;
- abrir RLS apenas para eliminar erro de desenvolvimento;
- tratar publishable/anon key como autorização;
- substituir capability/scope por confiança no cliente.

As regras detalhadas pertencem a [Segurança do banco](../database/security.md) e [Identity/access](../domains/identity-access.md).

## CI/CD

Secrets operacionais de migration executada pelo GitHub Actions pertencem ao GitHub Environment `production`:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

Runtime secrets usados pelo aplicativo pertencem ao runtime e têm escopo/finalidade próprios.

## Portabilidade

Uma futura migração pode trocar Supabase por outro PostgreSQL/provider sem alterar a identidade do TDA.

Para manter essa opção:

- migrations são a referência de evolução;
- SQL PostgreSQL e extensões provider-specific devem ser distinguíveis;
- Auth/provider-specific capabilities têm dependência documentada;
- mudança de provider exige plano formal de dados, auth, segurança e rollback.

## Custos

Supabase Free é o provider/tier atual enquanto atende ao uso. Upgrade pago só entra após necessidade comprovada e decisão documentada.

## Referências

- [ADR-0002 — reutilizar base existente](../adr/0002-existing-supabase.md)
- [ADR-0018 — providers substituíveis](../adr/0018-portable-core-github-control-plane.md)
- [Banco — índice](../database/README.md)
- [Migrations](../database/migrations.md)
- [Segurança](../database/security.md)
- [Runbook](../operations/database-runbook.md)
