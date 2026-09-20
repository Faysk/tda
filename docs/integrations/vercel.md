# Integração Vercel — provider atual de runtime/deploy

> Status: vigente; provider atual
> Owner: integrations/runtime + operations
> Última revisão: 2026-09-20
> Fonte de verdade: ADR-0018 + runbooks de CI/CD

Vercel hospeda atualmente o frontend/runtime do TDA. Ela é **provider**, não control plane nem identidade permanente da arquitetura.

## Recursos atuais

```text
Team:    team_9wuTfarCQ3L63xtufPKUDzi0
Project: prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
Domain:  https://dnd.faysk.dev
Plan:    Hobby
```

Antes de qualquer mutação, confirmar team/project. Não operar outro projeto por conveniência.

## Controle de deploy

GitHub Actions controla a entrega.

`git.deploymentEnabled=false` permanece a política: Git push não autoriza Vercel a decidir deployment sozinho.

Fluxo:

```text
PR
 -> CI
 -> Vercel Preview do SHA
 -> merge main
 -> Production CD
 -> vercel build
 -> vercel deploy --prebuilt --prod --skip-domain
 -> smoke
 -> vercel promote
```

Preview é deployment de PR, não branch.

## Identidade pública

Identidade de produto:

`https://dnd.faysk.dev`

URLs `*.vercel.app` são infraestrutura/diagnóstico e não devem aparecer como canonical, share URL ou navegação normal do produto.

## Environment Variables

Classificar cada variável como:

- pública/browser;
- runtime server-side;
- operacional/CI.

Secrets usados pelo GitHub Actions para operar **outro provider** não pertencem à Vercel apenas porque o runtime também é Vercel.

Exemplo: credenciais S3 do R2 usadas pelo publisher de GitHub Actions pertencem ao GitHub Environment `production`. Se uma feature em runtime precisar de Media Storage, ela recebe credencial runtime própria com privilégio mínimo.

Nunca usar `NEXT_PUBLIC_*` para secrets.

## Build/runtime config

`vercel pull` pode ser usado para obter configuração necessária ao build/runtime da própria Vercel.

Isso não transforma `vercel env pull` ou `vercel env run` em secret manager canônico para CI de Media Storage, banco ou outro provider.

## Rollback

Rollback do app é uma operação do provider de runtime:

1. identificar deployment anterior saudável;
2. confirmar compatibilidade com estado atual do banco;
3. promover/rollback;
4. verificar `/api/health` e `/api/version`;
5. corrigir em nova PR.

Rollback da aplicação não apaga migrations ou objetos de Media Storage.

## Histórico

Production #001 e os deployments manuais de 2026-09-07 são evidência histórica em [deployments](../operations/deployments.md), não “Production atual”.

O projeto legado `DND/dnd-scribe` foi retirado e não é caminho de rollback.

## Custos

Vercel Hobby é usado enquanto atende ao projeto. Upgrade/tier pago exige necessidade comprovada e decisão documentada, conforme ADR-0018.

## Referências

- [ADR-0018](../adr/0018-portable-core-github-control-plane.md)
- [CI/CD](../operations/ci-cd.md)
- [Configuração administrativa](../operations/cicd-admin-setup.md)
- [Release](../operations/release-runbook.md)
- [Histórico de deployments](../operations/deployments.md)
