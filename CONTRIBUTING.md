# Contribuindo com o TDA

Este repositório separa desenvolvimento local de operações autenticadas de infraestrutura. O objetivo é permitir contribuição normal sem distribuir segredos de Production.

A arquitetura geral segue [ADR-0018](docs/adr/0018-portable-core-github-control-plane.md): GitHub é o control plane, providers são substituíveis, infraestrutura é free-first e toda mídia persistida/publicada pertence ao Media Storage.

## Setup básico

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

Copie `.env.example` para `.env.local` apenas quando a tarefa precisar de integrações autenticadas. Não é necessário preencher todos os campos para trabalhar no projeto.

## Contribuição de mídia

Contribuição comum não recebe credenciais de Production.

O contrato arquitetural é:

1. preservar a fonte aprovada no Media Storage adequado ao seu audience/estado;
2. registrar identidade/role/audience;
3. registrar SHA-256, MIME, bytes, dimensões e provenance no Git;
4. manter/atualizar o manifest canônico;
5. executar os checks compatíveis com o fluxo;
6. deixar publicação/promote remotos para a automação autorizada.

**Nova mídia não deve ser adicionada ao Git como byte de storage.**

### Estado transitório do repositório

O repo ainda contém fontes/binários históricos em `media/sources/`, `public/lore/`, `public/brand/` e outras áreas. O inventário corrente está em [Dívida de mídia ainda versionada no Git](docs/integrations/media-git-debt-2026-09-20.md).

A Media Pipeline v1 ainda exige `asset.source` dentro de `media/sources/`; isso é **limitação técnica conhecida**, não autorização para continuar adicionando mídia ao repositório.

Para nova mídia, não contornar essa limitação com commit de bytes. Corrigir/estender o intake para private/preview R2 primeiro, ou executar uma operação R2 explicitamente autorizada e documentada. Git mantém manifest/hash/metadata, não a fonte binária.

## Credenciais locais

Use credenciais de storage locais apenas quando a tarefa for explicitamente operacional ou de desenvolvimento server-side.

Regras:

- credencial individual/development/preview;
- privilégio mínimo;
- `.env.local` ignorado pelo Git;
- nunca `NEXT_PUBLIC_` para segredo;
- nunca secret em commit, PR, issue, screenshot, log ou chat;
- nunca distribuir Production só para destravar contribuição comum.

Provider atual R2 reconhece:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_PUBLIC_BUCKET
R2_PRIVATE_BUCKET
R2_PREVIEW_BUCKET
```

Esses nomes são implementação atual, não contrato permanente do domínio.

## Publicação

Não publique mídia canônica de Production manualmente da estação de desenvolvimento.

Caminho desejado:

```text
branch -> PR -> CI -> merge main -> Production CD
       -> Media Storage publish/reuse
       -> read-back
       -> public verification
       -> receipt
       -> smoke/promote
```

Para o provider atual, o publisher é `tools/ci/publish-production-media.sh`, usando `tools/media/pipeline.mjs`.

A automação de Production usa o intervalo ainda não publicado e GitHub Environment `production` para os secrets do provider atual. Não existe publisher especial por lore.

Não tratar manifest em `main` como prova de publicação; o [runbook de Media Storage](docs/operations/r2-media-runbook.md) e [CI/CD](docs/operations/ci-cd.md) definem os receipts necessários.

## Documentação

Mudança estrutural de provider, secret, workflow, schema, storage, lifecycle, release ou rollback deve atualizar a documentação dona do assunto na mesma PR.
