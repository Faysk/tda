# Lores independentes — publicação, liberdade visual e catálogo

> Status: arquitetura aprovada; decisão editorial, não comprovação de implementação
> Owner: narrative-memory / frontend / produto
> Última revisão: 2026-09-30

## Decisão

Cada página individual de lore em `/lore/<slug>` é uma experiência editorial independente. Pode ter composição, cores, tipografia, navegação, ilustrações, animação e linguagem próprias. Não é obrigada a reproduzir o Design System, header, footer ou template visual do site principal. Reutilização é uma opção, não uma condição para publicação.

A liberdade vale também para Pipipi. Seu desenho existente é um resultado editorial específico, não um molde obrigatório para D, Seika ou futuras lores. Propostas visuais continuam sendo apresentadas em imagem para avaliação, representando a identidade daquela lore.

Independência editorial não exige novo repositório, projeto Vercel, banco ou aplicação. A infraestrutura pode continuar compartilhada. CSS, scripts e efeitos próprios devem ficar isolados para não alterar outras páginas ou a administração.

A forma de entrega técnica agora possui uma decisão complementar: lores integradas ao app e microsites standalone são categorias diferentes de implementação, independentes de listagem, campanha e indexação. O padrão, inventário atual de D/Seika/Pipipi/Yllith e regras para novas standalone estão em [Arquitetura de entrega das lores](lore-delivery-architecture.md).

## Publicar não é listar nem vincular à campanha

São decisões separadas:

| Decisão | Significado |
| --- | --- |
| Publicação | A página pode ser aberta pela sua URL e compartilhada |
| Listagem | Inclusão editorial explícita no catálogo `/lore` |
| Vínculo narrativo | Pertencimento confirmado a uma campanha ou universo |

Criar uma rota ou subir seus arquivos não a inclui automaticamente no catálogo, no grafo ou no cânone da campanha principal. Não criar entity, relation ou campanha fictícia apenas para hospedar a página.

Estado editorial definido para o momento:

| Lore | Listagem em `/lore` | Vínculo campaign atual |
| --- | --- | --- |
| Pipipi | Preservar entrada existente | Não inferir novos vínculos desta decisão |
| Astel e Noah | Listar; inclusão explicitamente solicitada, preparada localmente | Ligações editoriais por slug de personagem, sem criar dados narrativos |
| D | Não listar; acesso pela URL própria | Não faz parte da campanha principal |
| Seika | Não listar; acesso pela URL própria | Não faz parte da campanha principal |
| Yllith | Não listar; acesso pela URL própria quando publicada | Não faz parte da campanha principal |
| Futuras lores independentes | Não listar automaticamente; inclusão exige escolha editorial | Não assumir vínculo |

`/lore` permanece um catálogo curado do site, sujeito ao seu Design System. As páginas individuais têm liberdade visual. A presença de um arquivo em uma pasta não é critério de inclusão no catálogo.

Não listado não significa privado: quem possui a URL pode acessá-la. Esta decisão não impõe autenticação nem `noindex`; políticas de mecanismos de busca e sitemap são escolhas separadas, não inferidas da ausência de um card em `/lore`. A política de indexação desejada para D, Seika, Yllith e futuras standalone externas está registrada separadamente na arquitetura de entrega.

## Contratos compartilhados que permanecem

- texto oficial e ordem narrativa aprovados, sem inventar fatos;
- título, descrição, canonical e imagem social próprios quando houver arte, mesmo sem listagem;
- mídia íntegra, proporção preservada e qualidade perceptível conforme [variantes e crops](../integrations/r2/variants-and-crops.md);
- leitura e navegação acessíveis, adaptação a telas menores e alternativa a movimento excessivo;
- carregamento com falhas compreensíveis, sem esconder a história porque uma imagem falhou;
- nenhuma exposição de segredos ou material privado;
- publicação validada separadamente da implementação.

Acessibilidade e integridade não prescrevem uma estética. Uma abertura cinematográfica pode fazer parte da narrativa; regras do hub administrativo não devem ser usadas para forçar todas as lores ao mesmo formato.

## Registro por lore e aceite

O documento dono de cada lore registra: slug/URL, fonte oficial, responsável, identidade visual/referência aprovada, vínculo narrativo conhecido ou ausente, decisão de listagem, assets/manifesto e evidência da publicação. São requisitos documentais; não introduzem schema ou nova plataforma nesta entrega.

- [ ] Página funciona por acesso direto, sem depender do catálogo ou da presença de uma campaign vinculada.
- [ ] Listagem corresponde à decisão editorial; D, Seika e Yllith ausentes do catálogo enquanto essa decisão permanecer.
- [ ] Identidade visual da própria lore foi avaliada.
- [ ] Imagens carregam, decodificam e preservam proporções e detalhes nas superfícies reais.
- [ ] Preview do link representa a página individual.
- [ ] Estilos e scripts não afetam outras rotas.

## Multi-campaign

A arquitetura multi-campaign agora é aprovada por ADR-0020, mas **lore standalone continua uma exceção editorial independente**:

- uma lore pode ter `campaign = null`;
- vínculo com campaign é metadata editorial explícita, não inferência pela URL, personagem ou artwork;
- `/lore/<slug>` permanece canonical próprio e não ganha campaign no path por obrigação;
- vincular uma lore não cria entity, relation, canon ou session;
- remover/alterar vínculo não move seus assets automaticamente;
- listagem em `/lore`, vínculo de campaign e indexação continuam decisões independentes.

A criação da campaign **Antes que seja tarde** não publica nem vincula D automaticamente. Esse vínculo pertence a #1131 e precisa de decisão editorial própria.

## Futuro fora do escopo

Multi-campaign não implica multi-jogo/multiuniverso completo, CMS genérico ou novo mecanismo de permissões para cada lore. Essas expansões continuam decisões separadas.

- [Arquitetura de entrega das lores](lore-delivery-architecture.md) — padrão `app` vs `standalone`, estado atual e evolução futura.
- [Do ZIP à produção](../operations/zip-to-production.md) — integrar a experiência aprovada e registrar adaptações.
