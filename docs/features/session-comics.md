# HQ nas sessões — contrato e implementação faseada (#1765)

> Status: **em desenvolvimento**. Este documento descreve a direção aprovada e o que ainda falta implementar; nenhum upload, publicação ou leitor de HQ deve ser anunciado como funcional antes dos respetivos gates.
>
> Referências: #787, #791, #792, #793, #1086, #1125, #1345, #1765.

## Decisão de produto

O usuário já possui as **imagens finais** da HQ. O TDA será o lugar de **organização e publicação** dessas imagens, não de criação por IA nesta fase.

A HQ é uma **segunda leitura da mesma sessão publicada**. O resumo Markdown permanece intocado e continua sendo a leitura padrão. Sessões sem HQ não recebem alternância vazia.

A gestão editorial pertence ao **mesmo workspace privado** de \`/edit/sessoes/[id]\`: idealmente uma nova aba **HQ** junto de **Sessão** e **Resumo / Preview**, com permissão de edição e ações de salvar/publicar coerentes com as existentes. Não criar um painel externo ou solicitar alterações diretas no GitHub.

## Contrato de páginas: primeira parte implementada

\`src/features/edit/sessions/session-comic-model.ts\` contém um contrato puro, sem acesso a dados:

- \`SessionComicDraftPage\`: \`assetId\` (UUID opaco), \`altText\`, \`caption\`. A posição no array determina a ordem. O draft **não guarda URLs públicas**.
- \`SessionComicPublishedPage\`: \`imageUrl\`, \`altText\`, \`caption\`. Somente URLs de objetos HQ imutáveis no namespace de **campanha técnica + session UUID** são admitidas no leitor público.
- Validadores rejeitam identidades inválidas, páginas duplicadas, campos inesperados, conteúdo inválido e URLs de outras campanhas/sessões. Para publicar páginas, cada imagem precisa de descrição acessível.
- Limites iniciais para validação de metadados (150 páginas por sessão, 500 caracteres de alt, 1000 de legenda) são guardrails de contrato, sujeitos à validação de produto e performance antes do lançamento.
- Array vazio é válido: HQ **opcional**, texto preservado.

**Importante:** este modelo **não autoriza** um asset por si só. O servidor deve verificar que \`media_assets.id\` é um objeto realmente validado, está ligado à session UUID e pertence à mesma campaign ID. A validação pública é defesa adicional e não substitui promoção/autorização.

## Implementação seguinte (não concluída)

### 1. Upload privado

- Adaptar o pipeline R2 de capas como padrão, mas não reutilizar \`role_hint=session_cover\` nem \`/cover/\` para páginas de HQ.
- Propor \`role_hint=session_comic_page\`, uploads \`/comic/\` e preview autorizado, com chunks, hash, MIME real, dimensões, read-back e verificação de bucket, conforme pipeline governado já existente.
- Confirmar necessidade de JPG/JPEG além de PNG/WebP, considerando **o formato real das imagens que serão anexadas**. Não aceitar extensões ou MIME por confiança no browser.
- Considerar grandes lotes: fila limitada, progresso por ficheiro, falhas recuperáveis e nenhuma mutação de publicação durante upload.
- Não apagar objeto de uma publicação antiga quando o editor o retirar de um draft.

### 2. Persistência versionada

O domínio atual possui \`session_editorial_drafts\`, \`session_publications\`, \`session_publication_operations\` e RPCs atómicas:

- \`save_session_editorial_draft_with_date_atomic\`;
- \`publish_session_editorial_with_date_atomic\`.

**Não** adicionar páginas ao site público escrevendo diretamente na tabela \`sessions\`, em \`metadata\` sem contrato ou em JSON isolado fora do mecanismo de publicação.

Evoluir a estrutura de draft/publicação com uma migration revista, páginas ordenadas por posição e vínculo a \`campaign_id\`, \`session_id\`, \`draft_id\`/ \`publication_id\`. Preservar CAS, revision, idempotência por \`operation_id\`, \`payload_sha256\`, rollback e auditoria existentes. Cuidado com wrappers de data que recalculam o hash. Salvar metadados e ordem num único commit de draft e publicar snapshot da mesma revisão.

O movimento de sessão entre campanhas (migrações de outubro) também precisa contemplar o namespace de mídia HQ, sem deixar imagens sob a campanha errada.

### 3. UX do editor

- Selecionar múltiplos arquivos já prontos, acompanhar upload e organizar página a página.
- Exibir miniaturas; mover para cima/baixo por teclado e oferecer arrastar quando viável; alterar alt/legenda e remover páginas do **draft**.
- Preview fiel à ordem e estado persistido; sinalizar dirty e conflitos; salvar rascunho; publicar com confirmação explícita.
- Editores sem permissão não alteram a HQ. Validar o mesmo fluxo no mobile.
- Uma imagem pode estar no storage privado e não aparecer publicamente até uma publicação autorizada.

### 4. Leitor público e APIs

- Exibir **Texto | HQ** apenas quando o snapshot ativo possuir páginas publicadas.
- Renderizar sequência responsiva, alt/legenda e carregamento progressivo; evitar baixar todas as imagens de uma vez.
- Metadados de sessão, capa, compartilhamento e anterior/próxima não mudam. Índice de headings é exclusivo da leitura em texto.
- O arquivo público não passa a consultar transcrição, \`media_assets\` privada ou fontes de processamento.
- Estender contrato de detalhe publicado sem quebrar consumidores legados nem expor páginas de draft.
- Garantir fallback seguro para campanhas private/archived e ausência ou indisponibilidade de dados.

## Gates antes de considerar concluído

1. Migration/rollback, ACL e operações atómicas revistos.
2. Testes de isolamento por campaign/session e de autorização de cada mídia.
3. Testes de upload inválido, bytes reais, concorrência, falha parcial e re-publicação.
4. Testes de compatibilidade: sessões sem HQ, URLs legadas e APIs públicas existentes.
5. Verificação mobile, teclado, alt text e imagens grandes.
6. CI, preview, review e **aprovação explícita** antes de merge e deploy.

O MVP é **upload e leitura de imagens existentes**, não geração por IA ou edição de balões.
