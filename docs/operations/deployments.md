# Histórico de deployments

> Status: vigente
> Owner: operations
> Registro: append-only; correções devem preservar o evento original e explicar a retificação.

Este arquivo registra publicações deliberadas do TDA. Merge não implica deploy. Cada entrada fixa o SHA de origem, ambiente, evidências de build/health e situação de rollback.

## 2026-09-07 — Production #001

| Campo | Valor |
| --- | --- |
| Autorização | Publicar a `main` mais recente em production |
| Branch resolvida | `main` |
| Source SHA | `a7e9053ff2d3f42b6b110558bb51a8e2105125ec` |
| Source commit | `Fix theme toggle semantics and icons` |
| Vercel team | `projeto-desenv-6905s-projects` (`team_9wuTfarCQ3L63xtufPKUDzi0`) |
| Vercel project | `tda` (`prj_hDiDvvRiesg3qCDekGWE8JQMkIyH`) |
| Target | `production` |
| Deployment ID | `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe` |
| Região | `iad1` |
| Criado | `2026-09-07T03:31:43.738Z` |
| READY | `2026-09-07T03:32:08.845Z` |
| Deployment URL | `https://tda-1dbru4rp2-projeto-desenv-6905s-projects.vercel.app` |
| Production alias | `https://tda-three.vercel.app` |
| Project alias | `https://tda-projeto-desenv-6905s-projects.vercel.app` |

### Método de publicação

O projeto Vercel ainda não possui Git link e `git.deploymentEnabled=false` continua sendo a política canônica. O primeiro release foi criado pelo Vercel MCP como deployment direto, sem habilitar auto-deploy.

Para garantir que o conteúdo publicado correspondesse exatamente ao candidato autorizado, o build recebeu um bootstrap mínimo que baixou o tarball imutável do GitHub preso ao SHA `a7e9053ff2d3f42b6b110558bb51a8e2105125ec`, extraiu o repositório no workspace e executou `corepack pnpm install --frozen-lockfile`, seguido de `pnpm build`.

A ausência inicial de `package.json` no bootstrap gerou apenas o aviso da Vercel de que o Corepack não poderia ser habilitado antes do install customizado. Após a extração do SHA fixo, o `packageManager` do repositório foi respeitado e a instalação concluiu com pnpm `12.3.4`.

### Evidências de build

- Vercel CLI: `59.11.7`;
- máquina de build: 2 cores / 8 GB;
- pnpm: `12.3.4`;
- lockfile validado contra supply-chain policies: 184 entradas;
- instalação: `--frozen-lockfile`, lockfile confirmado como atualizado;
- Next.js detectado: `16.3.4`;
- comando de produção: `pnpm build`;
- estado final: `READY`.

### Smoke e runtime

- `/` respondeu HTTP `200` e renderizou a Home real do TDA;
- a Home exibiu as 11 memórias publicadas já existentes no Supabase;
- `/api/health` respondeu HTTP `200` com `ok=true`, `application=tda` e `environment=production`;
- o campo `commit` do health respondeu `null`, comportamento esperado neste deployment direto sem metadados de Git da Vercel; o SHA autoritativo deste release é o source SHA fixado acima;
- consulta de runtime errors após a publicação não encontrou erros no intervalo verificado;
- nenhuma mudança de DNS ou domínio customizado foi feita.

### Rollback

Este foi o primeiro deployment do reboot na Vercel; portanto não existe deployment anterior do reboot para promover como rollback. O domínio legado `dnd.faysk.dev` permaneceu intocado e continua sendo uma operação separada. O Deployment ID e o source SHA acima constituem o primeiro ponto de rollback reproduzível para releases futuros.

### Follow-ups operacionais

- considerar expor um `TDA_COMMIT_SHA` controlado no health para deployments diretos futuros;
- manter `git.deploymentEnabled=false` até decisão explícita em contrário;
- confirmar sempre team e project IDs antes de qualquer mutação na Vercel;
- novos deployments devem adicionar uma nova entrada neste histórico, nunca sobrescrever a evidência deste evento.
