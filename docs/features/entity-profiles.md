# Feature — Perfis editoriais de entities

> Status: preparado; projection publicada pendente
> Owner: narrative-memory / frontend
> Última revisão: 2026-09-07

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

O perfil não depende do World Explorer para continuar legível. O deep link é integração entre superfícies, não acoplamento de renderer.

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

A projection pública real continua pendente. Os shells atuais não publicam fixtures nem promovem conteúdo de teste a canon.

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

A implementação compartilha resolver/model base por `entities.id`/slug em vez de duplicar domínio para cada rota. Tipos sem rota aprovada continuam sem URL inventada.

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

## Presentation Engine compartilhado

A direção visual pertence a este mesmo contrato de entity profile; não existe uma segunda feature/documento dono da verdade.

A implementação usa uma única `LorePage` e separa conteúdo narrativo de presentation:

```text
entity + canon + media autorizada
              |
              v
        LoreProfileDTO
          |       |
          |       +--> presentation
          |              |- hero
          |              |- scenes
          |              |- motion preset
          |              `- atmosphere
          |
          +--> sections estáticas
```

Princípio:

> **conteúdo/canon é compartilhado; direção artística pode variar por entity.**

A personalização visual pode subir de nível sem criar `DandelionPage.tsx`, `IvoryPage.tsx` ou equivalentes:

- **standard**: hero/poster simples, sem layers obrigatórias;
- **cinematic preset**: artwork preparada em layers, focal point e motion preset;
- **hero artesanal**: composição específica por scenes, preservando o mesmo DTO e a mesma rota.

A direção artística manual fica em `src/features/lore/art-directions/` e contém somente presentation. Texto, canon, relações, segredos e narração não são duplicados ali.

### Layers 2.5D

O renderer suporta progressivamente:

- poster único;
- layers `background`, `midground`, `subject`, `foreground` e `atmosphere`;
- `depth`, focal point, offset, scale, blur, opacity e blend mode;
- presets `still`, `cinematic-soft`, `cinematic-push`, pans, `mystical-float`, `dark-breath` e `battle-drift`;
- fog/dust como efeitos base.

O 2.5D é enhancement. Falta de artwork recortada nunca bloqueia leitura ou publicação de um perfil autorizado.

Não instalar engine adicional por antecipação. DOM/CSS + `requestAnimationFrame` validam o contrato inicial; GSAP/WebGL/Pixi só entram depois de medição e necessidade concreta.

## Narração editorial e scenes/beats

Uma lore pode receber uma **narração editorial própria** gravada para o perfil. Ela é diferente de áudio bruto/pesado de sessão.

- áudio de sessão continua seguindo o domínio de processamento e permanece local;
- narração editorial só entra quando houver arquivo e texto autorizados para aquela audience;
- não gerar ou fabricar voz do usuário para preencher fixture;
- não reutilizar transcript bruto como narração pública sem revisão.

O contrato sincroniza um áudio contínuo com beats temporais:

```text
narration
  |- src
  `- beats[]
       |- startMs / endMs
       |- subtitle
       `- sceneId opcional
```

Um beat controla legenda e pode selecionar uma scene visual. A scene pode trocar poster/layers, focal point, atmosfera e motion preset sem alterar o conteúdo estático da página.

### Regras de UX da narração

- **play explícito**; nunca autoplay;
- play/pause continuam disponíveis durante a experiência;
- seek atualiza imediatamente beat, legenda e scene;
- legenda acompanha os beats do áudio;
- fim/seek fora de um beat não inventa legenda;
- `prefers-reduced-motion` desliga movimento não essencial, não a narração;
- pointer coarse/mobile desliga parallax de ponteiro e mantém composição estática;
- erro/ausência de áudio não remove texto, headings, links ou seções.

A narração é uma segunda forma de consumir a mesma lore. A página nunca vira um vídeo obrigatório.

## Leitura estática é o fallback canônico

Todas as informações editoriais necessárias continuam em HTML normal dentro das seções do perfil.

Isso garante:

- conteúdo legível sem dar play;
- leitura possível sem áudio;
- fallback quando JS falha;
- indexabilidade conforme visibility;
- acessibilidade para quem não consome a experiência cinematográfica;
- mobile funcional mesmo sem efeitos 2.5D.

Beats e subtitles não substituem `sections` como fonte textual da página.

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
- unknown.

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
- R2 permanece destino de binários de produto autorizados;
- áudio bruto/pesado de sessão não deve ser movido para R2 por este fluxo.

Para artwork 2.5D, preferir layers exportadas no mesmo artboard de referência. PNG pode ser master/intermediário; entrega web deve ser otimizada depois de medição real do primeiro slice.

## Canon

O perfil só apresenta afirmações como fato quando forem canon aprovado.

Pode existir seção explicitamente marcada como:

- rumor;
- interpretação;
- memória contestada;
- conhecimento privado;

mas somente depois que esses modelos estiverem implementados e com linguagem inequívoca.

Não misturar interpretação com biografia factual.

Fixtures de UI devem declarar que são demo e nunca ser retornadas pelo repository público.

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
- long-form usa largura/line-height confortáveis do Design System;
- legenda sincronizada permanece visível durante narração;
- controles de play/pause/seek possuem semântica HTML nativa;
- `prefers-reduced-motion` preserva compreensão sem movimento decorativo.

## Mobile

Mobile não deve depender de mouse nem de parallax.

O fallback obrigatório:

- poster/layers continuam cobrindo o hero com focal point coerente;
- pointer parallax é desligado em `pointer: coarse`;
- cenas continuam trocando por beat, sem exigir animação;
- controles da narração refluem para largura estreita;
- texto estático continua sendo a experiência completa quando mídia/efeitos não carregam.

## Implementação preparada

O recorte atual prepara:

```text
src/features/lore/
|- model.ts
|- presentation.ts
|- timeline.ts
|- repository.ts
|- route-page.tsx
|- routes.ts
|- art-directions/
|- fixtures/
`- components/
   |- lore-page.tsx
   |- lore-experience.tsx
   |- lore-cinematic-hero.tsx
   `- lore-narration-player.tsx
```

O repository público permanece deliberadamente vazio até existir projection autorizada. A fixture interna serve testes/component development e não é roteável.

## Primeiro vertical slice

Perfil de **Dandelion** continua sendo o candidato de validação quando houver fonte autorizada.

Deve validar:

- hero;
- summary;
- leitura estática completa;
- relations em destaque;
- moments;
- música;
- light/dark;
- mobile;
- metadata social;
- artwork 2.5D se disponível;
- narração editorial se o áudio for fornecido/aprovado;
- beats/legendas/seek/reduced motion quando a narração existir.

Sem texto, artwork ou narração autorizados, o scaffold deve continuar testável por fixture explicitamente não canônica, sem fabricar conteúdo da campanha.

## Assets pendentes para o slice real

- texto/canon autorizado da lore escolhida;
- artwork principal e, se desejado, recortes 2.5D;
- narração editorial gravada/aprovada;
- timestamps finais dos beats após o áudio real existir.

Esses assets são dependências de conteúdo, não bloqueadores da infraestrutura.

## Critério de pronto

Uma entity autorizada possui uma página editorial coerente, acessível e compartilhável que compõe memória estruturada sem expor estado administrativo nem promover evidência bruta a canon; narração e 2.5D são progressivos e nunca bloqueiam a leitura estática.