# GitHub Wiki — fonte versionada e publicação

**Parent:** #1745 · **Destino:** https://github.com/Faysk/tda/wiki

A pasta `wiki/` contém exclusivamente páginas públicas autorizadas. O repositório da GitHub Wiki é um Git remoto separado (`Faysk/tda.wiki.git`); **uma PR no repo principal não atualiza automaticamente a aba Wiki**.

## Situação atual

- A leitura do conteúdo canônico está em `docs/`.
- `tools/wiki/pages.json` é a allowlist explícita das páginas que podem ir para a Wiki.
- `node tools/wiki/check-wiki.mjs` verifica URLs internas de Wiki, links canônicos locais, fontes, imagens e padrões básicos de privacidade.
- `node --test tools/wiki/check-wiki.test.mjs` executa fixtures de regressão.
- O conteúdo contém diagramas Mermaid e guias ilustrativos textuais; **screenshots reais só entram após revisão e autorização**.

## Gate de publicação

1. Revisar as páginas propostas, a allowlist e as fontes atuais na PR.
2. Executar `pnpm wiki:check` e `pnpm wiki:test` (além do CI normal).
3. Verificar **se a Wiki já possui conteúdo** e preservar/conciliar alterações existentes.
4. Se a Wiki não tiver sido inicializada, um mantenedor cria a primeira Home na própria aba Wiki; isso cria o repositório Git da Wiki.
5. Após decidir o método #1747, fazer clone autenticado do `https://github.com/Faysk/tda.wiki.git` com credenciais já autorizadas do mantenedor. Não criar PAT novo sem necessidade; não registrar tokens em arquivos.
6. Comparar arquivos atuais com a lista aprovada em `wiki/`. Aplicar somente páginas de allowlist, nunca usar `git push --force` ou apagar conteúdo existente por espelhamento cego.
7. Criar commit no repositório Git da Wiki, publicar e **verificar Home, _Sidebar, _Footer, diagramas e links na interface real**; registrar SHA de origem e commit de publicação/rollback.
8. Rollback consiste em reverter commit(s) identificados no histórico da Wiki, nunca reescrever histórico remoto sem plano e autorização.

## Sincronização futura

A #1761 deve estudar automação controlada com credencial de menor privilégio, disparo deliberado e detecção de conflitos, **sem expor tokens em pull requests externas**. Um evento automático em toda atualização de `main` não deve publicar conteúdo sem revisão nem marcar feature como entregue.

Não criar VitePress, Docusaurus, GitHub Pages ou outro domínio. A documentação viva e os recibos de release dos produtos não são substituídos por esta Wiki.

## Sincronização controlada (proposta implementada em fonte)

O utilitário `tools/wiki/sync-wiki.mjs` valida a allowlist antes de qualquer ação. Sua operação normal é **somente planejamento**, sem escrita:

```bash
git clone https://github.com/Faysk/tda.wiki.git ../tda-wiki
node tools/wiki/sync-wiki.mjs --wiki-dir ../tda-wiki
```

Se o comando detectar uma página existente com conteúdo diferente de uma versão previamente gerenciada, **interrompe** a operação: edições feitas diretamente na aba Wiki precisam ser reconciliadas manualmente. Páginas desconhecidas ficam preservadas; não existe exclusão automática.

Após aprovação e com `main` no SHA exato da fonte, um mantenedor pode **preparar arquivos locais**, sem commit nem push automático:

```bash
node tools/wiki/sync-wiki.mjs --wiki-dir ../tda-wiki --source-sha <COMMIT_SHA_40_HEX> --apply
git -C ../tda-wiki diff --check
git -C ../tda-wiki diff
```

**Não execute o comando acima se a Wiki não tiver sido inicializada ou a PR ainda não tiver sido aprovada.** O parâmetro `--apply` escreve somente no clone local autorizado. Um arquivo `.tda-wiki-sync-state.json` guarda checksums dos arquivos gerenciados e o SHA de origem; não há credenciais nesse arquivo. Revisão humana, commit, push e readback são passos separados.

Antes do uso real, validar origem do clone Git, branch da Wiki, situação sem modificações locais, política de token e efeitos da presença do arquivo de estado no renderer do GitHub. `--apply` não resolve alterações concorrentes entre o preparo e o push; usar push não forçado e conferir commit remoto antes de promover. A versão posterior poderá ter workflow manual com permissão mínima, se aprovado.

## Relatório de cobertura por domínio

`pnpm wiki:coverage` gera relatório read-only com a quantidade de documentos Markdown existentes em `docs/`, quantos têm ligação explícita nas páginas da Wiki, quais áreas estão sub-representadas e lacunas de `Owner`/`Última revisão`. O relatório não publica ficheiros nem afirma que um simples link corresponde a um tutorial completo. Cada revisão deve cruzar o resultado com `docs/documentation/catalog.md` e as fontes donas, sem inventar datas de revisão.

## Alertas de impacto ao atualizar documentação canônica

O comando `pnpm wiki:impact` compara os Markdown alterados entre `origin/main` e o HEAD local (é necessário ter o ref do Git atualizado) e lista quais páginas da Wiki apontam para essas fontes. Ele **não modifica a Wiki** e não afirma automaticamente desatualização: um dono deve julgar se houve alteração de contrato que exige reescrever o guia. Páginas sem referências também aparecem como lacuna potencial de cobertura. Em mudanças já integradas na main, forneça uma base mais antiga com `node tools/wiki/impact.mjs --base <sha-conhecido>`.
