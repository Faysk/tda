# 🔭 Recursos narrativos em evolução

**Para quem:** jogadores, mestres e contribuidores. **Objetivo:** entender o que está preparado, o que ainda é uma ideia e o que não deve ser apresentado como recurso já publicado.

## O universo pode ter muito mais do que personagens

| Conceito | Fundamento documentado | O que não está garantido |
| --- | --- | --- |
| **Quests e ganchos** | `entity(type=quest)` e `possible_hook` | Lifecycle completo de objetivos ainda em desenho |
| **Músicas e performances** | `entity(type=song)` e evidências da mesa | Jukebox e histórico de performances não são experiência obrigatoriamente publicada |
| **Mapas narrativos** | Locations e sessões como fontes | Não há contrato definitivo de coordenadas ou de provedor do mapa |
| **Timeline** | Participantes, menções e canon | Projeções e tela de linha do tempo requerem revisão de audience |
| **Busca semântica** | Princípios de resultados com fontes e autoridade | Motor de embeddings e indexação de documentos privados não estão presumidos |
| **Intents** | Termo investigado, mas ambíguo | Não existe definição canônica de tabela, enum ou feature `intent` |
| **Diários** | Contrato para obras independentes e fontes editoriais | Documento dono declara implementação em branch local e publicação pendente |

**Não confunda ter uma tabela/entidade com ter uma página pronta para todos os usuários.**

## Gancho, quest e fato são diferentes

Imagine uma pista sobre **uma ponte esquecida** (exemplo inteiramente sintético). O gancho é algo que *poderia* acontecer; uma quest seria um objetivo acompanhado; o fato canônico é o que aconteceu de verdade e passou pela revisão.

~~~mermaid
flowchart TD
  A["Fonte da mesa"] --> B["Gancho possível"]
  B -.-> C["Quest, se acompanhada"]
  A --> D["Evento ocorrido"]
  D --> E["Revisão"]
  E --> F["Canon aprovado"]
~~~

O diagrama ilustra conceitos; **não é uma automação pronta**.

## Mapa de lugares ou grafo de relações?

O [World Explorer](https://github.com/Faysk/tda/wiki/Explorar-o-World-Explorer) é um grafo de relações. Um mapa narrativo poderia usar desenho de continentes, coordenadas relativas ou geografia real, mas isso ainda precisa de decisão. Não preencha coordenadas inexistentes só para que haja pins.

## O que esperar da busca com IA?

Uma busca futura precisa identificar campanha e permissão **antes** de recuperar informação, distinguir evidência/candidato/canon e citar uma fonte verificável. Um embedding é um índice derivado, não prova de que uma afirmação seja verdadeira.

~~~mermaid
flowchart LR
  A["Campanha e permissão"] --> B["Fontes filtradas"]
  B --> C["Busca futura"]
  C --> D["Resultado + fontes"]
~~~

## Onde verificar os estados

Use [Funcionalidades e estados](https://github.com/Faysk/tda/wiki/Funcionalidades-e-estados) e o [catálogo canônico](https://github.com/Faysk/tda/blob/main/docs/feature-catalog.md). A mudança de “em desenho” para “implementado em PR” **não significa** que o recurso está disponível em Production.

**Fontes por assunto:** [Quests](https://github.com/Faysk/tda/blob/main/docs/features/quests-hooks.md) · [Músicas](https://github.com/Faysk/tda/blob/main/docs/features/music-performances.md) · [Mapas](https://github.com/Faysk/tda/blob/main/docs/features/maps.md) · [Timeline](https://github.com/Faysk/tda/blob/main/docs/features/entity-timeline.md) · [Busca](https://github.com/Faysk/tda/blob/main/docs/features/semantic-search.md) · [Intents](https://github.com/Faysk/tda/blob/main/docs/features/intents.md) · [Diários](https://github.com/Faysk/tda/blob/main/docs/features/character-diaries.md).

Continue: [Entidades](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) · [Audiência e segredos](https://github.com/Faysk/tda/wiki/Quem-pode-ver-o-que).
