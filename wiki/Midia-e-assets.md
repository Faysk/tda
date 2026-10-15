# 🖼️ Mídia, imagens e assets

**Para quem:** autores de conteúdo, desenvolvedores e pessoas curiosas sobre imagens que aparecem no TDA.

## Por que não basta enviar um PNG?

Uma imagem usada numa lore, capa de sessão ou perfil precisa ter **origem conhecida**, qualidade preservada, destino apropriado, integridade conferida e publicação autorizada. O TDA separa o **arquivo master** das variantes para telas e do vínculo editorial ao conteúdo.

O provedor atual de Media Storage é o **Cloudflare R2**, mas o contrato evita transformar o nome do provedor na identidade da mídia.

~~~mermaid
flowchart LR
  A["Master autorizado"] --> B["Verificar bytes, MIME e origem"]
  B --> C["Preservar master"]
  C --> D["Criar variantes necessárias"]
  D --> E["Upload com key imutável"]
  E --> F["Read-back e integridade"]
  F --> G["Revisão editorial e integração"]
  G --> H["Publicação controlada"]
  H --> I["Consumo no TDA"]
~~~

Esse é o **fluxo exigido pelo contrato**, não uma afirmação de que exista uma ferramenta única que automatiza todos os passos.

## O que se verifica?

| Conceito | O que significa |
| --- | --- |
| **SHA-256** | Identificador calculado dos bytes; serve para conferir integridade |
| **MIME real** | Tipo do arquivo detectado pelo conteúdo, não apenas pela extensão |
| **Decode** | Confirma que uma imagem ou áudio realmente abre |
| **Read-back** | Ler novamente os bytes do armazenamento para conferir upload |
| **Master** | Fonte aprovada que não deve ser perdida |
| **Variante** | Derivado com tamanho/formato próprios e seu **próprio** hash |
| **Audience** | Quem está autorizado a acessar o asset |

O hash de uma variante não precisa ser igual ao do master. Resposta HTTP 200 com HTML em vez de imagem não comprova entrega de mídia. Renomear um arquivo PNG para WebP não o converte.

## Dicas de quem escreve histórias

- Use imagens cujo uso é permitido e cuja origem é conhecida.
- Evite distorcer proporções, recortar arte importante ou ampliar artificialmente para passar num teste.
- Prefira texto alternativo que explique o conteúdo da imagem.
- Para páginas de lore, respeite a direção visual da obra; o pipeline não obriga todas a usarem o mesmo layout.
- Se uma imagem falhar, não substitua por um arquivo semelhante sem verificar hash, versão e aprovação.

## E a marca oficial do TDA?

O d20 com pato possui **masters oficiais** e checksums próprios. Quem cria esta Wiki deve reutilizar uma URL canônica de marca **somente após validá-la**; não recriar um pato “parecido” nem usar caminhos antigos de `public/brand/`.

## Fontes canônicas

- [Fluxo de mídia](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-pipeline.md)
- [Identidade e chaves](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/identity-and-keys.md)
- [Formatos e proporções](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/variants-and-crops.md)
- [Contrato de acesso](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-access-contract.md)
- [Brand Pack oficial](https://github.com/Faysk/tda/blob/main/docs/design-system/official-assets.md)

Continue: [Histórias e galeria](https://github.com/Faysk/tda/wiki/Lores-e-Lembra) · [Design System](https://github.com/Faysk/tda/wiki/Design-System) · [Privacidade](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes).
