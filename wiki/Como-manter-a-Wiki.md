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

A revisão editorial inclui [um roteiro público de aceite por persona](https://github.com/Faysk/tda/blob/main/tools/wiki/REVIEW_CHECKLIST.md): visitante, jogador, editor, operador e contribuidor. Antes de publicar, devem ser verificados os tutoriais no GitHub Wiki real, em desktop/mobile e com navegação por teclado. **Sem isso, Markdown válido não equivale a Wiki aprovada**.
