# 🎲 Sessão ao vivo e assistente Discord — planos e limites

> **Para quem:** jogadores, mestres e contribuidores interessados no futuro das integrações da mesa. **Estado documentado:** sessão ao vivo *histórico/planejado, fora das entregas imediatas*; assistente Discord *histórico/planejado*. Não presumir comandos ou telas disponíveis hoje.

## Por que pensar nesses recursos?

Durante uma sessão real, o grupo já pode usar **Roll20**, **Discord** e **Craig**. O objetivo do TDA é guardar e reencontrar memória narrativa com fontes e permissão, **não substituir automaticamente um VTT**, criar chat de voz próprio ou competir com sistemas de combate.

Algumas possibilidades estudadas para uma futura área ao vivo incluem cena atual, NPCs da cena, marcadores, timer, notas, objetivos e links. Isso é uma lista de ideias, não um compromisso de entrega nem um contrato final de interface.

## O que acontece com uma anotação feita durante o jogo?

~~~mermaid
flowchart LR
  N["Nota ou marker da sessão"] --> E["Evidência/contexto"]
  E --> R["Candidato à revisão"]
  R --> A["Aprovação editorial"]
  A --> C["Canon, quando apropriado"]
~~~

O fluxo é **conceitual**. Uma anotação pode continuar privada, virar marker ou permitir revisão posterior. Não é correto transformá-la automaticamente em canon.

## Um futuro assistente no Discord

O contrato propõe que comandos de consulta usem o **mesmo domínio e as mesmas permissões do TDA**. O Discord seria uma interface, não uma nova base de verdade.

~~~mermaid
flowchart TD
  U["Pessoa no Discord"] --> P["Resolver identidade vinculada"]
  P --> A["Capability e campanha"]
  A --> Q["Consulta ou ação no TDA"]
  Q --> F["Resposta filtrada e auditável"]
~~~

Exemplos históricos de intenções de comando: recapitulação, NPC, itens, sessão ou ganchos. **Não são comandos atualmente garantidos**, e nomes/UX ainda podem mudar.

Uma resposta efêmera ou privada do Discord **não substitui** a autorização no backend. Nunca se deve recuperar primeiro segredos de mestre e depender apenas de um prompt de IA para “não contar” ao jogador. O identificador estável da conta pode apoiar o vínculo, mas apelidos mutáveis não bastam como identidade.

## E se o TDA cair durante a mesa?

O contrato planeja o modo ao vivo como **conveniência resiliente**: uma falha do TDA não deve impedir a sessão, destruir gravações Craig ou bloquear o jogo. Integrações externas devem preservar fronteiras de responsabilidade.

## Como acompanhar a evolução

O material existente é planejamento e contratos, **não um manual de uso de uma funcionalidade publicada**. Quando houver uma implementação validada, consulte [estágios de entrega](https://github.com/Faysk/tda/wiki/Funcionalidades-e-estados) e o SHA de release correspondente antes de orientar jogadores a usá-la.

**Fontes:** [Modo sessão ao vivo](https://github.com/Faysk/tda/blob/main/docs/features/live-session.md) · [Assistente Discord](https://github.com/Faysk/tda/blob/main/docs/features/discord-assistant.md) · [Identidade e capacidades](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md) · [Ganchos e revisão](https://github.com/Faysk/tda/blob/main/docs/features/quests-hooks.md).

Continue: [Campanhas e sessões](https://github.com/Faysk/tda/wiki/Campanhas-e-sessoes) · [Gravação até revisão](https://github.com/Faysk/tda/wiki/Da-gravacao-a-revisao) · [Outros recursos em desenho](https://github.com/Faysk/tda/wiki/Recursos-narrativos-em-evolucao).
