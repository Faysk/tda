# 👥 Personagens, NPCs e perfis completos

> **Para quem:** visitantes, jogadores e autores. **Objetivo:** entender a diferença entre uma entidade, uma aparição na mesa e um perfil editorial completo.

## PC ou NPC: qual é a diferença?

**PC (personagem jogador)** é uma personagem representada por um jogador; **NPC** é uma personagem da história controlada pelo mestre. O TDA compartilha o fundamento de `entities` entre PC e NPC, e preserva vínculos específicos — não precisa manter duas bases de dados sem relação.

Uma personagem pode ter vários nomes usados na mesa (**aliases**), ser mencionada numa transcrição e aparecer numa sessão. Esses fatos precisam de fontes e não se tornam automaticamente descrições canônicas aprovadas.

## World Explorer versus perfil editorial

~~~mermaid
flowchart TD
  G["World Explorer: conexões"] --> I["Inspector: resumo autorizado"]
  I --> P["Perfil: memória editorial aprofundada"]
  P --> S["Sessões e aparições"]
  P --> C["Canon aprovado"]
  P --> M["Mídia autorizada"]
~~~

O **World Explorer** ajuda a descobrir *como as coisas se conectam*. O **perfil** responde *quem/o que é essa entidade, em que sessões apareceu e quais memórias estão aprovadas*. A leitura de um perfil não deveria depender de abrir o grafo.

## O que pode aparecer num perfil?

| Informação | Cuidado necessário |
| --- | --- |
| Nome, tipo e aliases | Identidade estável dentro da campanha |
| Resumo editorial | Somente o que a audiência pode ler |
| Aparições | Não confundir participar com ser apenas mencionado |
| Memórias canônicas | Revisão/aprovação exigidas |
| Mídia/retrato | Asset autorizado, sem vazamento de imagens privadas |
| Relações e timeline | Dependem dos contratos e dos dados realmente habilitados |

## Por que a campanha importa na URL?

O mesmo slug pode identificar entidades diferentes em campanhas diferentes. O resolver público precisa determinar **a campanha primeiro**; a identidade técnica pertence à combinação de entity ID + campaign ID, não ao título mostrado na tela.

Exemplo de formato canônico documentado: `/campanhas/[campaign]/personagens/[slug]`. Há aliases históricos de compatibilidade, como `/personagens/[slug]`, mas não se deve usar um slug global para enumerar informações de outras campanhas.

**Estado de entrega:** o contrato de perfis declara projeção pública implementada no código, enquanto o rollout multi-campaign depende da publicação/ativação do registry e dos gates de release. Isso **não garante** que toda rota ou entidade já esteja disponível ao público.

## Segredos e IA

Uma menção em transcrição privada **não deve ser copiada integralmente para uma página pública**. Criar uma entidade sugerida por IA ou juntar duas pessoas com nomes parecidos exige confirmação, proveniência e regras de audiência. Um NPC sem canon aprovado deve poder existir sem que o sistema invente sua história.

**Fontes:** [Personagens e NPCs](https://github.com/Faysk/tda/blob/main/docs/features/characters-and-npcs.md) · [Perfis editoriais](https://github.com/Faysk/tda/blob/main/docs/features/entity-profiles.md) · [Campanhas](https://github.com/Faysk/tda/blob/main/docs/architecture/multi-campaign.md) · [World Explorer](https://github.com/Faysk/tda/blob/main/docs/features/world-explorer.md).

Continue: [Mundo e entidades](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) · [Explorar relações](https://github.com/Faysk/tda/wiki/Explorar-o-World-Explorer) · [Audiência e privacidade](https://github.com/Faysk/tda/wiki/Quem-pode-ver-o-que).
