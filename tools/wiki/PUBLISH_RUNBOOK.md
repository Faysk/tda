# Publicar a Wiki nativa do TDA — runbook operacional

**Destino exclusivo:** https://github.com/Faysk/tda/wiki  
**Dono:** #1761 · **Estado:** instruções preparadas, não executadas na Wiki real.

## Antes da primeira publicação

A PR #1762 contém a fonte revisável em wiki/ e a allowlist tools/wiki/pages.json. O Git da Wiki é outro repositório, Faysk/tda.wiki.git. **A PR e a CI não publicam essas páginas.** O operador precisa de permissão de escrita na Wiki, aprovação de conteúdo, CI do SHA aceito e aceite editorial.

Confirme a aba Wiki já autenticado. Se não houver Home, um mantenedor poderá criar **uma Home provisória sem informação privada** pela UI para inicializar o Git Wiki. Isso não prova o estado de outras páginas. Não confunda o erro anônimo de ls-remote da CI com prova de Wiki vazia.

## 1. Examinar a Wiki atual

~~~bash
git clone https://github.com/Faysk/tda.wiki.git ../tda-wiki
git -C ../tda-wiki fetch origin
git -C ../tda-wiki remote -v
git -C ../tda-wiki branch -vv
git -C ../tda-wiki status --porcelain
git -C ../tda-wiki rev-parse HEAD
git -C ../tda-wiki rev-parse '@{upstream}'
~~~

Registre SHA inicial, branch e páginas já existentes. O origin deve ser exatamente o Git Wiki do TDA, sem modificações locais. Preserve o histórico. Nunca faça force push.

## 2. Preparar a fonte aprovada

**Depois do merge**, use main no SHA exato aprovado. A CI de PR costuma testar um merge commit temporário: não confunda esse hash com o da main integrada.

~~~bash
git checkout main
git pull --ff-only origin main
git status --porcelain
git rev-parse HEAD
node tools/wiki/coverage.mjs
node tools/wiki/editorial-gate.mjs --require-approved
node tools/wiki/stage-wiki.mjs --out /CAMINHO_NOVO/tda-wiki-bundle
node tools/wiki/stage-wiki.mjs --verify /CAMINHO_NOVO/tda-wiki-bundle
~~~

**Se qualquer página ainda estiver pendente de revisão editorial, pare aqui:** a checagem estrita bloqueará a preparação final. Não marque `approved` sem revisão por uma pessoa e prova vinculada ao SHA-256 do conteúdo.

O diretório do bundle deve ficar **fora dos dois checkouts** e ainda não existir. O bundle contém somente páginas aprovadas e receipt SHA-256. Não copie o receipt nem qualquer conteúdo privado para a Wiki.

## 3. Pré-validação somente leitura

~~~bash
node tools/wiki/preflight-wiki.mjs \
  --bundle-dir /CAMINHO_NOVO/tda-wiki-bundle \
  --wiki-dir ../tda-wiki \
  --expected-wiki-head SHA_EXATO_DA_WIKI
~~~

O relatório confere bundle, bytes, SHA da fonte e Wiki, branch/upstream, checkout limpo e conflitos em páginas existentes. Exibe create/update/unchanged/adopted/unmanagedPreserved. **Não grava arquivos nem verifica o HEAD remoto em tempo real**: faça fetch novamente antes do preparo/push.

### Adoção aprovada de Home pré-existente

Uma Home criada na UI para inicializar a Wiki provavelmente diferirá da Home aprovada na PR. O sincronizador **deve bloquear** essa substituição.

Para substituir somente páginas concretas após decisão humana, compare os conteúdos, preserve uma cópia **fora dos checkouts** e prepare um JSON local de aprovação, também fora dos checkouts:

