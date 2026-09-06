# Feature — Músicas e performances

> Status: preparado/em desenho
> Owner: narrative-memory/media
> Última revisão: 2026-09-06

## Valor

Preservar músicas criadas/performadas na campanha, letras/versões e impacto narrativo — especialmente quando performance vira evento canônico.

## Base existente

- `entities(type=song)`;
- sessions;
- canon candidates/entries;
- publications;
- R2 para mídia futura;
- relations/mentions futuras podem conectar song ↔ character/location/event.

## Fonte histórica

O legado previa uma "Jukebox do Dandelion" com músicas, letras, versões Suno, contexto, impacto político, reações e versões proibidas.

A intenção de tratar música como objeto narrativo foi revalidada. A UX "Jukebox" específica continua opcional.

## Separar conceitos

### Song

Obra/identidade narrativa persistente — `entity(type=song)`.

### Performance

Ocorrência de uma song em session/cena, possivelmente com performer, versão e consequência.

### Media asset

Arquivo de áudio/imagem/letra associado, com storage/audience próprio.

Não representar todas as performances como nova song.

## Dados a decidir para performance

- song entity;
- session/timestamp;
- performer entities;
- location/context;
- version/arrangement;
- source evidence;
- canon/review state;
- media reference;
- visibility.

Pode exigir tabela específica se volume/queries justificarem.

## Canon

Uma música existir como entity não significa que toda letra/versão é canon. Performance ocorrida e impacto narrativo devem passar por review quando derivados de transcript/IA.

## Media

Arquivos aprovados podem ir ao R2. Não publicar versão privada/proibida apenas porque a song entity é player-visible.

## Critérios de aceite futuro

- página da song;
- histórico de performances;
- links para sessions/fontes;
- letra/versão com audience correta;
- player quando asset autorizado;
- impacto/canon separado de conteúdo editorial.

## Não objetivos iniciais

- streaming musical em escala;
- catálogo geral fora da campanha;
- gerar música automaticamente como canon;
- duplicar asset binário dentro do banco.
