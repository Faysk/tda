# Fidelidade dos pacotes de D e Seika

> Status: publicado e verificado em 2026-09-12
> Owner: lores e mídia
> Última revisão: 2026-09-12

## Contrato visual

Os pacotes `D_character_site.zip` e `Seika_Antes_do_Inverno.zip` enviados pelo autor são a referência de HTML, CSS, texto, arte e composição. Estas páginas são documentos independentes: não herdam o shell nem os tokens do Design System da aplicação. D e Seika continuam fora do catálogo público de lores e da campanha principal.

Seika utiliza as 25 imagens WebP originais, incluindo fundos, sujeitos transparentes, referências e panoramas. Um panorama não substitui um sujeito recortado: cada posição mantém a imagem e as proporções previstas pelo pacote. D utiliza as três imagens PNG originais. Não há reconstrução de imagens por Base64 nem recompressão destrutiva neste reparo.

## Integração

- URLs absolutas e imutáveis no R2 público, com SHA-256 no caminho.
- Base de navegação explícita por lore para CSS, scripts e âncoras.
- Metadados de compartilhamento apontam para imagens reais de cada página.
- CSS e comportamento dos pacotes preservados; D recebe texto alternativo na ampliação e leitura disponível sem JavaScript.
- Ajuste responsivo restrito a Seika: em até 800px, o retrato completo fica abaixo do texto para impedir sobreposição; o botão de capítulos mantém contraste na abertura clara.
- A exceção do verificador de tokens é limitada ao stylesheet isolado de Seika; não libera tokens legados no restante da aplicação.

## Aceite e publicação

[Evidência dos 28 binários](../integrations/evidence/lore-pack-fidelity-2026-09-12.json): download público completo e SHA-256 iguais aos arquivos originais, sem alteração dos pixels pelo transporte.

- [x] Restaurar composições e mapear todas as referências de mídia.
- [x] Validar build, testes específicos (9 casos) e comparação visual em desktop e celular.
- [x] Integrar via Preview e main com verificações concluídas.
- [x] Confirmar páginas e arquivos na publicação de produção.

Rollback: reverter o commit de integração e republicar pelo fluxo normal. Os objetos originais no R2 permanecem disponíveis; não apagar mídia para reverter consumidores.

Recibo: PRs #223/#224, commit `ed9201c9911a600918ef742c9c212aa1d18315c8`, Production CD 34696663629 concluído com sucesso. Procedimento reutilizável: [ZIP à produção](../operations/zip-to-production.md).
