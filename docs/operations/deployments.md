# Histórico de deployments

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-11
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

## 2026-09-07 — Production #003: identidade visual dos links

- Source SHA: `0120e38d28c51f3e90aa7336dfa8e7910df074f4`; CI `34153249657` terminal success.
- Deployment: `dpl_GHJgH7VdNrJd9izpYScog48UjSsE`, READY em 2026-09-07T18:52:22.761Z; alias `dnd.faysk.dev` confirmado.
- Publicação corretiva autorizada pelo relato de regressão: cada link de sessão precisa de sua arte, título e resumo. O registro de imagens runtime estava vazio; passou a consumir as 11 associações verificadas, sem alterar referências no banco.
- Pré-validação:22 imagens públicas revalidadas por GET, tamanho e SHA-256;144 testes app,24 mídia,75 navegador,build/check aprovados. Nova regressão testa o registro real e exige11imagens distintas.
- Pós-publicação:11sessões x2user-agents (WhatsApp/Discord) responderam200 e emitiram título/resumo e URL da hero correta.11imagens distintas; o link `3y6TnJVTOlaK` emite sua imagem da floresta. Evidência é HTML servido aos crawlers; cache/visual dentro dos aplicativos não foi observado.
- Não foram executados CAS, migrations, DNS ou mudanças de permissões. Auth/estatísticas continuam com as pendências anteriores.
- Rollback: Production #002, `dpl_6gzV49FDyFgi7DiJsKmmgMHrCgJF`.


## 2026-09-07 — Production #004 (registro retrospectivo)

- Source SHA: `0120e38d28c51f3e90aa7336dfa8e7910df074f4`.
- Deployment: `dpl_7YhRViksD5bxgYMvSTTWiTg4qXdD`, READY em 19:21:22.439Z.
- Configuração Production adicionada: `SUPABASE_PUBLISHABLE_KEY` e `TDA_AUTH_ORIGIN=https://dnd.faysk.dev`; sem rotação de segredos, grants, DDL ou Preview.
- Entrada habilitada e autorização HTTP encaminhada ao Discord; retorno real ainda não validado naquele momento.
- Rollback: Production #003. Evidência original preservada no registro operacional local `production004-auth.md`.

## 2026-09-07 — Production #005

- Escopo autorizado: publicar a correção do login Discord da PR #59 e validar fluxo real.
- Source SHA: `d89b954d9b35de3e90452a83b5b66cf79fab322b`, CI terminal success antes do deploy.
- Projeto/time: `prj_hDiDvvRiesg3qCDekGWE8JQMkIyH` / `team_9wuTfarCQ3L63xtufPKUDzi0`.
- Deployment: `dpl_EtY2oqVJ9hdNwRS5qRMZt4q19EHt`, READY; aliases confirmados incluindo https://dnd.faysk.dev/.
- Método: bootstrap com tarball GitHub imutável do SHA acima, instalação frozen-lockfile, build Next na Vercel. Auto-deploy por push permanece desativado.
- Smoke: Home, sessões, health, entrar e API de identidade responderam 200; health `ok=true`, ambiente production. `/entrar` usa `same-origin`; `/api/auth/me` mantém `no-referrer`.
- Navegador real: clique encaminhou ao consentimento Discord, autorização retornou ao TDA. A conta exibiu acesso indisponível: faltava a flag `TDA_READ_EDIT_DATA` usada pelo resolvedor server-only.
- Configuração corrigida para a próxima publicação: somente Production `TDA_READ_EDIT_DATA=true`. Não concede roles, não habilita `TDA_EDIT_UNSAFE`, não altera banco. Esta flag ainda não pertence ao snapshot do deployment #005.
- Nenhum erro runtime encontrado na janela de 5 minutos consultada após publicação; não equivale a monitoramento contínuo.
- Pendência de identidade: aplicativo OAuth ainda se apresenta como DND-SCRIBE. Não alterado nesta release.
- Rollback: Production #004. Autenticação/retorno observados; acesso autorizado, reload e logout devem ser revalidados após ativar a flag no próximo deployment.


## 2026-09-07 — Production #006

