# 🎲 Usando o TDA

**Para quem:** visitantes, jogadores e mestres. Este manual começa pelo uso público e indica onde as permissões mudam.

## Mapa das áreas

| Área | O que encontrar | Caminho de referência |
| --- | --- | --- |
| Início | Entrada para o conteúdo disponível | [Home](https://dnd.faysk.dev/) |
| Campanhas | Campanhas visíveis ao público | [Campanhas](https://dnd.faysk.dev/campanhas) |
| Sessões | Memórias, datas e resumos que foram publicados | [Guia de sessões](https://github.com/Faysk/tda/wiki/Campanhas-e-sessoes) |
| Mundo | Exploração visual de entidades e relações autorizadas | [Mundo](https://dnd.faysk.dev/mundo) |
| Personagens / NPCs | Perfis e informações que puderem ser projetados publicamente | [Guia do mundo](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) |
| Lore / diário | Histórias e diários editoriais | [Lores e Lembra](https://github.com/Faysk/tda/wiki/Lores-e-Lembra) |
| Lembra | Referências visuais compartilhadas entre usuários autenticados | [Lembra](https://dnd.faysk.dev/lembra) |
| Edit | Ferramentas de produção/revisão autorizadas | [Guia do Edit](https://github.com/Faysk/tda/wiki/Edit-e-revisao) |

**Nem toda área tem a mesma maturidade ou quantidade de dados.** O catálogo canônico separa o que existe, está preparado ou é apenas proposta: [Catálogo de features](https://github.com/Faysk/tda/blob/main/docs/feature-catalog.md).

## Navegação e conta

O contrato visual do produto usa a **marca TDA** como atalho para a Home e o **avatar/controle de perfil** para navegação, conta, aparência e ferramentas, conforme o estado do usuário e permissões. Algumas telas podem mostrar estados de carregamento, indisponibilidade e ausência de conteúdo.

### Se uma ação não aparece

Isso pode acontecer porque o acesso não foi concedido, porque a campanha não está disponível para aquele usuário ou porque a funcionalidade não foi publicada. Não há um menu secreto que contorne permissões. Caso a interface pareça inconsistente, procure o operador da campanha ou reporte um problema com o mínimo de dados necessário.

## Público, autenticado e editor

~~~mermaid
flowchart LR
  V["Visitante"] --> P["Conteúdo publicamente aprovado"]
  A["Autenticado"] --> P
  A --> R["Recursos permitidos à conta"]
  E["Editor autorizado"] --> R
  E --> T["Edit e revisão por capability"]
~~~

**Autenticação não é autorização editorial.** Uma pessoa logada pode continuar sem acesso ao Edit ou a determinada campanha.

## Exemplos de jornadas

1. **Quero ler uma história:** visite Campanhas → escolha a campanha → abra Sessões → selecione uma memória publicada.
2. **Quero descobrir quem é uma personagem:** procure personagens ou Mundo; se houver perfil público, siga o link de contexto.
3. **Quero guardar uma referência:** verifique se tem conta autorizada no Lembra; a biblioteca segue o contrato de compartilhamento próprio.
4. **Quero corrigir uma transcrição:** acesso de leitura não basta; solicite autorização editorial e consulte [Edit e revisão](https://github.com/Faysk/tda/wiki/Edit-e-revisao).

## Quando algo não aparece

**Não aparece uma campanha:** talvez não seja pública ou esteja arquivada. **Não há sessões:** pode ser falta de memória publicada, não perda de gravações. **O Companion está offline:** isso não deveria impedir ler conteúdo cloud já publicado. **Conteúdo exige login:** siga o fluxo oficial de conta, sem trocar identificadores de URL para tentar forçar acesso.

**Fontes:** [navegação](https://github.com/Faysk/tda/blob/main/docs/features/global-navigation.md), [campanhas](https://github.com/Faysk/tda/blob/main/docs/features/campaign-directory.md), [identidade/autorização](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md) e [hierarquia de UX](https://github.com/Faysk/tda/blob/main/docs/design-system/ux-hierarchy.md).