~~~json
{
  "schemaVersion": 1,
  "repository": "Faysk/tda",
  "wikiHead": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "pages": {
    "Home.md": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
~~~

Use o **SHA-1 exato do HEAD da Wiki existente** em wikiHead e o **SHA-256 dos bytes da página existente, não da nova**, em pages. Calcule com sha256sum no Git Bash/Linux ou Get-FileHash -Algorithm SHA256 no PowerShell. Os valores acima são fictícios e não autorizam nada.

Repita o preflight acrescentando o argumento:

~~~text
--adopt-file /CAMINHO_FORA_DOS_REPOS/aprovacao.json
~~~

Aprovação com SHA errado, nome desconhecido, hash desatualizado ou página anteriormente gerenciada com drift **não autoriza substituição**. A Home anterior continua recuperável pelo histórico Git.

## 4. Preparar localmente, sem push

Depois de novo fetch, confira que HEAD e upstream continuam iguais ao SHA aprovado e repita o preflight. Faça o preparo:

~~~bash
node tools/wiki/sync-wiki.mjs \
  --wiki-dir ../tda-wiki \
  --source-sha SHA_EXATO_DA_MAIN \
  --expected-wiki-head SHA_EXATO_DA_WIKI --apply
git -C ../tda-wiki status --short
git -C ../tda-wiki diff --check
git -C ../tda-wiki diff
~~~

Quando houver aprovação explícita, inclua o mesmo argumento --adopt-file utilizado no preflight.

O comando recusa qualquer SHA de HEAD Wiki diferente da previamente aprovada, upstream local divergente ou clone sujo. Faça um novo fetch antes do preparo; o check continua local e não autentica o servidor.

Esse comando **não faz commit nem push**. Revise nomes de arquivos, conteúdo, imagens, Mermaid e o estado .tda-wiki-sync-state.json. Devem mudar só páginas allowlisted e estado de sync. Não sobrescreva outras páginas por espelhamento.

## 5. Publicar apenas após revisão

~~~bash
node tools/wiki/verify-wiki-index.mjs \
  --wiki-dir ../tda-wiki \
  --source-sha SHA_EXATO_DA_MAIN \
  --expected-wiki-head SHA_EXATO_DA_WIKI --stage
node tools/wiki/verify-wiki-index.mjs \
  --wiki-dir ../tda-wiki \
  --source-sha SHA_EXATO_DA_MAIN \
  --expected-wiki-head SHA_EXATO_DA_WIKI
git -C ../tda-wiki diff --cached --check
git -C ../tda-wiki diff --cached --stat
git -C ../tda-wiki commit -m "docs(wiki): publish TDA Wiki from approved main SHA"
git -C ../tda-wiki push
git -C ../tda-wiki rev-parse HEAD
~~~

O push comum recusa non-fast-forward. Se outro editor publicou algo entre o fetch e o push, **pare e reconcilie**; não use force push, reset destrutivo ou supressão de arquivos.

Registre source SHA, Wiki commit SHA, lista de páginas revisadas, operador, data e resultado do readback.

## 6. Verificação no GitHub Wiki real

Abra Home, sidebar, footer, índice, três tutoriais principais e duas fontes técnicas na aba Wiki. Confira links, imagem de marca, 30 diagramas Mermaid, legibilidade mobile/desktop, tema claro/escuro e teclado. Faça as tarefas por persona em tools/wiki/REVIEW_CHECKLIST.md. Não declare 100% de cobertura apenas porque existem 35 páginas.

### Comprovação por SHA e hashes, separada do navegador

Depois de confirmar o push, prefira fazer um **segundo clone** somente para readback, obter o SHA real do commit e verificar os bytes contra o mesmo checkout limpo de main usado na publicação:

~~~bash
git clone https://github.com/Faysk/tda.wiki.git ../tda-wiki-readback
git -C ../tda-wiki-readback fetch origin
git -C ../tda-wiki-readback rev-parse HEAD
node tools/wiki/verify-wiki.mjs \
  --wiki-dir ../tda-wiki-readback \
  --source-sha SHA_EXATO_DA_MAIN \
  --wiki-commit SHA_EXATO_DO_COMMIT_WIKI
~~~

Esse check falha se o commit ou o upstream local não correspondem, o receipt do sync diverge ou uma página da allowlist difere nos bytes. **Não substitui** o smoke visual do GitHub Wiki nem prova que o servidor publicou o renderer; registra separadamente resultado do navegador e do verificador Git.

## 7. Rollback reversível

Se uma publicação aprovada precisar ser revertida, identifique o commit Wiki específico e examine mudanças posteriores. Num clone atualizado, sem conflito:

~~~bash
git -C ../tda-wiki fetch origin
git -C ../tda-wiki status --porcelain
git -C ../tda-wiki revert --no-edit SHA_DO_COMMIT_WIKI
git -C ../tda-wiki push
~~~

Verifique a Wiki pública novamente e registre o commit de rollback. **Não reescreva histórico remoto.**

## Limites atuais

O repositório principal já tem testes sintéticos de push, detecção de escritor concorrente, recuperação via git revert e preflight; **isso não testa autenticação nem a renderização real do GitHub Wiki**. A consulta anônima da CI não conseguiu obter HEAD da Wiki e não confirmou se ela está inicializada. A primeira publicação continua exigindo mantenedor autorizado e readback na própria plataforma.
