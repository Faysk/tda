# Lembra — biblioteca compartilhada de referências visuais

> Status: UX v3 em implementação; persistência rastreada em #476
> Owner: narrative-memory / frontend / integrations-media / identity-access
> Última revisão: 2026-09-21
> Fonte de verdade: este contrato, `docs/design-system/`, `docs/architecture.md` e o boundary de Media Storage

## Objetivo

O **Lembra** é uma superfície compartilhada para guardar e reencontrar referências visuais usadas pela mesa: imagens de personagens, lugares, cenas, objetos, atmosferas e ideias que hoje costumam se perder em Discord, WhatsApp ou outras conversas.

A rota canônica da experiência é:

```text
/lembra
```

O princípio de produto é deliberadamente simples:

> guardar uma referência deve levar menos de 10 segundos; reencontrá-la deve levar menos de 5.

O Lembra não é uma wiki, não é um catálogo de canon e não é um DAM genérico. É uma galeria rápida, compartilhada e visual.

## Estado de entrega desta candidata

A UI já passou pela primeira validação em Production e a segunda fatia simplifica a superfície para priorizar ainda mais a galeria:

- galeria responsiva;
- busca local combinável por nome, descrição, autor e data;
- filtro explícito por período;
- filtros locais `Lembra / Meus itens / Favoritos`;
- ordenação por mais recentes, mais antigas, nome ou autor;
- viewer/lightbox de referência para uso rápido durante a call, com navegação por teclado;
- ingestão por drag-and-drop em qualquer ponto da página;
- paste de imagem pelo clipboard;
- seletor nativo de arquivo;
- composer mínimo de nome + descrição;
- autor/data apresentados como metadata;
- preview local no browser.

