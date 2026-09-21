# Lembra — biblioteca compartilhada de referências visuais

> Status: UX v3 aprovada; persistência compartilhada em implementação na #476
> Owner: frontend / integrations-media / identity-access
> Última revisão: 2026-09-21
> Fonte de verdade: este contrato, `docs/design-system/`, `docs/architecture.md` e o boundary de Media Storage

## Objetivo

O **Lembra** é uma superfície simples e compartilhada para guardar e reencontrar referências visuais que normalmente se perdem em Discord, WhatsApp ou outras conversas.

A rota canônica é:

```text
/lembra
```

A régua de produto continua deliberadamente simples:

> guardar uma referência deve levar menos de 10 segundos; reencontrá-la deve levar menos de 5.

O Lembra não é wiki, catálogo de canon, DAM, sistema de permissões ou rede social. É uma galeria compartilhada.

## Regra central de acesso

O produto não possui autorização fina própria.

```text
usuário autenticado no TDA
  -> vê tudo
  -> publica
  -> edita qualquer referência
  -> remove qualquer referência
  -> favorita para si
```

Usuário não autenticado não acessa a biblioteca quando a persistência estiver ativada.

Consequências:

- não existe isolamento por campanha;
- não existe separação de leitura/escrita por role;
- não existe “dono” como boundary de permissão;
- autoria é contexto histórico e critério de busca;
- `Meus itens` é apenas um filtro por autor;
- `Favoritos` é preferência pessoal e não altera o conteúdo compartilhado.

A segurança permanece invisível: sessão autenticada, validação server-side, segredos fora do browser e validação real dos bytes de mídia.

## UX vigente

A workspace prioriza conteúdo:

- nenhum título/hero visual grande;
- busca e controles aparecem na primeira faixa útil;
- galeria começa imediatamente depois;
- toolbar permanece disponível durante navegação;
- grid cresce e reduz colunas conforme o espaço real;
- sidebar some em viewports menores;
- viewer amplo abre sem navegar para outra página.

### Entrada de mídia

Drag/drop, paste e seletor nativo convergem para o mesmo fluxo:

```text
drag & drop ─┐
paste ───────┼─> File -> preview -> nome/descrição -> guardar
file picker ─┘
```

O composer pede somente:

- **Nome** — obrigatório;
- **Descrição** — opcional.

Autor e data são automáticos.

### Busca e filtros

A busca textual combina termos encontrados em:

- nome;
- descrição;
- autor;
- data de publicação.

Exemplo:

```text
thom ruínas setembro 2026
```

pode combinar autor + título/descrição + data no mesmo item.

Também existem:

- filtro inclusivo `De / Até`;
- ordenação por mais recentes;
- mais antigas;
- nome;
- autor;
- `Meus itens`;
- `Favoritos`.

### Viewer

Clicar na imagem ou no título abre um viewer amplo com:

- imagem inteira usando `object-fit: contain`;
- nome;
- descrição;
- autor;
- data;
- favorito;
- edição;
- remoção;
- navegação por `←` / `→`;
- fechamento por `Esc`.

Edição e remoção são permitidas para qualquer usuário autenticado, por desenho do produto.

## Design System e responsividade

O Lembra usa somente o Design System do TDA:

- tokens `--ds-*`;
- primitives compartilhadas quando existentes;
- CSS Modules para composição;
- nenhum micro-design-system paralelo.

Requisitos:

- 320px sem overflow horizontal;
- grid fluido;
- desktop amplo aproveita largura útil;
- mobile usa duas colunas quando há espaço e uma coluna quando necessário;
- ações por touch não dependem de hover;
- foco visível;
- reduced motion respeitado;
- dialogs semanticamente modais.

## Persistência

A persistência é compartilhada globalmente entre usuários autenticados.

Metadata física:

```text
lembra_references
- id
- title
- description
- status
- staged_bucket
- object_key
- sha256
- mime_type
- byte_size
- width
- height
- read_back_verified
- created_by_auth_user_id
- created_by_name
- created_at
- updated_at
- retired_at

lembra_favorites
- auth_user_id
- reference_id
- created_at
```

Não existe `campaign_id`.

`created_by_name` é um snapshot produzido pelo servidor a partir da identidade autenticada para exibição/busca. O browser nunca fornece autoria.

## Media Storage

Bytes ficam no Media Storage; PostgreSQL guarda somente metadata e identidade do objeto.

Fluxo:

