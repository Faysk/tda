# Mídia — fluxo único de preparação e entrega

> Status: arquitetura aprovada
> Owner: integrations/media + frontend + operations
> Última revisão: 2026-09-12

## Escopo e fonte de verdade

Este é o contrato de trabalho para qualquer frente que prepare, envie ou consuma imagens: sessões, lores, personagens, grafo e social. Define o comportamento exigido; não afirma que existe hoje uma ferramenta única ou uma tela de upload completa. Implementações existentes devem convergir para ele, sem criar um uploader por lore.

Ler também [placement](placement.md), [identidade e keys](identity-and-keys.md), [qualidade e proporções](variants-and-crops.md) e o [runbook operacional](../../operations/r2-media-runbook.md). A [liberdade visual das lores](../../features/independent-lores.md) permanece; o contrato de mídia não impõe template visual.

## Fluxo com gates

| Fase | Trabalho obrigatório | Evidência para avançar |
| --- | --- | --- |
| 1. Receber | Identificar fonte íntegra, identidade editorial, uso, ambiente e visibilidade | Master abre; provenance, SHA-256, MIME real, bytes e dimensões registrados |
| 2. Preservar | Guardar master autorizado no privado, com read-back; manter fonte durante a operação | Bytes recuperados iguais aos do master; nenhuma dependência exclusiva do PC para preservação |
| 3. Preparar | Derivar somente variantes necessárias a partir do master | Relação com master, dimensões, encoder/versão/parâmetros, bytes e hash de cada derivado |
| 4. Avaliar | Comparar com master e no enquadramento previsto | Qualidade perceptível e proporção aprovadas; limites conhecidos registrados |
| 5. Enviar | Usar destino do ambiente, key imutável e MIME correto | Upload concluído e read-back do objeto conferido contra o derivado exato |
| 6. Verificar entrega | Fazer GET da URL pública quando aplicável, sem autenticação, e decodificar | Status, MIME, bytes, hash, dimensões, URL final e horário corretos |
| 7. Integrar candidato | Atualizar registro de mídia e consumidor no candidato, preservando referência anterior | Navegador carrega a variante esperada; revisão desktop/mobile e social quando aplicável |
| 8. Promover | Publicar deliberadamente a referência validada e conferir o consumidor publicado | SHA/release e evidência final; rollback disponível |

Erro em qualquer gate interrompe a promoção daquele candidato. Um lote incompleto deve indicar itens com sucesso e falha; nunca apresentar sucesso geral nem deixar referência quebrada ativa. A publicação de parte de um lote exige escopo explícito e consumidores independentes validados.

## Integridade de ponta a ponta

- Transferir arquivos como bytes. Não copiar Base64 de respostas de chats ou logs; não usar screenshots como recuperação de master. Se a fonte está truncada, recuperar a fonte íntegra.
- Validar conteúdo e decode, não apenas extensão. Renomear PNG para WebP não converte imagem.
- Comparar o SHA-256 do read-back com o hash do **arquivo enviado**. Um derivado tem hash próprio; não se espera que seu hash seja igual ao do master.
- Hash no path, ETag ou cabeçalho declarado não substitui cálculo dos bytes. Um GET que retorna HTML, mesmo com status 200, falha.
- Se houver transformação intencional no caminho de entrega, verificar separadamente a integridade do objeto de origem e formato/dimensões/qualidade da saída transformada. Não exigir igualdade de hash entre dois artefatos diferentes nem declarar a saída intacta por copiar o hash da origem.
- Corrigir credencial inválida no ambiente autorizado sem imprimir valores. Não confundir token de gerenciamento Cloudflare com o par de credenciais S3 do R2.

## Qualidade e variantes

Preservar proporção e conteúdo por padrão. Corte é escolha editorial explícita, não correção automática para encaixar a arte. Não ampliar o raster para cumprir um teste de resolução. Aplicar os gates de [variantes e crops](variants-and-crops.md).

Não há tamanho, formato ou percentual de qualidade universal. Comparar candidatos com o master na escala de uso; considerar alpha, rostos, texto, gradientes, orientação e cor. Registrar economia absoluta e percentual de bytes sem tratá-la como prova de qualidade. Se não houver candidato menor com qualidade aceitável, manter uma versão adequada maior ou rever o uso.

O consumidor define tamanho do slot, crop intencional e densidades-alvo; a preparação produz apenas tamanhos úteis, limitados pela fonte. Configurar seleção responsiva coerente com esses slots, evitando baixar o maior arquivo em todas as telas ou aplicar uma segunda compressão lossy sem avaliação.

## Upload, endereço e registro

Usar uma implementação compartilhada de envio via API S3 do R2. Preparação pode rodar localmente; objetos publicados continuam disponíveis com o computador desligado. Não habilitar serviços pagos de transformação por conveniência.

