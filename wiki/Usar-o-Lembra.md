# 🖼️ Lembra — guardar e encontrar referências visuais

> **Para quem:** pessoas autenticadas que utilizam a galeria de referências visuais do TDA. **Objetivo:** salvar imagens de referência e reencontrá-las rapidamente.

## O que é?

O **Lembra** funciona como um mural ou biblioteca visual compartilhada. É útil para retratos, ambientes, itens e outras referências que normalmente se perderiam numa conversa. **Não** é a enciclopédia da campanha, não define canon e não é um cofre para segredos de mestre.

O contrato atual estabelece uma diferença importante: **pessoas autenticadas compartilham a biblioteca**. Não há isolamento real por campanha, mesmo quando um item possui uma classificação opcional de campanha.

## Primeiro acesso

1. Entre no TDA com uma conta autenticada.
2. Abra [Lembra](https://dnd.faysk.dev/lembra).
3. Explore a galeria e utilize busca, filtros ou ordenação quando disponíveis.
4. Abra uma imagem no viewer para conferir detalhes sem sair da galeria.
5. Marque como favorito se desejar: **favorito é preferência pessoal**, não altera o acesso aos dados.

## Guardar uma referência

~~~mermaid
flowchart LR
  A["Arrastar, colar ou selecionar arquivo"] --> B["Prévia"]
  B --> C["Nome e descrição"]
  C --> D["Validação de mídia"]
  D --> E["Guardar na galeria compartilhada"]
  E --> F["Buscar ou abrir no viewer"]
~~~

**Exemplo sintético:** você deseja registrar uma referência visual de uma floresta. Escolha uma imagem cujo uso seja autorizado, confira a prévia, escreva uma descrição curta e salve. Outro usuário autenticado poderá encontrá-la, conforme o contrato de compartilhamento.

### O que significa “Meus itens”?

Esse filtro organiza os resultados por autor, mas **não cria uma área privada**. Outras pessoas autenticadas continuam sujeitas à política compartilhada do Lembra, inclusive para edição e remoção dos itens, segundo a especificação vigente.

## Se algo falhar

| Sintoma | O que verificar |
| --- | --- |
| Não consigo abrir a galeria | Login/sessão e estado de disponibilidade do serviço |
| A imagem não abre corretamente | Integridade do arquivo, tipo de mídia e falha de entrega |
| Não encontro um item | Filtros, ordenação, termo pesquisado e alterações recentes |
| A imagem parece cortada | Compare a prévia e o viewer; o contrato preserva imagem inteira |
| Quero ocultar um segredo por campanha | **Não use Lembra para isso**: classificação não cria fronteira de autorização |

**Lembrete:** não coloque imagem privada ou pessoal numa biblioteca compartilhada assumindo que o nome do autor ou a campanha limitam sua visibilidade.

## Fontes verificadas

[Contrato do Lembra](https://github.com/Faysk/tda/blob/main/docs/features/lembra.md), [Validação e entrega de mídia](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-pipeline.md), [Autenticação](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md) e [Experiência e hierarquia visual](https://github.com/Faysk/tda/blob/main/docs/design-system/ux-hierarchy.md).

Continue: [Lores e biblioteca](https://github.com/Faysk/tda/wiki/Lores-e-Lembra) · [Como a mídia funciona](https://github.com/Faysk/tda/wiki/Midia-e-assets) · [Acesso e privacidade](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes)