A UI atual **ainda não persiste dados nem mídia**; os itens criados no protótipo desaparecem ao recarregar a página. A persistência real agora está rastreada em [#476](https://github.com/Faysk/tda/issues/476), com campaign isolation, capability server-side e Media Storage como gates explícitos.

## Princípios de UX

### Conteúdo primeiro

A página deve começar a entregar sua função imediatamente. **Não existe título/hero visível na workspace**: a busca, o filtro de data e a ação de adicionar ocupam a primeira faixa útil; em seguida começa a galeria. Um `h1` continua presente apenas para acessibilidade.

Evitar hero ornamental, dashboards, painéis técnicos ou arte de fundo adicionada apenas para preencher espaço.

### Publicação sem fricção

As três entradas devem convergir para o mesmo pipeline de browser:

```text
drag & drop ─┐
paste ───────┼─> File -> validação -> preview -> nome/descrição -> guardar
file picker ─┘
```

Arrastar um arquivo sobre a janela transforma a viewport numa drop target clara, sem exigir acertar uma caixa pequena.

Quando uma imagem entra, pedir somente:

- **Nome** — obrigatório;
- **Descrição** — opcional.

Na implementação persistente:

- `Publicado por` vem da identidade autenticada e não é um campo editável;
- `Data` vem do servidor e não é um campo editável.

### Informação do card

Cada referência mostra somente o necessário para reconhecimento:

```text
imagem
nome
descrição
autor · data
```

Controles secundários devem permanecer discretos. Clicar na imagem ou no nome abre um viewer dedicado sem sair da galeria.

### Busca

A busca textual procura em:

- nome;
- descrição;
- autor;
- data de publicação em formatos humanos e ISO.

Os termos são combináveis: uma consulta como `thom ruínas setembro 2026` pode casar partes vindas de campos diferentes do mesmo item. O filtro por período é aplicado em conjunto com a busca textual.

Busca semântica, embeddings ou classificação automática não pertencem a esta fatia.

### Viewer para uso em call

A galeria é o índice; o viewer é a superfície de consulta. Ele abre em modal amplo, preserva a imagem inteira com `object-fit: contain`, mantém nome/descrição/autor/data legíveis e permite navegar entre os resultados filtrados com `←` e `→`, fechando com `Esc`. Isso evita abrir novas páginas ou perder o contexto da busca durante uma call.

## Design System

O Lembra usa exclusivamente o Design System do TDA:

- tokens `--ds-*`;
- tipografia editorial para títulos/conteúdo narrativo;
- fonte de UI para busca, controles e metadata;
- dourado apenas como acento;
- primitives compartilhadas quando já existirem;
- CSS Modules para composição da feature;
- nenhum micro-design-system próprio.

O layout é uma superfície de exploração e pode usar a largura disponível até `--ds-layout-max`.

## Responsividade

Responsividade não significa reduzir a tela desktop e empilhar tudo.

A galeria deve adaptar automaticamente a quantidade de colunas ao espaço disponível usando grid fluido, sem depender de uma matriz rígida de devices.

### Desktop amplo

- sidebar contextual persistente;
- toolbar compacta de busca/data/ordenação/adicionar e galeria ocupam o restante;
- mais colunas aparecem conforme o viewport cresce;
- cards não devem virar outdoors gigantes apenas porque há espaço.

### Tablet

- composição pode reduzir/remover a sidebar;
- filtros permanecem acessíveis em uma barra compacta;
- galeria continua priorizando imagem.

### Mobile

- uma coluna quando necessário;
- navegação contextual compacta;
- ação de adicionar acessível por touch;
- drag-and-drop deixa de ser requisito de descoberta;
- file picker e paste continuam equivalentes;
- sem scroll horizontal.

Viewport mínimo de aceite: **320px**.

## Acessibilidade

A implementação deve manter:

- heading hierarchy correta;
- labels reais em inputs;
- foco visível;
- ações principais com alvo mínimo próximo de 44px;
- operação por teclado;
- `Escape` para fechar composer/overlay;
- dialog semanticamente modal;
- nenhum dado essencial dependente de hover;
- reduced motion respeitado;
- mensagens de erro legíveis.

Imagem de referência recebe nome acessível derivado do título enquanto não houver campo de alt editorial separado.

## Modelo de dados proposto

O contrato físico **ainda não está aprovado**. A direção é separar bytes de metadata.

Metadata mínima candidata:

```text
reference
- id
- campaign_id
- title
- description
- media_asset_id
- created_by
- created_at
- updated_at
```

Regras:

- bytes de imagem pertencem ao Media Storage;
- banco guarda identidade/relação/metadata;
- não armazenar imagem base64 em PostgreSQL;
- não versionar nova mídia no Git;
- autoria deve apontar para identidade do TDA, não copiar nome livre;
- timestamps persistentes são server-owned.

Nome final de tabela, FK de campanha, capability e lifecycle de deleção ainda precisam ser fechados antes de migration.

## Media Storage

A arquitetura permanente é provider-neutral e segue o boundary de Media Storage; Cloudflare R2 é somente o provider atual.

A implementação persistente deve prever:

```text
browser
 -> autorização server-side
 -> upload/finalização
 -> read-back/integridade
 -> referência de mídia
 -> metadata do Lembra
```

Não introduzir bucket ou publisher paralelo exclusivo do Lembra sem necessidade comprovada.

## Autorização e audiência

Destino de produto: superfície compartilhada por membros autorizados da campanha.

A capability final ainda não está definida. Até ela existir:

- a UI candidata não deve inventar role;
- nenhum endpoint de write deve ser aberto;
- não usar service role no browser;
- não criar policy genérica para simplificar upload;
- campaign/scope devem ser validados server-side quando a persistência entrar.

## Relação com canon

Uma referência do Lembra **não é canon**.

Guardar uma imagem não cria:

- `entity`;
- `canon_entry`;
- `canon_candidate`;
- fato narrativo;
- relação factual.

Uma futura ligação entre referência e entity deve continuar sendo apenas referência visual, salvo fluxo editorial explícito separado.

## Failure modes

A experiência deve tratar pelo menos:

- clipboard sem imagem;
- arquivo que não seja imagem;
- preview que falha;
- upload futuro interrompido;
- write de metadata futuro falhando depois do upload;
- usuário sem autorização;
- item removido enquanto outro usuário o visualiza;
- busca sem resultados.

Na candidata local, erro de arquivo inválido é mostrado sem navegar nem perder a galeria.

## Critérios de aceite — primeira fatia de UI

- [ ] `/lembra` usa o shell e tokens oficiais do TDA;
- [ ] não introduz nova biblioteca visual;
- [ ] página funciona a partir de 320px sem overflow horizontal;
- [ ] quantidade de colunas cresce com a largura disponível;
- [ ] busca foca por `Ctrl/Cmd + K`;
- [ ] busca aceita combinação de título/descrição/autor/data;
- [ ] filtro `De/Até` é inclusivo e pode ser limpo sem alterar a galeria;
- [ ] ordenação funciona por recente/antiga/nome/autor sem mutar a coleção fonte;
- [ ] imagem e título do card abrem viewer sem navegar para outra página;
- [ ] viewer preserva a imagem inteira, exibe metadata e navega por `←`/`→`;
- [ ] `Esc` fecha viewer e composer;
- [ ] arrastar uma imagem sobre a janela mostra drop overlay;
- [ ] soltar uma imagem abre o composer;
- [ ] colar uma imagem abre o mesmo composer;
- [ ] file picker abre o mesmo composer;
- [ ] composer pede somente nome e descrição;
- [ ] autor/data não são campos editáveis;
- [ ] salvar adiciona a referência ao estado local da galeria;
- [ ] recarregar a página deixa claro, pelo contrato, que esta fatia não é persistente;
- [ ] teclado, foco e Escape funcionam;
- [ ] light/dark/system continuam sendo responsabilidade do tema global;
- [ ] nenhuma mídia nova é adicionada ao Git;
- [ ] nenhuma migration, grant, policy ou write remoto é criado nesta fatia.

## Não objetivos desta fatia

- tags/categorias;
- pastas/boards;
- status canon/reference/idea/maybe;
- comentários;
- likes;
- feed social;
- classificação por IA;
- busca semântica;
- Discord bot;
- upload em lote;
- edição/deleção persistente;
- schema remoto;
- integração R2 real.

Esses itens só entram depois de fricção observada ou necessidade concreta.

## Próximos passos

Depois de validar a UI com uso real:

1. executar #476: fechar audiência e capability;
2. definir schema mínimo;
3. definir boundary server-side de create/list/delete;
4. reutilizar Media Storage/R2 com read-back e integridade;
5. implementar persistência;
6. cobrir autorização positiva/negativa e cross-campaign;
7. adicionar paginação/loading/error reais;
8. somente então considerar organização adicional.

## Referências

- [Arquitetura](../architecture.md)
- [Design System](../design-system/README.md)
- [Diretriz de UX e hierarquia](../design-system/ux-hierarchy.md)
- [Identidade e autorização](../domains/identity-access.md)
- [Media Storage / R2](../integrations/r2.md)
- [Fluxo de mídia](../integrations/r2/media-pipeline.md)
