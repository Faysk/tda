# Ambientes e configuração

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-07

## Ambientes conceituais

### Local development

Objetivo: desenvolver/testar app sem publicar.

Características:

- `.env.local` não versionado;
- pode operar sem secrets mostrando estado de preparação;
- não deve inventar sessions mock como se fossem produção;
- build/test local deve ser reproduzível a partir do repo.

Para acelerar o Edit antes de Auth/capabilities, `TDA_EDIT_UNSAFE=true` pode ser habilitado deliberadamente. Esse modo usa dados e writes reais; não é mock. O contrato transitório está em [Edit — modo temporário sem autenticação](../features/edit-unsafe-development.md).

### Preview / homologação

Objetivo: validar candidato isolado antes de production quando necessário.

Regras:

- não recebe acesso irrestrito à production por padrão;
- R2 possui bucket `tda-media-preview` próprio;
- dados de teste/autorizados devem ser separados quando a superfície autenticada exigir;
- domínio/URL de Preview não implica feature pública;
- `TDA_EDIT_UNSAFE` permanece `false` salvo decisão deliberada de liberar o bypass naquele ambiente.

### Production

Objetivo: servir conteúdo aprovado na infraestrutura correta.

Recursos canônicos atuais/futuros:

- Supabase existente `dmrqnbdvbkfqzctcerbx`;
- R2 production (`tda-media-public`, `tda-media-private`);
- Vercel correta `projeto-desenv-6905` / `projeto_desenv@outlook.com`;
- campanha `yuhara-main`.

Na produção anterior ao candidato de Auth, `TDA_EDIT_UNSAFE=true` expõe administração sem identidade. No candidato [Discord SSR](discord-auth.md), a flag não pula mais os guards de página/Server Action; ainda controla o adapter temporário. Não confundir implementação na branch com alteração já publicada.

## Runtime

A fundação atual fixa Node via `.node-version` e package manager via `package.json`. Antes de alterar versões, seguir política de versions e validar build/CI.

## Variáveis de ambiente

Categorias:

### Public client config

Somente valores seguros para bundle/browser. Prefixo `NEXT_PUBLIC_` deve ser tratado como **publicação deliberada**, não conveniência.

### Server secrets

Supabase secret/service credentials, R2 credentials, OAuth secrets e similares.

### Feature/config

Flags, allowlists e endpoints que não são secretos mas ainda precisam de consistência por ambiente.

Flags de dados/Edit atuais:

- `TDA_READ_PUBLISHED_DATA=true` — leitura pública server-side real;
- `TDA_READ_EDIT_DATA=true` — habilita o client server-side do Edit para o caminho autorizado;
- `TDA_EDIT_UNSAFE=true` — habilita temporariamente workbench + adapter de write sem Auth; também habilita `editDataClient()` apenas no servidor.

## Regras de secret

- não versionar `.env.local`;
- não colar valores em docs;
- não expor em client bundle;
- não imprimir em logs;
- rotacionar quando houver suspeita de exposição;
- preferir escopo mínimo e credencial por finalidade;
- remover/revogar bootstrap tokens temporários após configuração.

## Configuração ausente

O produto deve falhar de forma informativa:

- mostrar estado sem dados quando a integração não está configurada;
- não conectar silenciosamente a outro projeto/account;
- não usar mock como produção;
- logs server-side devem apontar categoria da configuração faltante sem revelar secret;
- `/edit` permanece bloqueado se o bypass estiver desligado e a superfície autenticada ainda não estiver conectada à rota.

## Supabase por ambiente

Production usa a base existente. Preview não deve ganhar acesso total à produção apenas porque é mais fácil. Quando Edit/autenticação forem homologados, definir dataset/branch/role autorizado específico.

Mesmo no bypass temporário, `SUPABASE_SECRET_KEY` permanece server-only. O browser chama Server Components/Actions; não recebe cliente privilegiado.

Na esteira vigente, Preview não executa `db push` contra Production. Migrations entram no Git, passam pelos testes sintéticos e pela política `tools/ci/check-migrations.mjs`; somente o workflow de Production liga explicitamente ao projeto `dmrqnbdvbkfqzctcerbx`.

