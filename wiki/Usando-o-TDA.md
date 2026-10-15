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

## Como encontrar as áreas no menu global

O menu atual não é a antiga barra de navegação. A **marca do TDA no canto superior esquerdo** abre a Home; o **avatar no canto superior direito** é o único controle global para explorar as áreas, acessar ferramentas permitidas e configurar conta/aparência.

~~~mermaid
flowchart TD
  A["Clique no avatar"] --> B["Painel global"]
  B --> C["Explorar"]
  B --> D["Ferramentas · somente com capability"]
  B --> E["Conta e preferências"]
  C --> F["Campanhas / Sessões / Lores / Lembra"]
  C --> G["Mundo"]
  G --> H["Explorar tudo, Personagens, NPCs, Lugares, Facções, Quests, Músicas, Diários"]
~~~

### Primeira navegação com o avatar

1. Abra [a Home](https://dnd.faysk.dev/) e procure o **avatar** no canto superior direito.
2. Abra o painel. Na seção **Explorar**, escolha **Campanhas** para ver campanhas descobríveis, ou **Sessões** para o arquivo agregado de sessões publicadas.
3. Se quiser conhecer pessoas, lugares ou relações, entre em **Mundo**. Essa opção abre uma segunda camada do painel, com **Explorar tudo**, **Personagens**, **NPCs**, **Lugares**, **Facções**, **Quests**, **Músicas** e **Diários**, quando os destinos estiverem disponíveis.
4. Para voltar da segunda camada, use **Voltar**. Não precisa abrir outro menu nem adivinhar URL.
5. **Ferramentas** só aparece se a identidade, a campanha e as capabilities realmente autorizarem alguma ação. Essa seção pode conter Processar, editar sessões, rever transcrições, permissões e mundo, conforme o contexto.
6. **Conta e preferências** concentra identidade, autenticação, aparência e sessão; não são links de app espalhados no primeiro nível.

O painel tem scroll próprio quando a janela é pequena. Em rotas de campanha, as ferramentas usam o contexto autorizado daquela campanha; se houver **mais de uma campanha elegível**, o sistema precisa de uma escolha explícita e não deve assumir uma campanha arbitrária.

### Usar teclado ou um leitor de tela

O avatar é um botão. **Enter** ou **Espaço** o abre/fecha; **Escape** fecha o painel e devolve o foco ao avatar. Ao entrar na camada Mundo, o foco deve ir ao botão **Voltar**; ao regressar, deve voltar a **Mundo**. Os links da rota ativa têm identificação semântica. O botão pode estar temporariamente **desabilitado antes da hidratação** da interface: isso impede aceitar um clique que ainda não possui os eventos JavaScript conectados.

Se esses comportamentos não ocorrerem, reporte um problema de acessibilidade, identificando navegador, viewport e uma reprodução sintética, sem copiar dados privados.

**Contrato e testes:** [Navegação global](https://github.com/Faysk/tda/blob/main/docs/features/global-navigation.md) e [Design System](https://github.com/Faysk/tda/blob/main/docs/design-system/README.md).

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