- Source SHA: `7dd4b06d1a246ad924230530c2a0424e830aa46d`, integração #64 de #56/#60/#57/#58.
- CI exato da main: `34162350940` success; Companion Windows/Linux `34162350995` success. Candidato #64 também validado antes do merge.
- Deployment: `dpl_8cS1DGKStTdmos27wYoa747JRZ6a`, READY; alias oficial https://dnd.faysk.dev/ confirmado na Vercel.
- Mesmo projeto/time e método de tarball imutável de #005. Nenhum auto-deploy, DNS, migration ou grant alterado.
- Production `TDA_READ_EDIT_DATA=true` passa a valer neste snapshot; resolvedor server-only verifica identidade/permissões existentes, sem unsafe.
- Smoke anônimo: Home/sessões/health 200; API administrativa de permissões 401 e private/no-store; processamento redireciona à entrada; estatísticas sem login não exibem métricas.
- Navegador com OAuth real: conta reconheceu permissões após recarregamento; estatísticas renderizaram sessões e totais com aviso de duração ausente; diretório de permissões somente leitura renderizou; painel local apresentou serviço desconectado e sincronização não configurada corretamente.
- Logout real retornou aviso de saída. Nova navegação a `/transcricoes` após logout negou acesso sem mostrar métricas.
- Nenhum erro runtime encontrado na janela de 5 minutos consultada. Não houve leitura de texto integral de transcrição nem alteração de permissões para esse smoke.
- Supervisor validado somente em scratch: 11 testes Python e 2 browser/HTTP loopback reais sintéticos; não foi instalado serviço persistente, processado áudio pessoal ou ativado import cloud.
- Pendências: nome OAuth DND-SCRIBE, uma duração histórica ausente, ASR real/instalador, import #61 e Edit persistence, revisões narrativas. Não confundir os módulos publicados com fechamento desses gates.
- Rollback: Production #005 `dpl_EtY2oqVJ9hdNwRS5qRMZt4q19EHt`. Para retirar leitura administrativa de próximos builds, desabilitar `TDA_READ_EDIT_DATA`; sem rollback destrutivo de dados.

## 2026-09-07 — Production #007: hero da Home com arte da última sessão

- Autorização: publicar a mudança aprovada da Home diretamente da `main` em production.
- Source SHA: `be19b932feeebdbee6abf555d0277092a4651b4c`; commit `fix(home): preserve supported page gutter` sobre `feat(home): use latest session artwork as hero backdrop`.
- CI exato da `main`: run `34166268840` success, incluindo `pnpm check`, build Next.js, E2E/Playwright, testes de processamento e teste PostgreSQL de transcript import.
- Projeto/time: `prj_hDiDvvRiesg3qCDekGWE8JQMkIyH` / `team_9wuTfarCQ3L63xtufPKUDzi0`.
- Deployment: `dpl_EiAwYwMUjW4N5VqKXUXKidiFE4Kr`, production, criado em `2026-09-07T22:37:34.155Z` e READY em `2026-09-07T22:38:08.325Z`.
- URL do deployment: https://tda-ayf6wi2ru-projeto-desenv-6905s-projects.vercel.app ; alias oficial confirmado: https://dnd.faysk.dev/.
- Método: deployment direto com bootstrap mínimo; o build fixou e verificou explicitamente `TDA_RELEASE_SHA=be19b932feeebdbee6abf555d0277092a4651b4c`, carregou esse commit imutável, executou instalação `--frozen-lockfile` e build Next.js `16.3.4`. Auto-deploy por push não foi habilitado.
- Escopo publicado: a Home usa a arte da sessão mais recente como backdrop do hero, com contraste em overlay, conteúdo editorial à esquerda, metadados da última sessão à direita e cartões de memórias recentes abaixo; o gutter suportado pelo shell foi preservado.
- Smoke oficial: `/`, `/sessoes` e `/sessoes/rmDsxh640RR4` responderam HTTP `200`; a Home exibiu 11 memórias, a última sessão `Um dia pra esquecer` e a hero pública correspondente. `/api/health` respondeu HTTP `200` com `ok=true`, `application=tda` e `environment=production`.
- Runtime: nenhuma ocorrência agrupada de erro encontrada na janela de 30 minutos consultada após a publicação.
- Nenhuma migration, DDL, grant, alteração de dados, configuração de Auth ou DNS foi executada nesta release. As migrations de transcript import permanecem candidatas deliberadamente não aplicadas.
- Rollback: Production #006 `dpl_8cS1DGKStTdmos27wYoa747JRZ6a`; schema preservado.

## 2026-09-07 — Production #008 (recibo retrospectivo verificado)

