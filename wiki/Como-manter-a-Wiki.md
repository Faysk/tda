# ✍️ Como manter a Wiki atualizada

**Esta Wiki traduz os contratos do TDA para pessoas.** A autoridade técnica continua em **docs/**, no código e nas evidências de entrega. O repositório Git da aba Wiki é **separado** da main: uma PR contendo wiki/ não prova que a aba Wiki foi atualizada.

## Procedimento editorial

1. Leia a página da Wiki e o documento canônico apontado por ela.
2. Confira status/versão na main. Para dizer que algo está publicado, procure também evidência no ambiente real.
3. Proponha a mudança em branch/PR na fonte versionada wiki/; atualize o documento dono em docs/ se o contrato mudou.
4. Revise linguagem para iniciantes, exemplos, imagens, permissionamento e segurança.
5. Verifique Markdown, links, Mermaid e sidebar/índice em cada alteração.
6. Use **somente o mecanismo de sincronização controlada aprovado** para publicar no repositório da Wiki; respeite edições existentes e mantenha histórico para rollback.
7. Confira as páginas no navegador do GitHub após sincronizar, não apenas na PR.

## Escreva pensando em quem nunca viu o projeto

Uma página importante deve conter: **o que é → para quem → como usar → resultado → falhas comuns → detalhes avançados → fontes**. Explique ASR, RLS, RBAC, ADR e demais siglas no primeiro uso ou no [Glossário](https://github.com/Faysk/tda/wiki/Glossario). Diagramas e prints precisam de explicação textual, e screenshots não podem revelar material privado.

## Como distinguir estados

- **Current behavior:** comportamento implementado/vigente.
- **Legacy compatibility:** caminho preservado para interoperabilidade/recovery.
- **Historical implementation notes:** fatos históricos e candidatos datados.
- **Future backlog:** direção ainda não entregue.

Além disso, **validado**, **integrado à main** e **publicado/aplicado** não são sinônimos.

## Registar revisão humana sem inventar aprovações

Há um registro versionado em [editorial-reviews.json](https://github.com/Faysk/tda/blob/main/tools/wiki/editorial-reviews.json). Enquanto a página tiver `status: pending`, **ela não recebeu aprovação editorial registrada**. Isso não impede escrever, melhorar ou testar o artigo, mas bloqueia o comando de preparação para a publicação definitiva.

Uma pessoa que realmente revisou o texto pode:

1. Conferir a página e as fontes técnicas atuais: descrição, contratos vigentes, maturidade, permissões, exemplos e se não há dados privados.
2. Registrar numa issue ou comentário da PR **o que leu e o que validou**, com a página exata; uma simples reação não comprova a revisão.
3. Calcular o SHA-256 do arquivo Markdown exato e ajustar somente sua entrada no registro, indicando `status: approved`, seu nome de usuário no GitHub, a data de revisão, o hash e a URL de evidência.
4. Executar `pnpm wiki:editorial` e `pnpm wiki:test`. O teste rejeita uma suposta aprovação cujo arquivo mudou depois.
5. Se editar novamente um artigo aprovado, marque-o como `pending` até nova revisão ou atualize a aprovação **somente após a pessoa rever o novo conteúdo**.

No Git Bash/Linux, use `sha256sum wiki/NOME-DA-PAGINA.md`. No PowerShell, use `(Get-FileHash wiki/NOME-DA-PAGINA.md -Algorithm SHA256).Hash.ToLowerInvariant()`. Não assine uma aprovação por outra pessoa ou copie uma data sem confirmação.

**Atenção:** o registro identifica evidência informada, mas um script não autentica a identidade do revisor. A publicação real requer também `node tools/wiki/editorial-gate.mjs --require-approved`, a reconciliação do Git Wiki e o teste visual posterior de navegação, Mermaid, imagens e acessibilidade.

## Checklist de revisão

- [ ] Página atende a uma necessidade real de leitura.
- [ ] Há fonte canônica vinculada e status correto.
- [ ] Todos os links, âncoras e diagramas são válidos.
- [ ] O conteúdo é legível no tema claro/escuro e mobile do GitHub.
- [ ] Imagens têm alt, legenda/origem e não contêm dados privados.
- [ ] A página está na _Sidebar.md e no Indice.md.
- [ ] Nenhum segredo, log sensível, transcrição privada ou credencial foi incluído.
- [ ] Publicação e rollback da Wiki têm registro separado da publicação do TDA Web.

**Referências:** [Documentação viva](https://github.com/Faysk/tda/blob/main/docs/documentation/README.md) · [Issues](https://github.com/Faysk/tda/blob/main/docs/delivery/issue-governance.md) · [Epic #1745](https://github.com/Faysk/tda/issues/1745)

[Início da Wiki](https://github.com/Faysk/tda/wiki/Home) · [Índice](https://github.com/Faysk/tda/wiki/Indice)


## Testar se alguém aprendeu sem ajuda

A revisão editorial inclui [um roteiro público de aceite por persona](https://github.com/Faysk/tda/blob/main/tools/wiki/REVIEW_CHECKLIST.md): visitante, jogador, editor, operador e contribuidor. **Antes de publicar**, uma pessoa deve aprovar as fontes e o conteúdo na PR (Fase A). **Depois do push**, os tutoriais devem ser testados no GitHub Wiki real, em desktop/mobile e com teclado (Fase B). Problema nessa segunda fase impede considerar a publicação concluída e pode exigir rollback. **Markdown válido não é aprovação humana nem aceite visual**.
