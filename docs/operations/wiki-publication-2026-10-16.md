# Primeira publicação da GitHub Wiki — 2026-10-16

> Status: publicado
> Owner: documentação / operations
> Última revisão: 2026-10-16
> Fonte de verdade: Git Wiki remoto, SHA da fonte e readback abaixo

## Entrega observada

[Wiki do TDA](https://github.com/Faysk/tda/wiki), publicada a partir da [PR #1762](https://github.com/Faysk/tda/pull/1762) já integrada. São **37 artigos + `_Sidebar.md` + `_Footer.md` = 39 arquivos Markdown**. A contagem `Pages 37` do GitHub exclui os dois componentes de navegação.

| Identidade | Valor |
| --- | --- |
| Fonte limpa da main | `323a31ecc5bf8a1da8f51015b0a0e988b2ccbf12` |
| Git Wiki | `https://github.com/Faysk/tda.wiki.git` |
| Branch Wiki | `master` |
| Bootstrap Home pela UI | `9cd4f21900c7dbb88f9b99f6b8912d9dc53bae2e` |
| Publicação | `8ac0c7daa5099bf1b7da5b2febbd5ec131d3e01b` |
| Operador | Codex na sessão local autorizada pelo proprietário Faysk |

Antes da execução, a sessão autenticada exibia `Create the first page`. A Home provisória inicializou o Git Wiki, tornando o clone acessível. Sua adoção foi limitada ao HEAD e ao hash dos bytes existentes; o histórico foi preservado. Nenhuma página anterior de usuário foi removida.

## Autorização e limite editorial

O proprietário já havia instruído “aprovado pode publicar” e, após receber o diagnóstico de que apenas a integração havia ocorrido, reiterou “ok completa o que precisa ser feito”. Essa instrução autorizou **a entrega inicial do conteúdo já integrado**, inclusive bootstrap e publicação na Wiki nativa.

Foi aplicada uma exceção operacional explícita para esta primeira entrega à exigência local de parecer individual prévio. As funções de sync existentes foram usadas após conferir snapshot, allowlist e hashes; o CLI estrito e o registro editorial não foram modificados. **Não foram inventadas assinaturas: o registro continua com 0/39 aprovações editoriais individuais.** Revisão independente e compreensão por pessoas reais continuam sob [#1759](https://github.com/Faysk/tda/issues/1759) / [#1760](https://github.com/Faysk/tda/issues/1760); publicar não comprova esses aceites.

## Evidências técnicas

- CI [38824130765](https://github.com/Faysk/tda/actions/runs/38824130765), CodeQL [38824130701](https://github.com/Faysk/tda/actions/runs/38824130701) e Campaign Isolation Gate [38824130950](https://github.com/Faysk/tda/actions/runs/38824130950): `success` na fonte integrada exata.
- `check-wiki.mjs`: 39 arquivos, 36 diagramas e uma URL de mídia aprovada; links canônicos resolvidos no checkout.
- Node **24.19.0**, testes Wiki locais: **69 executados, 69 aprovados**, excluindo explicitamente os dois casos de symlink via `--test-skip-pattern=symlink`. Neste Windows, criá-los retorna `EPERM`; não alegar execução desses dois casos. A configuração `core.autocrlf=false` foi limitada aos clones/execução de testes, preservando os bytes LF da fonte.
- Bundle gerado e revalidado; preflight read-only com adoção por hash somente de `Home.md`; índice com exatamente 39 páginas e `.tda-wiki-sync-state.json`; `diff --cached --check` aprovado.
- Push comum `9cd4f21..8ac0c7d`, sem force. Segundo clone independente retornou `WIKI_READBACK_VERIFIED`, com igualdade de bytes e hashes dos **39 arquivos**, source SHA e commit remoto conferidos.
- Navegador GitHub real: **37/37 artigos** com conteúdo, **36/36 diagramas** com SVG `#diagram` renderizado nos iframes Mermaid e nenhum erro de sintaxe/renderização encontrado. Home/sidebar/footer e links do índice presentes. O JSON de estado não aparece como artigo.
- Marca da Home carregada (`complete` e dimensão natural positiva), mantendo a URL oficial já aprovada no Media Storage; nenhum upload/alteração de mídia.
- Home inspecionada em tema escuro, desktop e viewport **390 × 844**. No mobile: `innerWidth=390`, largura do documento `375`, sem overflow horizontal da página. Navegação por teclado Home → Comece aqui acionada; destino confirmado no inventário de abas. Não foi feita avaliação com leitor de tela nem teste de compreensão com pessoas reais; tema claro não foi validado nesta rodada.

Capturas e relatório detalhado de navegação foram preservados no pacote operacional local fora do Git. Nenhuma captura com chrome de conta, arquivo de trabalho, transcrição ou segredo foi commitada.

### Correção visual da Home

O smoke identificou que o renderer nativo exibia o SVG da marca em largura total, empurrando a apresentação para baixo. A PR documental de continuidade troca somente essa imagem inline por um link para **o mesmo objeto oficial**, preservando o arquivo no Media Storage. Os SHA acima identificam a primeira publicação; a republicação da Home corrigida tem seu próprio source SHA, commit Wiki e readback registrados na [issue de entrega #1761](https://github.com/Faysk/tda/issues/1761). Este recibo não mistura os bytes da primeira publicação com os da correção.

## Rollback verificado sem retirar a entrega pública

Foi criado um clone local separado do Wiki e executado `git revert --no-edit 8ac0c7daa5099bf1b7da5b2febbd5ec131d3e01b`. A comparação da árvore resultante com `9cd4f21900c7dbb88f9b99f6b8912d9dc53bae2e` não apresentou diferenças. **O revert de ensaio não foi enviado**; o HEAD remoto permaneceu `8ac0c7daa5099bf1b7da5b2febbd5ec131d3e01b`.

Para rollback real, atualizar um clone, conferir alterações posteriores e reverter o commit identificado, seguindo o [runbook de publicação](../../tools/wiki/PUBLISH_RUNBOOK.md). Publicar o revert por push comum e repetir o readback/navegador. Não usar force push.

## Escopo preservado

Esta operação publicou somente a documentação na GitHub Wiki. Não disparou deploy Web/Preview/Production, migration, publicação de Companion, alteração de credenciais ou escrita em R2/Supabase. A atualização do README e deste recibo passa por PR documental própria, separada do commit Wiki.
