# Produção atual — recibo canônico

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-11
> Escopo: fotografia autoritativa do deployment atualmente observado em production. O histórico append-only permanece em `docs/operations/deployments.md`.

Este documento existe para evitar que entradas históricas com a palavra “atual” sejam interpretadas como estado permanente. Em caso de divergência sobre **qual deployment está em produção agora**, este recibo curto prevalece até a próxima reconciliação explícita.

## Estado observado em 2026-09-11

- Promoção: PR #186, `release: phase 2`, integrou `Preview` em `main`.
- Source SHA de `main`: `2688082c857b09ebceaee2b6b8ae819db6ec2c73`.
- Source commit: `release: promote World Authoring Workspace phase 2 (#186)`.
- Vercel project: `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`).
- Vercel team: `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`).
- Deployment: `dpl_7FZCbYytp1sJQhHom1ozL3DQ1MaF`.
- Target: `production`.
- Estado: `READY`.
- Criado: `2026-09-11T17:50:43.248Z`.
- READY: `2026-09-11T17:50:55.579Z`.
- URL imutável: `https://tda-eaqcvdg4f-projeto-desenv-6905s-projects.vercel.app`.
- A metadata da Vercel associa explicitamente o deployment ao mesmo source SHA da `main`.

## Escopo promovido relevante para a documentação

A PR #186 acumulou a promoção que continha, entre outras, as PRs #179, #180, #183 e #184. Portanto a reconciliação documental da #183 — incluindo a diretriz canônica de hierarquia UX e o estado publicado de Pipipi — faz parte deste snapshot de produção.

## Saúde observada

A consulta de runtime errors da Vercel realizada após a promoção não encontrou grupos de erro na janela de 1 hora consultada. Esta evidência é pontual e não equivale a monitoramento contínuo.

Nenhum novo smoke funcional de rota é atribuído a este recibo. Os smokes registrados em `docs/operations/deployments.md` permanecem evidência histórica de seus respectivos momentos e não são transferidos automaticamente para deployments posteriores.

## Limites e rollback

Este recibo não infere migration, DDL, grant, DNS, OAuth, R2 ou alteração de dados apenas a partir da promoção.

O production anterior observado foi `dpl_FyLWMwVXm4rwGV23khpQkb5qHStU`, associado ao SHA `ad6d9334471c93a591660e9dc8089e102fc4638a`, e permanece referência operacional de rollback conforme a Vercel.
