# 📜 Lore — obra publicada, catálogo e vínculo de campanha

> **Para quem:** visitantes e autores editoriais. **Objetivo:** explicar como uma história independente aparece no TDA, sem confundir publicação técnica e verdade narrativa.

## Toda lore pertence a uma campanha?

**Não necessariamente.** Uma lore é uma experiência editorial que pode ter composição, fontes, imagens, animação e linguagem visual próprias. A experiência **Pipipi** não obriga outras lores a copiarem seu desenho.

No TDA, quatro decisões são independentes:

| Decisão | Pergunta |
| --- | --- |
| **Entrega** | É uma página integrada ao aplicativo ou uma experiência standalone? |
| **Publicação** | A página pode ser aberta por URL? |
| **Listagem** | A obra aparece no catálogo público de lores? |
| **Vínculo / indexação** | Pertence a uma campanha? Pode ser descoberta por mecanismos de busca? |

**Uma URL que abre não significa que a obra está listada.** Uma lore fora do catálogo também não é automaticamente privada: pessoas que possuem o link podem conseguir abri-la.

## Fluxo editorial de uma lore

~~~mermaid
flowchart TD
  A["Ideia e conteúdo editorial"] --> B["Decidir app ou standalone"]
  B --> C["Criar experiência visual"]
  C --> D["Revisar acessibilidade, mídia e origem"]
  D --> E["Publicar por release controlada"]
  E --> F{"Incluir no catálogo?"}
  F -->|Sim| G["Entrada editorial curada"]
  F -->|Não| H["Página disponível apenas por URL"]
  G --> I{"Vínculo narrativo confirmado?"}
  H --> I
  I -->|Sim| J["Associar campanha/universo"]
  I -->|Não| K["Manter independente"]
~~~

O fluxograma é **conceitual**: ele resume decisões, não implica um painel único que execute todos os passos automaticamente.

## Como explorar lores já disponíveis

1. Abra [Lore](https://dnd.faysk.dev/lore).
2. Escolha uma obra que esteja visível no catálogo.
3. Leia no modo e no estilo da própria narrativa. Algumas experiências podem oferecer **modo cinemático** e **modo leitura**.
4. Não pressuponha que os acontecimentos ou personagens da obra estejam registados automaticamente em `entities` ou `canon_entries`.

## Ao criar uma nova

- Prefira reutilizar infraestrutura do TDA sem criar banco ou host novo.
- Trate backgrounds, retratos e demais binários editoriais pelo pipeline de mídia aprovado.
- Registre separadamente entrega, listagem, vínculo e indexação.
- Use apenas conteúdo autorizado e evite inferir relações de campanha.
- Para histórias standalone, preserve identidade artística sem vazar estilos para o restante do site.
- Publicação de lore não aprova automaticamente um candidato a canon.

## Onde aprofundar

[Lores independentes](https://github.com/Faysk/tda/blob/main/docs/features/independent-lores.md), [Entrega e catálogo](https://github.com/Faysk/tda/blob/main/docs/features/lore-delivery-architecture.md), [Design System](https://github.com/Faysk/tda/blob/main/docs/design-system/README.md) e [Pipeline de mídia](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-pipeline.md).

Continue: [Lores e Lembra](https://github.com/Faysk/tda/wiki/Lores-e-Lembra) · [Mídia e assets](https://github.com/Faysk/tda/wiki/Midia-e-assets) · [Canon e entidades](https://github.com/Faysk/tda/wiki/Mundo-e-entidades)
