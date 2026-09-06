# Ambientes e configuração

> Status: vigente
> Owner: operations
> Última revisão: 2026-09-06

## Ambientes conceituais

### Local development

Objetivo: desenvolver/testar app sem publicar.

Características:

- `.env.local` não versionado;
- pode operar sem secrets mostrando estado de preparação;
- não deve inventar sessions mock como se fossem produção;
- build/test local deve ser reproduzível a partir do repo.

### Preview / homologação

Objetivo: validar candidato isolado antes de production quando necessário.

Regras:

- não recebe acesso irrestrito à production por padrão;
- R2 possui bucket `tda-media-preview` próprio;
- dados de teste/autorizados devem ser separados quando a superfície autenticada exigir;
- domínio/URL de Preview não implica feature pública.

### Production

Objetivo: servir conteúdo aprovado na infraestrutura correta.

Recursos canônicos atuais/futuros:

- Supabase existente `dmrqnbdvbkfqzctcerbx`;
- R2 production (`tda-media-public`, `tda-media-private`);
- Vercel correta `projeto-desenv-6905` / `projeto_desenv@outlook.com`;
- campanha `yuhara-main`.

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
- logs server-side devem apontar categoria da configuração faltante sem revelar secret.

## Supabase por ambiente

Production usa a base existente. Preview não deve ganhar acesso total à produção apenas porque é mais fácil. Quando Edit/autenticação forem homologados, definir dataset/branch/role autorizado específico.

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