Identificar conta/endpoint, bucket do ambiente, escopo da credencial e domínio antes de escrever. Produção pública usa o domínio configurado `media.dnd.faysk.dev`; domínio ativo não comprova a existência de cada key. Preview permanece isolado. Rascunhos privados não podem ser enviados a um bucket público para facilitar teste.

Conteúdo novo recebe key nova; reexecução só reutiliza um objeto após conferir identidade e integridade. Não sobrescrever silenciosamente, não apagar objetos como parte automática do upload e não inventar outro namespace por tarefa.

O registro de mídia contém identidade/role, master de origem, bucket/key, URL pública quando houver, formato/MIME, bytes, largura/altura, hash, variantes, visibilidade, datas de verificação e evidência. Aproveitar o registro/manifesto existente do consumidor; esta especificação não exige nova tabela nem migração de banco. Informações privadas ficam fora do manifesto público.

Consumidores usam o registro verificado; não montam URLs manualmente a partir do nome da personagem. Lores independentes usam stableId editorial sem inventar campanha ou entity UUID. Disponibilidade de asset não inclui a lore automaticamente no catálogo.

## Cache e acesso

Definir Content-Type e política de cache deliberadamente. Objetos imutáveis podem ter cache longo; alterações apontam para nova key. Registros de referência precisam de atualização coerente com a publicação. Não cachear uma resposta de falha como se fosse imagem válida.

Testar a URL usada pelo consumidor, inclusive redirects e proxies existentes. Preferir entrega pública direta quando não houver necessidade concreta de intermediação; documentar qualquer proxy/transformação, seu efeito no cache e custo. Não adicionar um proxy apenas para esconder um 404 da origem.

CORS é configurado conforme o consumidor: upload no browser e leitura de pixels em canvas exigem avaliação específica. Não usar configuração CORS ampla como solução para objeto ausente. Credenciais permanentes nunca chegam ao browser; upload futuro pelo Edit usa autorização server-side e acesso temporário restrito quando necessário.

## UX de upload no Edit — planejada

O usuário seleciona a imagem, vê prévia e acompanha recebimento, preparação e verificação. O sistema preenche o endereço e só apresenta “pronta para usar” após os gates correspondentes. Falha deve explicar o próximo passo e permitir repetir sem perder a imagem anterior.

Essa tela ainda precisa ser implementada/validada. Enquanto isso, a operação manual segue os mesmos gates e produz o mesmo tipo de evidência; não declarar automação pronta porque a documentação existe.

## Responsabilidades e entrega entre frentes

| Responsável | Entrega |
| --- | --- |
| Mídia / Balde | Masters, derivados, envio e relatório de integridade/disponibilidade por objeto |
| Infraestrutura | Credenciais com escopo mínimo, ambiente, domínio, cache e acompanhamento de franquia |
| Frontend de cada superfície | Uso do registro, proporção, variantes, fallback e verificação no navegador |
| Responsável editorial | Identidade, visibilidade, corte e comparação visual; sem inventar conteúdo |
| Integração/release | Consolidar evidências do candidato e confirmar publicação e rollback |

Cada frente documenta suas fases com checkboxes. Só marcar concluído quando houver evidência; dependência externa permanece nomeada. Não transferir para o próximo responsável uma URL planejada como se fosse publicada.

## Evidência mínima por entrega

- [ ] Fonte íntegra e destino/visibilidade confirmados.
- [ ] Master preservado e derivados rastreáveis.
- [ ] Bytes, MIME, SHA-256 e dimensões do enviado e do read-back conferidos.
- [ ] URL efetivamente consumida abre e decodifica; evidência datada.
- [ ] Desktop/mobile, densidade, proporção e crop avaliados no navegador.
- [ ] Comparação master/derivado e tamanho antes/depois registrados.
- [ ] Referência anterior preservada e rollback descrito.
- [ ] Commit/PR e estágio de entrega identificados; publicação não inferida de CI.

Uma evidência pode ser um relatório gerado anexado à entrega, sem segredos, com links a imagens comparativas. Não copiar inventários dinâmicos inteiros para este contrato. CI deve bloquear integridade/consumo inválidos; inspeção perceptiva continua necessária. Falhas conhecidas não devem ser mascaradas por testes ignorados ou apenas por aumento de timeout.

## Referências oficiais

- [R2: compatibilidade S3](https://developers.cloudflare.com/r2/api/s3/api/).
- [R2: domínio público e cache](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- [R2: custos e franquias](https://developers.cloudflare.com/r2/pricing/).

Consultar novamente ao mudar integração ou tomar decisão de custo. Franquia gratuita não significa limite automático de gasto.
