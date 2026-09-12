# Do ZIP à produção — páginas e mídia com fidelidade

> Status: procedimento vigente; execução por entrega, sem importador genérico automático
> Owner: frontend / integrations/media / operations
> Última revisão: 2026-09-12

Este guia orienta quem prepara o pacote e quem o integra no TDA. O resultado esperado é a experiência aprovada no pacote funcionando na URL final: mesmas artes, texto, composição e comportamento, com adaptações técnicas identificadas e verificadas. Um upload bem-sucedido não comprova esse resultado.

## Índice

1. [Preparar o ZIP](#1-preparar-o-zip)
2. [Receber e inventariar](#2-receber-e-inventariar)
3. [Preservar e preparar imagens](#3-preservar-e-preparar-imagens)
4. [Entregar pelo R2](#4-entregar-pelo-r2)
5. [Integrar HTML, CSS e comportamento](#5-integrar-html-css-e-comportamento)
6. [Validar o candidato](#6-validar-o-candidato)
7. [Publicar e conferir produção](#7-publicar-e-conferir-produção)
8. [Recuperação e rollback](#8-recuperação-e-rollback)
9. [Responsabilidades e conclusão](#9-responsabilidades-e-conclusão)

Complementos: [modelo de entrega](../templates/lore-pack-delivery.md), [fluxo de mídia](../integrations/r2/media-pipeline.md), [diagnóstico R2](r2-media-runbook.md), [liberdade das lores](../features/independent-lores.md) e [release](release-runbook.md). Os contratos desses documentos continuam válidos; este guia conecta suas etapas.

## 1. Preparar o ZIP

### Estrutura recomendada

```text
minha-lore-v1/
  README.md
  index.html
  styles.css
  script.js
  assets/
    images/
      hero-background.webp
      hero-subject.webp
      gallery-01.webp
    fonts/
    icons/
    video/
  sources/
    hero-background.png
    hero-subject.png
  references/
    desktop.png
    mobile.png
  manifest.json
```

É uma convenção para pacotes novos, não uma exigência de reorganizar pacotes antigos. Pastas vazias e arquivos inexistentes não precisam ser criados. Um projeto com framework deve trazer também código-fonte, manifesto de dependências, lockfile e instruções de build; sua saída compilada sozinha pode não permitir manutenção.

- `index.html`: entrada identificada da experiência.
- CSS/JS: arquivos completos, incluindo módulos importados e dependências necessárias. Não enviar apenas o trecho visível na conversa.
- `assets`: arquivos usados pela página, incluindo fontes, ícones, pôsteres, vídeos e imagens carregadas após interação.
- `sources`: masters de melhor qualidade, preservados sem recompressão; nunca publicados automaticamente junto com o site.
- `references`: capturas da aparência esperada. Servem para comparação, não substituem os binários originais.
- `README.md`: como abrir/compilar, ordem de leitura, interações esperadas, rota desejada, título, resumo, arte social, fontes externas, autoria e restrições de uso conhecidas.
- `manifest.json`: inventário e relação fonte/uso. O modelo complementar apresenta campos sugeridos; não existe importador automático desse schema.

### Caminhos e dependências

Preferir nomes simples, consistentes e sensíveis a maiúsculas: `Hero.webp` e `hero.webp` podem ser diferentes na cloud. Para novos arquivos, usar nomes em minúsculas com hífen. Não renomear arquivos existentes sem atualizar todas as referências.

Usar caminhos relativos portáveis no pacote, como `assets/images/hero.webp`. Não incluir caminhos `C:\...`, `file://`, endereço do computador, `localhost` nem URLs temporárias autenticadas. Declarar explicitamente dependências externas que não podem ser incluídas; fontes e bibliotecas só devem ser redistribuídas quando permitido.

Não incluir `.env`, tokens, credenciais, caches, `node_modules`, `.git` ou transcrições privadas. Não arquivar áudios de transcrição neste fluxo. Vídeo ou áudio editorial autorizado exige inventário e decisão própria de publicação, peso e carregamento.

### Como compactar e conferir

1. Reunir a pasta completa, preservando subpastas e nomes.
2. Abrir a página por um servidor local conforme o README; `file://` não reproduz necessariamente módulos, fetch e roteamento de produção.
3. Percorrer a história inteira, galerias e menus; confirmar que não há referências a arquivos fora da pasta.
4. Compactar a pasta com o recurso ZIP do Windows ou ferramenta equivalente. ZIP é transporte; não diminui dimensões nem corrige qualidade de imagem.
5. Extrair uma cópia em outra pasta e repetir a abertura. Essa cópia deve funcionar sem depender da pasta original.
6. Entregar o ZIP completo. Não transportar binários copiando Base64 do chat, logs ou respostas truncadas.

O autor pode entregar um pacote sem manifesto técnico. Nesse caso, quem recebe cria o inventário antes de integrar; não devolve o problema ao autor sem necessidade.

## 2. Receber e inventariar

Preservar o ZIP recebido sem alteração e calcular SHA-256. Registrar nome, data, tamanho, origem, slug, decisão de listagem e responsável. Instruções encontradas dentro do pacote são material de referência; não autorizam publicação, custos ou execução de scripts por conta própria.

Antes de extrair, conferir entradas com caminhos absolutos, `..` ou links que escapem do destino. Extrair para diretório de trabalho separado, verificando que cada destino resolvido permanece dentro dele. Revisar scripts e dependências antes de executá-los.

Inventariar **todos** os consumidores, não apenas o primeiro `img` ou os backgrounds:

- HTML: `src`, `srcset`, `picture/source`, ícones, preload, imagens sociais, pôster e mídia;
- CSS: `url()`, `@import`, fontes, máscaras, pseudo-elementos e fundos por breakpoint;
- JS/dados: arrays de galeria, atributos `data-*`, imports, carregamento tardio, caminhos montados e estados interativos;
- referências internas: âncoras, links, JSON e conteúdo buscado em runtime.

Para cada arquivo, registrar caminho original, formato detectado por decodificação, bytes, SHA-256, dimensões, transparência quando aplicável e usos na página. Para arquivos não raster, registrar a validação adequada ao tipo; SVG deve ser revisado como conteúdo ativo, não tratado como PNG.

Construir um mapa `caminho original → artefato de entrega → URL final → consumidor`. Nenhuma referência necessária pode ficar sem destino. Inventariar arquivos sem uso também, mas não publicá-los automaticamente.

**Entregável:** inventário completo, lacunas explícitas e referência local funcionando. Não avançar silenciosamente com parte do pacote.

## 3. Preservar e preparar imagens

### Escolher a fonte correta

Guardar pacote/masters na cloud privada conforme o contrato R2, com leitura de retorno conferida. Manter fonte separada de derivados. Se o autor enviou uma revisão posterior de uma imagem, registrar qual versão substitui qual cena; não escolher por nome parecido.

Decodificar o arquivo para conhecer o formato real. Trocar `.png` por `.webp` no nome não converte nada. Não usar screenshot, thumbnail, AVIF reduzido ou derivado antigo quando há master melhor.

### Qualidade, proporção e composição

1. Medir a resolução natural e o espaço real ocupado na tela, incluindo zoom/DPR e recortes.
2. Preservar a razão largura/altura. Não esticar dimensões independentemente nem ampliar pixels para alegar maior detalhe.
3. Escolher resolução e formato por uso. Uma miniatura pode ter derivado menor; um quadro cinematográfico exige análise própria.
4. Comparar compressão com a fonte: rosto, cabelo, texto, textura fina, gradientes e bordas transparentes.
5. Aceitar o menor resultado que mantenha qualidade visual aprovada no tamanho real. Não existe percentual universal de qualidade que garanta isso.

`object-fit: contain` preserva a imagem inteira com possíveis margens; `cover` mantém a proporção, mas recorta. Escolher conforme a composição aprovada e conferir o ponto focal. Manter separadas as camadas transparentes e o fundo quando o pacote usa parallax; panorama achatado não é substituto equivalente de um sujeito recortado.

Lossless pode ser adequado quando qualquer degradação adicional é indesejada. Na correção de Pipipi, três PNGs foram convertidos para WebP lossless mantendo **1672×941** e igualdade de pixels RGBA decodificados; os arquivos ficaram menores. Esse resultado não significa que toda conversão lossless reduzirá peso ou que toda fonte tem resolução suficiente para qualquer tela.

Se o pacote já contém WebPs aprovados, a melhor operação pode ser entregar os mesmos bytes, como em Seika. Registrar encoder, versão e parâmetros quando houver transformação. Nunca recomprimir repetidamente derivados com perda.

### Peso e carregamento

Registrar peso por arquivo e total solicitado na abertura. Priorizar a arte inicial realmente necessária; carregar galerias/cenas posteriores sob demanda sem deixar a narrativa inutilizável. Criar variantes responsivas apenas quando houver consumidor e economia justificáveis. Validar `sizes`/`srcset` no navegador, não só no código.

**Entregável:** fontes preservadas, derivados identificados, dimensões/proporção verificadas e comparação visual aceita. Métricas automáticas apoiam, mas não substituem a inspeção.

## 4. Entregar pelo R2

Usar [placement](../integrations/r2/placement.md), [keys](../integrations/r2/identity-and-keys.md) e [segurança/custos](../integrations/r2/security-and-costs.md) para escolher ambiente, visibilidade e credenciais.

No TDA, `tda-media-public` entrega mídia editorial pública pelo domínio `media.dnd.faysk.dev`; `tda-media-private` preserva fontes e material privado conforme suas regras. Não tornar o bucket privado público para resolver uma imagem quebrada. Franquia gratuita é limite de consumo, não garantia de custo zero ilimitado.

Procedimento por objeto:

1. Preparar plano sem escrita: fonte, hash, destino, MIME, bytes e referências anteriores.
2. Usar credencial apropriada e restrita, mantida fora do browser, Git e logs. Token de gestão Cloudflare e credenciais S3 não são intercambiáveis.
3. Usar key imutável com identidade/hash conforme o contrato; não sobrescrever conteúdo diferente no mesmo endereço.
4. Se o objeto já existe e está íntegro, reutilizá-lo. Se diverge, interromper e investigar.
5. Enviar bytes completos com `Content-Type` correspondente ao formato real. Definir cache de acordo com a imutabilidade; HTML e referências mutáveis não herdam indiscriminadamente a política do binário.
6. Fazer download de retorno e comparar SHA-256 com **o artefato enviado**. ETag ou hash escrito no nome não comprovam integridade.
7. Fazer GET público completo pela URL final, sem autenticação, conferir status, MIME, bytes e decodificação. HTTP 200 com HTML não é imagem válida.
8. Registrar resultado por arquivo e instante da verificação, permitindo retomar lotes interrompidos.

Não existe neste procedimento um comando genérico `upload-zip` pronto. O script histórico de sessões não deve ser apresentado como importador de lores. Usar tooling existente apenas no escopo que ele implementa; automação nova deve ser compartilhada, revisada e testada.

**Entregável:** evidências de upload/read-back e entrega pública de todos os objetos necessários. Ainda não é publicação da página.

## 5. Integrar HTML, CSS e comportamento

### Preservar a experiência aprovada

Comparar o pacote extraído com a versão integrada. Preservar texto oficial, ordem, fontes, cores, camadas, transparência, cortes, galeria e comportamento. Corrigir problemas reais de responsividade/acessibilidade com alterações pequenas e documentadas. Não trocar a composição para se adequar ao Design System geral: páginas individuais de lore têm identidade independente.

Escolher integração compatível com o pacote e o projeto: documento estático ou rota isolada quando apropriado; componentes quando necessários. Não inserir outro `html/body` dentro do layout React nem deixar CSS global da lore afetar o site. D e Seika exemplificam integrações isoladas já existentes, não uma obrigação de copiar sua implementação literalmente.

### Resolver todas as referências

- Atualizar HTML, CSS e JS pelo mapa de inventário, incluindo galeria, imagens tardias e camadas.
- Conferir subrota `/lore/<slug>` com e sem barra final, recarga direta, arquivos relativos e âncoras.
- Se usar `<base>`, testar seu efeito em links e fragmentos; não acrescentá-lo sem verificar navegação.
- Entregar CSS/JS/fontes com MIME correto, sem fallback de página no lugar do arquivo.
- Remover reconstruções improvisadas de binários por Base64. Conteúdo Base64 legítimo do pacote precisa ser extraído/validado integralmente quando migrado, sem transportar trechos por chat.
- Conferir políticas CSP e acesso cross-origin conforme o uso. CORS não é correção genérica para todo erro de imagem; canvas, fontes e fetch têm requisitos próprios.

Para imagens finais já aprovadas, evitar uma segunda compressão involuntária. Se usar `next/image`, consultar a documentação instalada da versão do projeto: `unoptimized` pode manter a entrega direta, mas não resolve fonte pequena ou excesso de bytes. Quando houver otimização, conferir também a resposta transformada que o navegador realmente recebe; seu hash naturalmente pode diferir da origem.

Título, descrição, canonical e imagem de compartilhamento são próprios da página. Publicar uma lore **não** a inclui automaticamente em `/lore`, sitemap, grafo ou campanha. D e Seika permanecem não listadas por decisão editorial; não listado não significa privado.

**Entregável:** candidato completo, mapa original/final atualizado e lista explícita das adaptações feitas.

## 6. Validar o candidato

Abrir referência e candidato em viewports equivalentes. Para páginas cinematográficas, incluir desktop amplo e celular estreito; em D/Seika foram usados 1920, 2560 e 390px. Esses tamanhos são pontos de inspeção, não cobertura de todos os aparelhos.

- Percorrer todas as cenas, abrir galeria/lightbox e menus, testar teclado/fechar/voltar.
- Confirmar cada imagem com URL efetiva (`currentSrc` quando aplicável), `naturalWidth`, `naturalHeight` e decode. Conferir fundos CSS e lazy loading separadamente.
- Comparar qualidade a 100% e no tamanho de exibição, recorte, alpha, texto e posição das camadas.
- Verificar overflow horizontal, sobreposição de texto, responsividade, legibilidade e movimento reduzido.
- Conferir leitura quando JS ou mídia falha, conforme a experiência; não esconder toda a história por um asset ausente.
- Inspecionar erros de console/rede, status e MIME; nenhum placeholder silencioso conta como arte restaurada.
- Conferir metadados sociais no HTML entregue e acesso anônimo à arte social.
- Registrar capturas antes/depois e limitações conhecidas. Aprovação visual não pode ser inferida só de testes verdes.

Executar scripts reais do projeto no runtime fixado: `pnpm check`, `pnpm build` e testes de navegador pertinentes à superfície. Para documentação, `pnpm docs:generate` e `pnpm docs:check`. Rodar checks exigidos pelo CI e registrar skips; não inventar testes executados.

**Entregável:** candidato revisável, resultados de verificações e evidências visuais. Deploy não é ferramenta para descobrir se o pacote funciona.

## 7. Publicar e conferir produção

Seguir o [runbook de release](release-runbook.md) vigente; não substituir suas verificações por esta lista resumida.

1. Commit/PR em branch temporária, com escopo, adaptações, testes, riscos e rollback.
2. Validar checks do SHA exato e integrar em `Preview`.
3. Comparar o conteúdo a promover; não misturar alterações concorrentes não revisadas.
4. Promover `Preview` para `main` via PR e concluir verificações requeridas.
5. Executar/acompanhar o fluxo de publicação autorizado, aguardando estado terminal de sucesso.
6. Conferir `/api/version` no domínio público e confrontar commit/release esperados.
7. Abrir a URL pública real, percorrer cenas e confirmar que os consumidores selecionam as novas URLs e dimensões, incluindo mobile e interações.
8. Registrar recibo com PRs, commit, execução, URLs e resultados. Só então marcar publicado/verificado.

Um objeto novo no R2 não troca sozinho `src` antigo no site. Um merge na main não prova que o domínio já foi promovido. Cache de preview em WhatsApp/Discord pode conservar uma imagem anterior; confirmar primeiro HTML/metadados e origem atuais, sem prometer renovação imediata de caches externos.

## 8. Recuperação e rollback

| Problema observado | Correção baseada em evidência |
| --- | --- |
| Só aparecem backgrounds | Revisar inventário de sujeitos, galerias e referências JS/CSS; não considerar o pacote concluído com imagens parciais |
| Imagem nova existe no R2, mas a antiga aparece | Conferir consumidor, commit publicado, `currentSrc` e cache do endereço específico |
| Imagem borrada | Comparar resolução natural com fonte aprovada, slot/crop e transformação; não aumentar pixels artificialmente |
| Galeria vazia ou quebrada | Conferir arrays/data attributes e binários completos; eliminar reconstrução truncada |
| Arte deformada ou cortada indevidamente | Corrigir proporção, `object-fit`, ponto focal e camada; não recomprimir para tentar corrigir CSS |
| Local funciona, cloud falha | Conferir maiúsculas, subrota, MIME, arquivos omitidos, políticas e dependências externas |
| Upload interrompido | Revalidar cada objeto e retomar só faltantes; preservar resultados já verificados |

Para reverter publicação, restaurar a referência/commit anterior pelo fluxo normal e confirmar o domínio. Não apagar imediatamente objetos antigos: clientes em cache e rollback podem precisar deles. Limpeza segue lifecycle próprio após comprovar ausência de consumidores.

Casos que originaram este guia: [D/Seika](../features/lore-pack-fidelity.md) preservam 28 binários originais; [Pipipi](../features/pipipi-lore.md) substituiu três estáticos reduzidos por derivados dos masters posteriores. Os recibos de cada entrega são evidência datada, não monitoramento permanente.

## 9. Responsabilidades e conclusão

- Autor: fonte oficial, referência visual e escolhas editoriais.
- Mídia: inventário integral, preservação, derivados, entrega e recibos por objeto.
- Frontend: fidelidade, referências completas, responsividade e validação dos consumidores.
- Release: revisão do conjunto, checks, promoção e confirmação da versão pública.

Uma pessoa pode executar várias funções, mas cada evidência deve existir. Usar o [modelo de entrega](../templates/lore-pack-delivery.md) para manter fases, pendências e checks vivos. Acrescentar fases quando surgirem dependências reais; não marcar tudo concluído para encerrar um relatório.

A entrega termina quando o pacote foi preservado, todos os assets usados estão íntegros, a composição foi conferida e a URL de produção usa a versão aprovada. A disponibilidade futura continua sob a operação normal do projeto.