O migration history canônico contém entradas legadas anteriores ao reboot TDA que deliberadamente não são copiadas para este repositório. O boundary do TDA é `20260906210333`. Antes de qualquer push, Production cria um workdir Supabase efêmero, busca nele o history remoto, recusa entradas remotas desconhecidas a partir desse boundary e sobrepõe o conjunto TDA com os arquivos autoritativos de `supabase/migrations`. O `db push --dry-run --skip-vault` e o apply rodam somente nesse overlay. Depois do apply, o history é buscado novamente e o conjunto remoto a partir do boundary deve ser exatamente igual ao conjunto deployável do repo antes que o workflow prossiga para smoke/promotion. O overlay não usa `migration repair` e é descartado com o runner.

Alterações destrutivas novas exigem revisão explícita e devem preferir expand → migrate → contract para preservar compatibilidade com a versão ainda publicada.

## R2 por ambiente

- production public/private separados por audience;
- preview bucket isolado;
- local pode usar filesystem/mock explícito ou integração configurada, mas nunca confundir com estado publicado.

## Vercel

Antes de qualquer write/deploy, verificar conta correta. Uma ferramenta conectada a `DND/dndscribe` ou outro team não prova que estamos no contexto `projeto-desenv-6905`.

A publicação automática da integração Git permanece desligada (`git.deploymentEnabled=false`). O GitHub Actions é o controlador da entrega: ele constrói artefatos com Vercel CLI pinada, publica Preview a partir de `Preview` e cria Production staged a partir de `main`. O domínio `dnd.faysk.dev` só troca de deployment após smoke positivo e `vercel promote` do mesmo artefato testado.

## Esteira CI/CD

Há três ambientes lógicos e dois targets cloud:

| Ambiente | Fonte | Publicação | Dados |
| --- | --- | --- | --- |
| Development | branches temporárias | nenhuma | local/sintético/configurado deliberadamente |
| Preview | branch `Preview` | Vercel Preview após CI verde | sem migration automática em Production; R2 Preview |
| Production | branch `main` | Vercel staged → DB overlay/gates → smoke → promote para `dnd.faysk.dev` | Supabase Production + R2 Production |

Fluxo obrigatório após o bootstrap: branch temporária → PR para `Preview` → CI → Preview CD → homologação → PR `Preview` para `main` → CI → Production CD. O check `promotion-source` pode ser ativado com a repository variable `TDA_ENFORCE_PROMOTION_SOURCE=true`; uma vez ativo, PRs para `main` que não venham de `Preview` falham.

GitHub Environments esperados:

- `preview`: secret `VERCEL_TOKEN`;
- `production`: secrets `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD`.

Repository variables de ativação:

- `TDA_CICD_BOOTSTRAP_READY=true` — trava mestra adicional exigida por **ambos** os CDs. Deve permanecer ausente/false durante o merge inicial e só ser ligada depois que os GitHub Environments/secrets estiverem configurados e a branch `Preview` alinhada;
- `TDA_PREVIEW_CD_ENABLED=true` — permite que o workflow de Preview publique após CI verde, mas somente se a trava mestra também estiver ativa;
- `TDA_PRODUCTION_CD_ENABLED=true` — permite staged deployment, migration gate e promoção de Production após CI verde, mas somente se a trava mestra também estiver ativa;
- `TDA_ENFORCE_PROMOTION_SOURCE=true` — exige `Preview -> main` em PRs de produção.

A trava mestra e os dois switches de CD devem permanecer ausentes/false durante o bootstrap. Isso garante que simplesmente integrar os workflows na `main` ou alinhar `Preview` não publique nada, inclusive se algum switch específico tiver sido criado anteriormente. Depois de configurar Environments/secrets, ativar a trava mestra e primeiro o Preview, comprovar um ciclo completo de homologação e somente então ativar Production.

Os IDs não secretos de team/projeto Vercel e project ref Supabase ficam pinados nos workflows para impedir publicação acidental em outro contexto. Secrets runtime da aplicação continuam na Vercel por ambiente; os GitHub secrets acima existem apenas para controlar deployment/migration.

O bootstrap da política exige alinhar a branch `Preview` ao `main` atual antes de habilitar `TDA_ENFORCE_PROMOTION_SOURCE`. Depois disso, `main` representa somente releases promovidas pela linha de homologação.

## Local companion

Configuração deve ficar fora do código e separar:

- endpoint do TDA;
- credential técnica limitada;
- paths locais;
- provider/model;
- cache/work dirs;
- resource limits.

## Checklist de novo ambiente

1. finalidade definida;
2. Supabase/data boundary definido;
3. storage boundary definido;
4. secrets mínimos criados;
5. logs/observability ativos;
6. nenhum production secret desnecessário;
7. smoke positivo e negativo;
8. teardown/rotação definidos;
9. documentação atualizada.
