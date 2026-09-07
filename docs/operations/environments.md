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

## R2 por ambiente

- production public/private separados por audience;
- preview bucket isolado;
- local pode usar filesystem/mock explícito ou integração configurada, mas nunca confundir com estado publicado.

## Vercel

Antes de qualquer write/deploy, verificar conta correta. Uma ferramenta conectada a `DND/dndscribe` ou outro team não prova que estamos no contexto `projeto-desenv-6905`.

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
