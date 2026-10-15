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