- Deployment `dpl_Cmw9hpaqunsCiba2K4CC5p2gz3WE`, observado READY no domínio oficial antes da #009.
- Build log imutável confirma `TDA_RELEASE_SHA=de7e02c66595f34e44efa8d9e09a1d0098afae18`. A associação foi verificada novamente em 2026-09-08 UTC; não foi inferida do health, que retornava `commit=null`.
- Este recibo documenta a versão anterior para rollback; não reconstitui verificações funcionais que não foram executadas nesta inspeção.

## 2026-09-08 — Production #009: estabilização da base (#102)

- Horário local Europe/London: 2026-09-09. Escopo autorizado: consolidar correções revisadas e publicar a base estabilizada.
- Source SHA: `6eae9b14b3bc3cb75af492738db464a01bb75d9e`, após integração das PRs #100, #101, #103, #104, #105, #107, #108, #109, #110, #112 e #113.
- CI exata da main `34289713134` e Companion Windows/Linux `34289713157`: completed/success antes do deployment. Inclui check, build, navegador, estatísticas, permissões, processamento e PostgreSQL sintético.
- Deployment `dpl_379E68FzdTnFkDX84ZRhEdcDfaGb`, READY em 2026-09-08T23:18:10.886Z; alias `dnd.faysk.dev` confirmado. URL: https://tda-1930o5nly-projeto-desenv-6905s-projects.vercel.app.
- Build log confirma `TDA_RELEASE_SHA=6eae9b14b3bc3cb75af492738db464a01bb75d9e`, tarball imutável, instalação frozen-lockfile e build Next. Auto-deploy não foi habilitado.
- Melhorias: retorno/erros de login, conta e estados de acesso, controles do Edit conforme capabilities, recuperação do inspetor mobile, chaves de parágrafos e allowlist das imagens de Pipipi. Reconciliar IDs de migrations no Git não executou DDL.
- Smoke público após READY: home, sessões, mundo, entrar e health HTTP 200; API de permissões anônima HTTP 401. Navegador abriu o grafo, selecionou Dandelion e encontrou a aba Momentos; capturas desktop/mobile realizadas, mobile inspecionado. Nenhum pageerror foi observado nessa navegação.
- Sessão `/sessoes/rmDsxh640RR4` e sua imagem Open Graph verificadas; imagem HTTP 200. Não houve novo consentimento OAuth real nem edição de transcrição de produção nesta rodada.
- Limite de rastreabilidade: `/api/health` ainda retorna `commit=null` apesar do envio de APP_COMMIT_SHA no pedido de deploy. A associação acima se baseia no log imutável do build; não declarar a variável efetivamente configurada em runtime.
- Instabilidade conhecida: PR #110 teve um timeout isolado no teste de seleção do inspetor em desktop-2k. Dez repetições locais passaram; rerun do mesmo SHA e CI final da main passaram. A repetição não foi tratada como correção da causa.
- Fora do escopo: Pipipi ainda não possui rota integrada; grafo continua demonstrativo; ASR real, MSI e sync não foram declarados concluídos. PR #111 permanece draft, sem aplicação de backfill.
- Rollback: Production #008 `dpl_Cmw9hpaqunsCiba2K4CC5p2gz3WE`. Nenhum dado, grant, DNS ou áudio foi alterado nesta publicação.

## 2026-09-11 — Production atual observada: reconciliação documental

- Source SHA observado: `ad6d9334471c93a591660e9dc8089e102fc4638a`, `main` no momento da reconciliação.
- Deployment Vercel: `dpl_FyLWMwVXm4rwGV23khpQkb5qHStU`, target `production`, estado `READY`.
- A metadata do deployment associa explicitamente o artefato ao mesmo source SHA `ad6d9334471c93a591660e9dc8089e102fc4638a`.
- O commit de `main` corresponde ao merge da PR #178: `release: promote D lore artwork fix to production`.
- Smoke documental direto: `https://dnd.faysk.dev/lore/pipipi` respondeu HTTP `200` em 2026-09-11.
- Metadata pública observada na rota: título `Pipipi — A Casa Onde os Super-Heróis Visitavam · TDA`, descrição própria e canonical da própria rota.
- A imagem Open Graph observada ainda usa `https://dnd.faysk.dev/og/default`; OG específico de Pipipi permanece melhoria separada.
- Esta reconciliação **não reconstitui nem renumera deployments intermediários ausentes deste arquivo** e não infere migration, DDL, grant, DNS, OAuth, R2 ou smoke adicional que não tenha sido observado aqui.
- Entradas históricas anteriores permanecem intactas e devem ser interpretadas como fotografias do momento em que foram registradas.

