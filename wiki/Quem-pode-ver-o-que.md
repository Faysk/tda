# 👁️ Quem pode ver o quê? Privacidade e conhecimento

**Para quem:** visitantes, jogadores, mestres e editores. **Objetivo:** entender a diferença entre o que uma pessoa pode acessar no site e o que uma personagem sabe dentro da história.

## Um exemplo simples

Imagine que uma personagem descobre uma passagem secreta. Há pelo menos três perguntas diferentes:

1. **A passagem existe no canon?** Isso exige uma fonte e revisão adequadas.
2. **O jogador tem permissão para ler sobre ela no TDA?** Isso depende da audiência técnica.
3. **A personagem sabe da passagem?** Essa é uma informação **dentro da narrativa**, que pode diferir do que o jogador leu.

O sistema já possui regras técnicas de audiência, mas o modelo completo de **crenças, rumores, mentiras e “quem sabe o quê” na ficção** ainda está em desenho. Não apresentar essa parte futura como funcionalidade pronta.

~~~mermaid
flowchart TD
  E["Fonte ou evidência"] --> R["Revisão"]
  R --> C["Verdade canônica, quando aprovada"]
  C --> A["Filtro técnico de audiência"]
  A --> J["Informação permitida ao usuário"]
  C -.-> K["Conhecimento e crenças de personagens: modelo futuro"]
~~~

## Audiências técnicas do World Explorer

A projeção autorizada do mundo usa, conforme o contrato, os seguintes níveis operacionais:

| Quem pede | Níveis de visibilidade elegíveis no contrato |
| --- | --- |
| Visitante anônimo | `public_web` |
| Jogador autenticado **da campanha** | `private_players`, `public_campaign`, `public_web` |
| Mestre autenticado **da campanha** | `private_master`, `private_players`, `public_campaign`, `public_web` |
| Editor plenamente autorizado | Inclui ainda `review_only`, sob capability editorial |

**Esses níveis são filtros de conteúdo técnico, não uma representação de conhecimento narrativo.** Uma pessoa logada fora da campanha não recebe automaticamente a audiência de jogador daquela campanha; o servidor verifica o vínculo. E a simples existência de uma relação em dados internos não autoriza incluí-la na projeção pública.

## Rumor não é mentira, e nenhum dos dois é canon automático

- **Verdade canônica:** afirmação aprovada sobre o universo narrativo.
- **Rumor:** informação circulante, que pode ou não ser verdadeira.
- **Mentira:** afirmação falsa dentro de uma narrativa ou discurso.
- **Conhecimento do jogador:** informação disponível à pessoa.
- **Conhecimento da personagem:** informação obtida pela figura dentro da história.

O TDA precisa conseguir distinguir esses conceitos sem inventar verdades. Enquanto o contrato futuro não estiver concluído, a Wiki **não deve ensinar um editor a criar estados ou tabelas que ainda não existem**.

## Por que isso afeta a segurança?

O World Explorer filtra relações no servidor, antes de entregar o payload ao browser. Esconder uma relação com CSS depois de enviá-la ainda revelaria sua existência. A audiência se combina com autorização por capability/escopo e isolamento de campanha.

## Fontes e aprofundamento

[Contrato de conhecimento e audiência](https://github.com/Faysk/tda/blob/main/docs/features/knowledge-audience.md) · [World Explorer](https://github.com/Faysk/tda/blob/main/docs/features/world-explorer.md) · [Canon e revisão](https://github.com/Faysk/tda/blob/main/docs/domains/canon-review.md) · [Projeção server-side](https://github.com/Faysk/tda/blob/main/docs/architecture/data-flows.md).

Continue: [Login e permissões](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes) · [Como explorar o mundo](https://github.com/Faysk/tda/wiki/Explorar-o-World-Explorer) · [Glossário](https://github.com/Faysk/tda/wiki/Glossario)
