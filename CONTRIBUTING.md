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

O contrato é:

1. preservar a fonte aprovada;
2. registrar identidade/role/audience;
3. registrar SHA-256, MIME, bytes e dimensões;
4. manter/atualizar o manifest canônico;
5. executar `pnpm media:validate` e `pnpm check`;
6. deixar a publicação remota para a automação autorizada.

### Estado transitório do repositório

O repo ainda contém fontes/binários históricos em `media/sources/` e outras áreas porque a Media Pipeline anterior dependia deles.

Isso é dívida de migração, não padrão para nova arquitetura. Não introduzir novo storage de mídia no Git por conveniência sem decisão explícita e plano de convergência para Media Storage.

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

### Drift atual

Em 2026-09-20 a automação de mídia ainda precisa convergir para ADR-0018. O workflow integrado ainda tenta obter R2 via Vercel e o planner ainda pode esquecer manifest de uma release de mídia falha.

Até a correção:

- não fazer bypass manual;
- não tratar manifest em `main` como prova de publicação;
- usar o [runbook de Media Storage](docs/operations/r2-media-runbook.md) e [CI/CD](docs/operations/ci-cd.md).

## Documentação

Mudança estrutural de provider, secret, workflow, schema, storage, lifecycle, release ou rollback deve atualizar a documentação dona do assunto na mesma PR.
