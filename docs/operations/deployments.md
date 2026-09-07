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
- nenhuma mudança de DNS ou domínio customizado foi feita no momento inicial do deployment.

### Rollback

Este foi o primeiro deployment do reboot na Vercel; portanto não existe deployment anterior do reboot para promover como rollback. O domínio legado `dnd.faysk.dev` permaneceu intocado no instante inicial da publicação. O Deployment ID e o source SHA acima constituem o primeiro ponto de rollback reproduzível para releases futuros.

### Follow-ups operacionais

- considerar expor um `TDA_COMMIT_SHA` controlado no health para deployments diretos futuros;
- manter `git.deploymentEnabled=false` até decisão explícita em contrário;
- confirmar sempre team e project IDs antes de qualquer mutação na Vercel;
- novos deployments devem adicionar uma nova entrada neste histórico, nunca sobrescrever a evidência deste evento.

### 2026-09-07 — Cutover de domínio do Production #001

Esta seção registra uma operação posterior ao deployment inicial. As afirmações acima de que `dnd.faysk.dev` ainda estava preservado e sem mudança de DNS eram verdadeiras no momento em que o Production #001 foi criado; posteriormente o domínio oficial foi promovido para o reboot.

- domínio oficial: `https://dnd.faysk.dev`;
- Vercel dashboard confirmou `dnd.faysk.dev` associado ao Production Deployment do projeto `tda` e status `Ready`;
- às `2026-09-07T04:04Z`, `https://dnd.faysk.dev/` respondeu HTTP `200`, servindo a Home do TDA novo;
- às `2026-09-07T04:04Z`, `https://dnd.faysk.dev/api/health` respondeu HTTP `200` com `ok=true`, `application=tda` e `environment=production`;
- a resposta pública foi servida pela Vercel e HTTPS estava ativo;
- não houve novo deployment de aplicação para o cutover: o domínio passou a apontar para o mesmo Production #001;
- a consulta DNS auxiliar não respondeu no momento da documentação, portanto o valor exato do registro Cloudflare não é inferido aqui sem evidência independente.

#### Rollback do domínio

Se for necessário desfazer apenas o cutover de domínio, tratar DNS/domínio como operação independente do código: remover/reassociar `dnd.faysk.dev` no projeto Vercel e restaurar o registro Cloudflare anterior conhecido. Não é necessário reverter o deployment `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe` apenas para desfazer o apontamento do domínio.

## 2026-09-07 — Production #002

- Autorização: publicar a main integrada em https://dnd.faysk.dev/.
- Source SHA: `510b34874458fe68bd4797098a00edcd07a7f1c5`.
- Projeto/time: `prj_hDiDvvRiesg3qCDekGWE8JQMkIyH` / `team_9wuTfarCQ3L63xtufPKUDzi0`, Hobby, Node 24.
- Deployment: `dpl_6gzV49FDyFgi7DiJsKmmgMHrCgJF`, production, READY em 2026-09-07T18:04:23.779Z.
- URL: https://tda-gm7f38fcr-projeto-desenv-6905s-projects.vercel.app ; alias oficial confirmado pela Vercel: https://dnd.faysk.dev/.
- Método: bootstrap pelo conector Vercel, tarball GitHub imutável do SHA acima, instalação frozen-lockfile e build. Uma primeira requisição foi rejeitada antes de criar deployment porque installCommand excedeu 256 caracteres; o script bootstrap resolveu o limite. Nenhum auto-deploy ativado.
- Validação prévia: CI main `34149194633` success; 143 testes app, 24 mídia, 75 navegador e build/check locais aprovados.
- Smoke: Home, sessões, detalhe rmDsxh640RR4, entrar, mundo e fallback OG HTTP 200. Onze capas da listagem e dois assets de marca responderam 200 com MIME de imagem. Browser confirmou navegação e conteúdo público.
- Health: ok=true, environment=production, commit=null; provenance garantida pelo tarball fixo, não pelo health.
- Metadata WhatsApp em HTML bruto: título/resumo/canonical da sessão corretos; imagem ainda `/og/default`, pois manifesto runtime segue vazio. Não afirmar artwork personalizada já publicada.
- Login Discord: `/entrar` informa indisponibilidade e mantém botão desabilitado; `/api/auth/me` responde 503/unavailable sem capabilities. Configuração/ensaio OAuth real continuam pendentes. `/edit` encaminha à conta e não exibe conteúdo administrativo anônimo.
- Runtime errors: nenhum erro agrupado encontrado no intervalo consultado após READY; isso não elimina a indisponibilidade de Auth registrada acima.
- Nenhuma migration, promoção CAS, alteração de dados ou DNS executada. Referências de mídia ainda usam origens anteriores; suporte R2 foi publicado, promoção permanece separada.
- Rollback: deployment anterior `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe` (Production #001); schema preservado.
