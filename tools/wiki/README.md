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
node tools/wiki/sync-wiki.mjs --wiki-dir ../tda-wiki --source-sha <COMMIT_SHA_40_HEX> --expected-wiki-head <SHA_EXATO_DA_WIKI> --apply
git -C ../tda-wiki diff --check
git -C ../tda-wiki diff
```

**Não execute o comando acima se a Wiki não tiver sido inicializada ou a PR ainda não tiver sido aprovada.** O parâmetro `--apply` escreve somente no clone local autorizado. Um arquivo `.tda-wiki-sync-state.json` guarda checksums dos arquivos gerenciados e o SHA de origem; não há credenciais nesse arquivo. Revisão humana, commit, push e readback são passos separados.

Antes do uso real, validar origem do clone Git, branch da Wiki, situação sem modificações locais, política de token e efeitos da presença do arquivo de estado no renderer do GitHub. `--apply` não resolve alterações concorrentes entre o preparo e o push; usar push não forçado e conferir commit remoto antes de promover. A versão posterior poderá ter workflow manual com permissão mínima, se aprovado.

## Relatório de cobertura por domínio

`pnpm wiki:coverage` gera relatório read-only com a quantidade de documentos Markdown existentes em `docs/`, quantos têm ligação explícita nas páginas da Wiki, quais áreas estão sub-representadas e lacunas de `Owner`/`Última revisão`. O relatório não publica ficheiros nem afirma que um simples link corresponde a um tutorial completo. Cada revisão deve cruzar o resultado com `docs/documentation/catalog.md` e as fontes donas, sem inventar datas de revisão.

## Alertas de impacto ao atualizar documentação canônica

O comando `pnpm wiki:impact` compara os Markdown alterados entre `origin/main` e o HEAD local (é necessário ter o ref do Git atualizado) e lista quais páginas da Wiki apontam para essas fontes. Ele **não modifica a Wiki** e não afirma automaticamente desatualização: um dono deve julgar se houve alteração de contrato que exige reescrever o guia. Páginas sem referências também aparecem como lacuna potencial de cobertura. Em mudanças já integradas na main, forneça uma base mais antiga com `node tools/wiki/impact.mjs --base <sha-conhecido>`.

**Proteções adicionais:** `--apply` também exige que o checkout de origem esteja limpo e que `--source-sha` corresponda exatamente ao commit Git nesse checkout; uma SHA inventada ou um arquivo local ainda não revisado interrompe o preparo. Páginas que sejam links simbólicos são rejeitadas pelo gate de publicação. A execução remota continua dependendo de revisão humana e permissões separadas.

## Atualização contínua — integração com CI

O job `validate` da CI agora executa um relatório **informativo e não bloqueante** em pull requests: para cada arquivo Markdown de `docs/` alterado, lista quais páginas em `wiki/` o referenciam. A execução usa `origin/<base>` obtido do GitHub e não faz alterações. Esse alerta ajuda os revisores a manterem a camada didática em sincronia, mas **não comprova** que uma página ficou desatualizada nem autoriza publicá-la automaticamente. A revisão de conteúdo continua manual e separada do fluxo de deploy.

## Pacote de revisão por SHA

`node tools/wiki/stage-wiki.mjs --out /caminho/novo/absoluto` produz **somente** os artigos públicos allowlisted em `pages/` e um `receipt.json` com o SHA exato do commit e hashes SHA-256 por arquivo. Falha se a fonte `wiki/` tiver alterações locais não commitadas, se a lista pública não passar no gate, ou se o destino já existir. O artefato final pode ser verificado por `verifyWikiBundle` antes de qualquer uso. **Não é publicação da Wiki**: não inclui push, token, alteração de banco ou deploy Web.

Em PRs, a CI cria o pacote automaticamente como artefato **tda-wiki-review-<checkout-sha>**, retido por 14 dias, depois dos checks de código e Wiki. Esse pacote é para inspeção de conteúdo aprovado e eventual importação manual após conciliar a GitHub Wiki existente. Em PR, o checkout padrão da CI pode ser o **commit de merge de teste** (não o head isolado da PR); o receipt e o nome do artefato usam exatamente o SHA que foi de facto testado em `git rev-parse HEAD`. Para publicar após o merge, gerar um novo bundle a partir do commit de `main` efetivamente aprovado. Revalide um bundle baixado com `node tools/wiki/stage-wiki.mjs --verify /caminho/do/pacote`.

O receipt de transporte **não** deve ser copiado para a raiz da Wiki Git; somente os arquivos `pages/*.md` pertencem à publicação. Registre separadamente a revisão humana, o commit real do Wiki Git, smoke de Home/sidebar/footer/Mermaid, e rollback.

## Pré-validação read-only de publicação (Git Wiki separado)

Após aprovar e integrar a documentação, gerar o bundle a partir do **commit canônico limpo de main**. Obter o estado da Wiki sem presumir que esteja vazia:

```bash
git clone https://github.com/Faysk/tda.wiki.git ../tda-wiki
git -C ../tda-wiki fetch origin
git -C ../tda-wiki rev-parse HEAD
node tools/wiki/preflight-wiki.mjs \
  --bundle-dir /CAMINHO/DO/BUNDLE \
  --wiki-dir ../tda-wiki \
  --expected-wiki-head <SHA_EXATO_DA_WIKI>
```

O preflight **não escreve nenhum ficheiro**. Verifica integridade e allowlist do pacote, igualdade byte-a-byte com a source checkout, source HEAD e worktree limpos, origin Git Wiki exato, HEAD aprovado da Wiki, branch com upstream origin correspondente, upstream local atualizado e ausência de drift em páginas já gerenciadas. Lista explicitamente páginas a criar/atualizar, páginas iguais e outras páginas preservadas. Sete testes sintéticos cobrem isso com repositórios Git locais; nenhum teste toca o remote real.

**Limitação crítica:** comparar `HEAD` com `origin/<branch>` **não faz contato com o servidor**. Um fetch anterior pode ficar desatualizado depois do preflight. Repetir o fetch antes de preparar e executar **push não-forçado**, que rejeita remote avançado. Um recibo de preflight não prova autenticação, render GitHub, publicação, nem rollback. O primeiro bootstrap de Wiki sem commit segue sendo passo de mantenedor documentado na #1761.

### Inspeção remota independente (somente leitura)

O job `validate` em PR também tenta obter `WIKI_REMOTE_HEAD` com `git ls-remote` anônimo, sem credenciais, sobre `https://github.com/Faysk/tda.wiki.git`. Isso **não faz clone, não publica e não modifica a Wiki**. Um erro ou resultado vazio é relatado como `WIKI_REMOTE_NOT_READABLE_OR_NOT_INITIALIZED` ou `WIKI_REMOTE_NO_ADVERTISED_HEAD`, **não como prova de que a Wiki esteja vazia**. Esse passo não bloqueia a CI: a confirmação decisiva de permissões, histórico e SHA remoto pertence ao preflight e ao mantenedor no lançamento controlado.

## Ensaio local de publicação e rollback Git (sem GitHub remoto)

`tools/wiki/publication-flow.test.mjs` inicializa um repositório Git bare **sintético** no diretório temporário. Três testes verificam: (1) pacote preparado, commit e push normal com readback por novo clone e preservação de conteúdo unmanaged; (2) push comum recusado quando outro editor fez commit sobre base antiga; e (3) `git revert` do commit sintético com push não-forçado e readback do estado anterior.

**Esse ensaio não publica nenhuma página real**, não demonstra permissões do repo Wiki GitHub e não valida sidebar/Mermaid na UI. Ajuda a verificar regras de recuperação por histórico preservado, não a afirmar #1761 concluída.

## Matriz auditável de todas as fontes canônicas

`node tools/wiki/coverage.mjs --matrix` lista cada Markdown realmente encontrado em `docs/`, a área, as páginas de Wiki que o referenciam e os valores **declarados** de Owner/Última revisão (ou `null`, jamais inferidos). Por segurança editorial, toda linha recebe `disposition: requires-owner-review`: **não há aprovação automática para espelhar conteúdo** por estar linkado. O relatório normal `pnpm wiki:coverage` continua fornecendo números/resumo por área. O comando não cria arquivos, não altera `docs/` e não publica na Wiki.

A matriz é um **inventário de triagem**, não o cumprimento final de #1746: cada owner ainda precisa decidir se o assunto merece tutorial, link técnico sem cópia ou exclusão editorial, registrar a justificativa, e validar a natureza pública de qualquer material que vá para a Wiki.

## Runbook completo de bootstrap, adoção e rollback

O roteiro em [PUBLISH_RUNBOOK.md](./PUBLISH_RUNBOOK.md) documenta fonte aprovada em main, bundle, clone Wiki autorizado, preflight, adoção explícita por SHA do Wiki HEAD + hash dos bytes de cada página existente, preparo local, revisão humana, push não forçado, readback e rollback. A opção --adopt-file nunca contorna drift de página já gerenciada e não concede permissão de escrita por si só.

## Verificação pós-publicação no Git Wiki

Após push autorizado, **fetch/clonagem read-only** no Git da Wiki e smoke visual, execute `node tools/wiki/verify-wiki.mjs --wiki-dir ../tda-wiki-readback --source-sha <SHA_MAIN> --wiki-commit <SHA_COMMIT_WIKI>` a partir do checkout **limpo** de main no SHA exato. O comando verifica identity, upstream local atualizado, receipt do sync, conjunto allowlisted e igualdade byte-a-byte de todas as páginas publicadas. É somente leitura e nunca entra em produção. **Não** prova o renderer GitHub Wiki; esse aceite permanece manual. Não reutilize automaticamente o clone usado para preparar o push, preferindo um clone de readback independente.

**Gate obrigatório de `--apply`:** fornecer também `--expected-wiki-head`; o stage recusa Wiki HEAD diferente do preflight, checkout sujo e tracking `origin/<branch>` local divergente. Isso não equivale a buscar o HEAD remoto em tempo real; repetir `git fetch` antes da operação e usar push comum continua obrigatório.

## Proteção do Git index antes de publicar

Após `sync-wiki.mjs --apply`, execute `node tools/wiki/verify-wiki-index.mjs --wiki-dir ../tda-wiki --source-sha <SHA_EXATO> --expected-wiki-head <SHA_WIKI_APROVADO> --stage`. Esse comando, deliberadamente, **altera somente o índice Git local**, adicionando exclusivamente os nomes da allowlist mais `.tda-wiki-sync-state.json`. Rejeita arquivos extras, conteúdo diferente dos bytes revisados, estado de sync inconsistente, fonte ou HEAD inesperados. Sem `--stage`, verifica todo o índice somente em leitura, conferindo todos os bytes staged com o source, e exige ausência de trabalho não staged/untracked. **Não faz commit, push ou deploy**, e não substitui revisão do `git diff --cached` ou readback GitHub. Não usar `git add '*.md'`: poderia incluir Markdown fora da allowlist.

## Registo de revisão editorial por página

`tools/wiki/editorial-reviews.json` contém um estado `pending` **para cada página da allowlist**. Nenhum revisor ou aceite foi inventado. `pnpm wiki:editorial` lista as revisões pendentes na CI (não bloqueia PRs que ainda estão a preparar a documentação). Depois de uma **revisão humana real**, o mantenedor pode mudar uma página para `approved` com seu GitHub username, data ISO, SHA-256 **dos bytes exatos** do `.md` e link de comentário/issue/PR com a evidência. A validação rejeita hash desatualizado e metadados inválidos. Antes de publicação, `node tools/wiki/editorial-gate.mjs --require-approved` deve passar. O JSON, mesmo validado, não autentica o revisor; os links devem ser conferidos e o aceite no GitHub Wiki real continua separado.

**Revisão é obrigatória para preparar publicação:** o CLI `sync-wiki.mjs --apply` executa `auditWikiEditorial(...,{requireApproved:true})` antes de modificar qualquer arquivo no clone Wiki. Com o registro inicial de 39 páginas pendentes, o preparo está bloqueado até haver assinatura editorial humana com SHA-256 exato e evidência no GitHub. O dry-run e a montagem de bundle para revisão continuam possíveis; nenhum push é automático.

## Dossiê automático para revisores humanos

`node tools/wiki/review-packet.mjs --out /caminho/novo/revisao.md` cria um **dossiê de revisão** com as páginas por secção da sidebar, URLs fixadas ao SHA do checkout, os hashes SHA-256 exatos das páginas, fontes `docs/` citadas e tarefas de revisão por página. Não copia arquivos privados, não assume que fontes linkadas foram plenamente auditadas, nem marca `approved`. A geração recusa fonte suja e destino já existente. Na CI de PR, o artefato separado `tda-wiki-editorial-<checkout-sha>` fica disponível durante 14 dias. O revisor deve ler efetivamente o conteúdo e registrar seu parecer na issue/PR, antes de modificar `editorial-reviews.json`.