```text
browser autenticado
 -> SHA-256 local + intent
 -> server valida sessão
 -> browser envia chunks de até 2 MiB para /api/lembra/upload
 -> server revalida sessão em cada chunk
 -> server grava chunks pending no R2 privado
 -> finalize recompõe os bytes no server
 -> valida magic bytes/MIME/hash/tamanho/dimensões
 -> materializa objeto canônico imutável
 -> read-back
 -> grava metadata
 -> galeria compartilhada
```

Namespaces:

```text
uploads/pending/lembra/{reference-uuid}/{upload-uuid}/chunks/{part}
lembra/{reference-uuid}/{sha256}.{ext}
```

Formatos da primeira versão:

- JPEG;
- PNG;
- WebP;
- até 12 MiB;
- dimensões máximas 20.000 × 20.000.

Objetos canônicos são privados. A entrega passa por `/api/lembra/{referenceId}/image`, que exige sessão autenticada e faz read-back validado.

## CRUD

Qualquer usuário autenticado pode:

- criar referência;
- alterar nome;
- alterar descrição;
- remover referência;
- favoritar/desfavoritar.

Remoção normal é **soft-retire** no banco. O objeto de mídia imutável não é apagado no mesmo clique, preservando recuperação operacional e evitando race com leitores.

## Failure modes

Tratar sem perder a galeria atual:

- arquivo fora dos formatos suportados;
- arquivo maior que o limite;
- upload interrompido;
- chunk ausente ou com tamanho inesperado;
- hash/MIME/tamanho divergente;
- read-back falhando;
- sessão expirada;
- write de metadata falhando após materialização do objeto;
- item removido enquanto outro cliente o visualiza;
- atualização concorrente simples;
- busca sem resultado.

A UI deve apresentar mensagens humanas; detalhes técnicos ficam em logs server-side sem segredo.

## Critérios de aceite da persistência

- [ ] reload preserva referências;
- [ ] dois usuários autenticados enxergam a mesma biblioteca;
- [ ] qualquer autenticado pode publicar;
- [ ] qualquer autenticado pode editar qualquer referência;
- [ ] qualquer autenticado pode remover qualquer referência;
- [ ] anônimo é enviado para login;
- [ ] autoria e data vêm do servidor;
- [ ] `Meus itens` continua sendo somente filtro;
- [ ] favoritos persistem por usuário;
- [ ] busca por nome/descrição/autor/data continua funcionando;
- [ ] filtro por período e ordenação continuam funcionando;
- [ ] drag/drop, paste e picker usam o mesmo pipeline;
- [ ] upload pendente usa chunks same-origin limitados e canonical object é imutável;
- [ ] finalize revalida bytes reais;
- [ ] credenciais permanentes R2 nunca chegam ao browser;
- [ ] falha de metadata não cria referência parcialmente visível;
- [ ] remoção é refletida para todos após reload;
- [ ] PostgreSQL sintético valida schema/grants/invariantes;
- [ ] Production só ativa após migration + R2 + smoke controlado.

## Fora de escopo

Não fazem parte do roadmap atual do Lembra:

- isolamento por campanha;
- RBAC/capabilities próprias;
- tags;
- categorias obrigatórias;
- boards/coleções;
- Discord bot;
- IA/embeddings;
- busca visual;
- vínculo com NPC/local/entity;
- promoção para canon;
- comentários;
- likes;
- feed social;
- vídeo/áudio;
- URL externa arbitrária.

A simplicidade é requisito, não ausência de funcionalidade.

## Rollout

1. mergear código/schema com `TDA_LEMBRA_ENABLED=false`;
2. validar migration em PostgreSQL descartável;
3. aplicar migration deliberadamente no Supabase canônico;
4. confirmar R2 private acessível pelo runtime server-side;
5. confirmar secrets server-side no runtime;
6. ativar `TDA_LEMBRA_ENABLED=true`;
7. smoke autenticado com dois usuários:
   - A publica;
   - B vê;
   - B edita;
   - A vê atualização;
   - B favorita para si;
   - A não recebe favorito de B;
   - A/B removem;
   - reload preserva estado correto;
8. validar caso negativo de upload inválido e sessão anônima.

## Referências

- [Arquitetura](../architecture.md)
- [Design System](../design-system/README.md)
- [Identidade](../domains/identity-access.md)
- [Media Storage / R2](../integrations/r2.md)
- [Fluxo de mídia](../integrations/r2/media-pipeline.md)
- [Issue #476](https://github.com/Faysk/tda/issues/476)
