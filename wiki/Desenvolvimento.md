# 💻 Desenvolvimento e contribuição

**Para quem:** pessoas que desejam estudar, corrigir ou ampliar o código. Os primeiros passos usam ferramentas locais e não exigem segredos de Production.

## Pré-requisitos

Use as versões fixadas em [.node-version](https://github.com/Faysk/tda/blob/main/.node-version) e [package.json](https://github.com/Faysk/tda/blob/main/package.json). O app Web usa Node, pnpm, Next.js e TypeScript; o Companion possui seu próprio projeto Python.

~~~bash
git clone https://github.com/Faysk/tda.git
cd tda
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm dev
~~~

Se o ambiente local não tiver integrações autenticadas, o TDA pode mostrar **estado de preparação**. Isso não comprova dados de produção. Copie o arquivo de exemplo de ambiente para o ambiente local só quando a tarefa exigir integração; nunca use chaves administrativas reais em fixtures.

## Onde encontrar o código

| Caminho | Conteúdo |
| --- | --- |
| src/app/ | Rotas e superfícies Next.js |
| src/features/ | Features e módulos Web |
| local-companion/ | Agent, Desktop e ASR |
| supabase/ | Migrations e schemas de banco |
| media/ | Manifests e integridade de mídia |
| docs/ | Contratos e documentação canônica |
| tests/ e tools/ | Testes, verificadores, fixtures |

## Como uma mudança chega ao produto?

~~~mermaid
flowchart LR
  A["Issue"] --> B["Branch"]
  B --> C["Código + documento dono"]
  C --> D["Testes / CI"]
  D --> E["PR e revisão"]
  E --> F["main"]
  F --> G["Deploy deliberado com evidência"]
~~~

**Atualize o documento dono na mesma PR** se houver alteração de contrato. Não diga que algo foi publicado só porque a PR passou na CI.

~~~bash
pnpm check
pnpm build
pnpm test:e2e
pnpm docs:check
~~~

Os testes têm diferentes escopos; leia os scripts atuais antes de executar suítes pesadas.

## Leia antes de contribuir

[README principal](https://github.com/Faysk/tda/blob/main/README.md) · [CONTRIBUTING](https://github.com/Faysk/tda/blob/main/CONTRIBUTING.md) · [Documentação viva](https://github.com/Faysk/tda/blob/main/docs/documentation/README.md) · [Governança de issues](https://github.com/Faysk/tda/blob/main/docs/delivery/issue-governance.md) · [ADRs](https://github.com/Faysk/tda/blob/main/docs/adr/README.md)

Próximo: [Arquitetura](https://github.com/Faysk/tda/wiki/Arquitetura) · [Manter a Wiki](https://github.com/Faysk/tda/wiki/Como-manter-a-Wiki)
