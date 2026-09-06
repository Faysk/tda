# Feature — Perfis editoriais de entities

> Status: arquitetura aprovada; implementação pendente
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-06

## Valor

Perfis editoriais são a leitura aprofundada de uma entity: personagem, NPC, lugar, facção, música, quest ou outro objeto narrativo.

O World Explorer responde **como isso se conecta**. O perfil responde **quem/o que é isso, o que aconteceu com isso e quais memórias aprovadas pertencem a isso**.

## Relação com o World Explorer

O inspector lateral do [World Explorer](world-explorer.md) é uma quick view.

O perfil completo é uma página navegável, compartilhável e indexável conforme a visibility da entity.

```text
World Explorer
  -> selecionar entity
  -> inspector resumido
  -> Ver perfil completo
  -> entity profile
```

## Fonte de dados

Perfil não é um blob autoral isolado.

Ele compõe, conforme disponibilidade/autorização:

- `entities`;
- `canon_entries`;
- `entity_mentions`;
- `sessions`;
- relations futuras;
- publications;
- mídia;
- músicas/performances;
- quests/moments;
- knowledge autorizado no futuro.

## Rotas de produto

Rotas podem variar por tipo para UX/SEO:

```text
/personagens/[slug]
/npcs/[slug]
/lugares/[slug]
/faccoes/[slug]
/musicas/[slug]
/quests/[slug]
```

A implementação deve compartilhar um resolver/model base por `entities.id`/slug em vez de duplicar domínio para cada rota.

## Estrutura base

### Hero

- artwork oficial/aprovada;
- nome;
- subtítulo/epíteto;
- entity type humanizado;
- tags editoriais autorizadas;
- status narrativo relevante;
- quote opcional aprovada.

### Visão Geral

- summary da entity;
- canon entries destacadas;
- situação atual autorizada;
- links de contexto.

### Relações

- relações ativas relevantes;
- relações históricas quando a timeline exigir;
- fonte/contexto quando apropriado;
- link para focar no World Explorer.

### Momentos

Eventos/canon/sessões relevantes associados à entity.

### Linha do Tempo

Ordenação temporal derivada de evidence/canon, sem inventar datas quando a fonte não suporta precisão.

### Sessões

Sessões em que a entity participou/apareceu de forma relevante.

### Mídia

Artwork, galeria e elementos aprovados para aquela audience.

## Tabs por tipo

Não forçar todas as tabs para todos os tipos.

### PC/NPC

Possíveis:

- Visão Geral;
- Relações;
- Momentos;
- Sessões;
- Músicas;
- Galeria.

### Lugar

- Visão Geral;
- Pessoas;
- Facções;
- Eventos;
- Sessões;
- Galeria.

### Música

- Visão Geral;
- Letra/publicação autorizada;
- Performances;
- Impacto/canon;
- Sessões;
- Relações.

### Quest

- Visão Geral;
- Estado;
- Pessoas/lugares envolvidos;
- Momentos;
- Sessões.

## Conteúdo editorial versus sistema

Seguindo o Design System oficial:

> Visitante vê história; editor vê estado editorial.

Perfil público não exibe:

- `entity_id`;
- confidence de extraction;
- status de review;
- source IDs crus;
- coverage interna;
- jobs de processamento.

O Edit poderá fornecer uma visão administrativa da mesma entity em outra superfície.

## Status da entity

O perfil pode representar estados como:

- active;
- inactive;
- deceased;
- missing;
- destroyed;
- unknown;

O vocabulário real ainda precisa ser definido por tipo antes de migration específica. Não reutilizar `entities.status` como enum fictício sem revisar dados existentes.

## Aliases e homônimos

- URL resolve por slug/UUID, nunca só por display name;
- aliases ajudam busca/entity resolution;
- alias não substitui canonical name;
- homônimos precisam continuar distinguíveis.

A constraint histórica de `entities.name` ainda limita nomes repetidos na mesma campanha por compatibilidade com o consolidator legado; liberar homônimos exige migration coordenada documentada no banco.

## Media

Artwork de entity precisa de contrato separado de sessão.

Até o media model do Edit ser fechado:

- não enfiar listas arbitrárias de URLs em `entities.metadata` como solução permanente;
- fixture pode usar assets locais de demonstração;
- produção deve apontar para catálogo/mídia autorizada;
- R2 permanece destino de binários.

## Canon

O perfil só apresenta afirmações como fato quando forem canon aprovado.

Pode existir seção explicitamente marcada como:

- rumor;
- interpretação;
- memória contestada;
- conhecimento privado;

mas somente depois que esses modelos estiverem implementados e com linguagem inequívoca.

Não misturar interpretação com biografia factual.

## Quotes

Uma frase exibida no hero/inspector precisa ser:

- aprovada;
- atribuída corretamente;
- permitida para aquela audience;
- contextualizada quando necessário.

Não extrair automaticamente a frase “mais dramática” de uma transcrição para produção.

## Relações destacadas

O perfil pode exibir 4–8 relações relevantes.

A relevância pode ser definida por:

- pin editorial;
- relation family/type;
- recência;
- importância canônica;
- atividade no arco atual.

Evitar ranking opaco de IA como regra principal.

## Timeline

Timeline de entity deve ser derivada de fatos/momentos com source.

Ela pode misturar:

- sessões;
- canon entries;
- mudanças de relation;
- performances;
- quest states;
- eventos públicos.

Cada item precisa distinguir data exata, sessão aproximada ou ordem narrativa quando a precisão não existir.

## Knowledge e perspectiva

Quando o modelo de [knowledge/audience](knowledge-audience.md) existir, o mesmo perfil pode ter conteúdo diferente conforme a perspectiva autorizada.

Exemplo:

- público vê identidade conhecida;
- player vê segredos do próprio personagem;
- DM vê verdade oculta e planos;
- outro player não recebe esses blocos no payload.

## SEO/social

Para entities `public_web`:

- title/description específicos;
- canonical URL;
- Open Graph com artwork apropriada;
- fallback para OG oficial TDA;
- nenhum conteúdo secreto em metadata server-rendered.

Entities privadas não devem gerar preview social que revele nome/conteúdo.

## Acessibilidade

- heading hierarchy real;
- tabs com semântica adequada ou links quando navegação muda rota;
- alt text informativo na artwork;
- relação não comunicada só por cor/avatar;
- conteúdo continua legível sem JavaScript do World Explorer;
- long-form usa largura/line-height confortáveis do Design System.

## Primeiro vertical slice

Perfil de **Dandelion** como demonstração da composição oficial.

Deve validar:

- hero;
- summary;
- relations em destaque;
- moments;
- música;
- deep link para `/mundo?foco=dandelion`;
- light/dark;
- mobile;
- metadata social.

Fixtures não aprovadas devem permanecer marcadas como demo e não entrar em Supabase como canon.

## Critério de pronto

Uma entity autorizada possui uma página editorial coerente, acessível e compartilhável que compõe memória estruturada sem expor estado administrativo nem promover evidência bruta a canon.