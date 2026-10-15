# 🗄️ Dados e modelo do TDA

**Para quem:** desenvolvedores e leitores que querem entender como as informações se relacionam. **Não é necessário conhecer SQL para acompanhar a primeira parte.**

## A ideia central

O TDA precisa guardar **quem participou de qual sessão**, **quais personagens e lugares aparecem na história**, **onde está a evidência** e **qual conteúdo pode ser publicado**. O PostgreSQL é o banco relacional principal, com Supabase como provedor atual.

O [índice do banco](https://github.com/Faysk/tda/blob/main/docs/database/README.md) descreve um catálogo histórico/contratual de **43 tabelas públicas**. Isso não significa 43 telas ou funcionalidades independentes. Contagens de schema e aplicação de migrations precisam ser comprovadas pela fonte física e por receipts, não presumidas por um texto.

## Mapa conceitual

~~~mermaid
flowchart TD
  CA["Campanha"] --> SE["Sessões"]
  SE --> PA["Participantes"]
  PA -.-> PF["Perfil humano"]
  PA -.-> EN["Personagem / entity"]
  SE --> EV["Fontes e evidências"]
  EV --> RE["Candidatos e revisões"]
  RE --> CO["Canon aprovado"]
  RE --> PU["Publicação autorizada"]
  EN --> CO
~~~

O desenho é conceitual; não representa nomes exatos de chaves estrangeiras nem prova que todos os registros existem numa campanha.

## Separações que evitam bugs

- **Pessoa ≠ personagem:** um login ou profile humano não deve ser identificado automaticamente pelo nome de uma personagem.
- **Sessão ≠ gravação:** uma sessão pode reunir várias fontes Craig; preservar a proveniência de cada uma.
- **Fonte ≠ transcrição ≠ canon:** reconhecimento de fala e classificação criam evidência ou candidato; a aprovação é humana.
- **Campanha pública ≠ acesso geral:** isolamento e visibilidade são checados no backend.
- **Mídia ≠ metadados:** objetos de imagem/áudio pertencem a Media Storage, não ao banco como blobs de uso geral.

## Como uma alteração de schema acontece?

~~~mermaid
flowchart LR
  S["Decisão de domínio"] --> M["Migration versionada"]
  M --> T["Testes e revisão"]
  T --> G["PR / main"]
  G --> A["Aplicação remota deliberada"]
  A --> V["Verificação / receipt"]
~~~

**Uma migration no GitHub não prova que ela foi aplicada.** Tampouco uma PR com CI verde significa que produção já segue a nova estrutura. Sem autorização, não execute scripts de DDL, backfill, reset ou limpeza no Supabase existente.

## Como encontrar a fonte técnica?

| Pergunta | Documento |
| --- | --- |
| Quais entidades existem? | [Modelo conceitual](https://github.com/Faysk/tda/blob/main/docs/data-model.md) |
| Quais tabelas e colunas? | [Catálogo físico](https://github.com/Faysk/tda/blob/main/docs/database/schema-catalog.md) |
| Como os dados se relacionam? | [Relações e ownership](https://github.com/Faysk/tda/blob/main/docs/database/relationships.md) |
| Como o banco impede acesso indevido? | [Segurança](https://github.com/Faysk/tda/blob/main/docs/database/security.md) |
| Como evolui o schema? | [Migrations](https://github.com/Faysk/tda/blob/main/docs/database/migrations.md) |
| Que capacidades são planejadas? | [Maturidade de features](https://github.com/Faysk/tda/blob/main/docs/feature-catalog.md) |

Continue: [Arquitetura](https://github.com/Faysk/tda/wiki/Arquitetura) · [Permissões](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes) · [Integrações](https://github.com/Faysk/tda/wiki/API-e-integracoes).
