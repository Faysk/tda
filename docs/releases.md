# Publicação controlada
main e Preview são branches permanentes, não gatilhos de deploy. Vercel git.deploymentEnabled=false; CI não contém deploy. A conta Vercel alvo é projeto-desenv-6905, não DND/dndscribe.

Antes de publicar: escopo fechado, revisão, instalação limpa, tipos/lint/testes, build de produção, teste visual desktop/mobile, revisão de dados/permissões, SHA conhecido e rollback. Cloud só recebe candidato validado. Não usar publicações repetidas como desenvolvimento; não reativar auto-deploy após liberar cotas. CLI/prebuilt também consome cota.

## Estado publicado

Em 2026-09-07 ocorreu o primeiro deployment manual do reboot em production. O candidato autorizado foi a `main` no SHA `a7e9053ff2d3f42b6b110558bb51a8e2105125ec` (`Fix theme toggle semantics and icons`). A publicação foi criada no projeto Vercel `tda`, equipe `projeto-desenv-6905s-projects`, como deployment `dpl_CHFi2UCFGZjE5shTj7UvsghHtRPe` e terminou `READY`.

Como o projeto não possui Git link automático e o conector de deployment trabalha com arquivos, o release foi construído a partir do tarball imutável do GitHub fixado nesse SHA, com `pnpm install --frozen-lockfile` e `pnpm build`. Isso não alterou `git.deploymentEnabled=false` e não criou gatilho de deploy por push.

O domínio oficial de production é `https://dnd.faysk.dev`. Em `2026-09-07T04:04Z`, a Home e `/api/health` responderam HTTP 200 nesse domínio; o health retornou `ok=true`, `application=tda` e `environment=production`, com HTTPS ativo e resposta servida pela Vercel.

Os aliases Vercel continuam disponíveis para diagnóstico, incluindo `https://tda-three.vercel.app`. A promoção do domínio foi uma operação separada e não exigiu novo deployment de aplicação: `dnd.faysk.dev` passou a servir o mesmo Production #001.

O histórico verificável de Deployment ID, timestamps, URLs, método, smoke, cutover de domínio e rollback fica em [operations/deployments.md](operations/deployments.md).
