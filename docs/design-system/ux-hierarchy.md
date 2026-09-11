# TDA — Diretriz geral de UX, design e hierarquia visual

> Status: canônico
> Owner: design-system / frontend
> Última revisão: 2026-09-11
> Fonte: diretriz geral fornecida pelo usuário e incorporada ao reboot em 2026-09-11

Esta diretriz vale para **todo o projeto TDA — Tem Dado Aqui**: Home, Sessões, Mundo, Personagens, Lores, Cinematics, Grafo, autenticação, conta, Edit, processamento, ferramentas administrativas e futuras superfícies.

O objetivo visual do TDA não é impressionar pelo tamanho dos elementos. O objetivo é criar uma experiência **bonita, madura, narrativa, clara e eficiente**, em que arte, tipografia e composição valorizem o conteúdo sem atrapalhar seu uso.

A identidade do TDA deve vir principalmente de **tipografia, cores, ritmo, composição, imagens, bordas, superfícies, detalhes dourados e consistência entre páginas**. Não usar títulos gigantes, excesso de espaço vazio, cards enormes ou elementos decorativos apenas para a página “parecer premium”.

## Conteúdo antes de decoração

Todo elemento deve justificar o espaço que ocupa.

Antes de adicionar ou aumentar qualquer elemento, perguntar:

**“Isso ajuda a entender o conteúdo, navegar, tomar uma decisão ou executar uma ação?”**

Se a resposta for não, o elemento deve ser reduzido, simplificado, movido para segundo plano ou removido.

Espaço em branco é importante para organização, mas não deve virar desperdício de viewport.

O usuário deve enxergar conteúdo relevante rapidamente.

---

## Títulos não são o conteúdo

Títulos servem para estabelecer contexto e hierarquia. Eles não devem virar o principal elemento visual da página sem uma razão narrativa concreta.

Evitar títulos enormes ocupando grande parte da primeira viewport apenas porque aquela é uma página importante.

Um título como:

**Sessões**

**Mundo**

**Processamento local**

**Personagens**

não precisa ocupar 100 ou 150 pixels de altura para comunicar onde o usuário está.

A escala deve variar de acordo com a função da superfície.

Em páginas normais, títulos principais devem geralmente permanecer em uma faixa aproximada de **32–48 px em desktop**, reduzindo proporcionalmente em telas menores.

Escalas maiores podem existir em **heroes narrativos reais**, quando o título participa diretamente da composição da arte e da história.

Um título grande deve ser uma decisão excepcional, não o padrão automático do projeto.

---

## Heroes devem ter propósito

O TDA pode possuir páginas cinematográficas e grandes imagens, mas hero não significa obrigatoriamente:

`imagem enorme + título enorme + frase + espaço vazio`.

Um hero só deve ocupar grande parte da tela quando a própria experiência se beneficia disso.

Na Home, em uma sessão importante, em uma Lore ou em uma Cinematic, uma composição grande pode ser adequada porque **arte e narrativa são o conteúdo**.

Mesmo nesses casos, o hero deve entregar informação real: personagem, evento, sessão, momento da campanha, continuidade ou ação.

Não criar heroes gigantes apenas para preencher a parte superior de páginas.

---

## Primeira viewport deve entregar valor

A região que aparece antes do primeiro scroll é extremamente importante.

Ela deve apresentar rapidamente uma combinação útil de:

- contexto;
- conteúdo;
- navegação;
- estado;
- ação.

Evitar gastar a primeira viewport inteira com:

- título;
- subtítulo;
- breadcrumb;
- introdução;
- grande área vazia;
- decoração.

Uma página deve começar a entregar sua função cedo.

Em Sessões, o usuário deve começar a ver sessões.

Em Mundo, deve começar a explorar o mundo.

Em Personagens, deve encontrar personagens.

Em Processamento, deve enxergar o processamento.

Em Edit, deve começar a editar.

---

## Densidade deve acompanhar a tarefa

O TDA não deve possuir uma densidade única para todas as páginas.

Superfícies narrativas podem respirar mais.

Superfícies de exploração podem ser mais densas.

Ferramentas de trabalho devem ser ainda mais compactas.

Porém, mesmo páginas narrativas não devem desperdiçar espaço.

A densidade deve ser determinada pela **função do conteúdo**, e não por uma regra estética fixa.

---

## Não transformar tudo em card

Cards não são a unidade universal de layout do TDA.

Não envolver automaticamente cada grupo de informações em:

`background + border + radius + padding`.

Isso cria interfaces pesadas, fragmentadas e visualmente genéricas.

Preferir, conforme o caso:

- divisores;
- seções;
- linhas;
- listas;
- grids;
- agrupamentos;
- imagens;
- continuidade espacial.

Usar cards quando houver uma razão clara para separar, destacar ou tornar um elemento interativo.

Um card deve existir porque melhora a compreensão, e não porque é fácil de estilizar.

---

## Hierarquia visual deve ser evidente

O usuário deve conseguir identificar rapidamente:

**o que é mais importante;**

**o que está acontecendo;**

**o que pode fazer;**

**o que é informação secundária.**

Não dar o mesmo peso visual para tudo.

Uma página com dez elementos igualmente destacados não possui hierarquia.

Trabalhar com níveis claros:

- conteúdo principal;
- conteúdo secundário;
- metadata;
- controles;
- detalhes.

---

## Tipografia

A tipografia oficial permanece parte fundamental da identidade TDA.

Serif deve ser usada onde seu caráter editorial realmente acrescenta algo: títulos, narrativa, texto de lore, sessões, momentos editoriais e determinadas labels.

A fonte de UI deve dominar:

- controles;
- filtros;
- busca;
- metadata operacional;
- formulários;
- status;
- tabelas;
- números;
- configurações;
- ferramentas.

Não utilizar serif indiscriminadamente apenas porque ela pertence à identidade.

Legibilidade é prioridade.

---

## Dourado é acento, não tinta de parede

O dourado do TDA deve continuar raro e significativo.

Pode indicar:

- prioridade;
- seleção;
- ação principal;
- destaque editorial;
- metadata importante;
- pequenos detalhes de identidade.

Não usar dourado em praticamente todas as bordas, títulos, ícones e botões.

Se tudo é dourado, nada é destaque.

Estados funcionais devem utilizar os tokens semânticos apropriados.

---

## Arte é conteúdo, não papel de parede obrigatório

O TDA é um projeto fortemente visual, mas uma imagem só deve existir quando adiciona valor.

Ilustrações podem:

- estabelecer ambiente;
- representar personagens;
- reforçar um momento narrativo;
- facilitar reconhecimento;
- enriquecer exploração.

Não adicionar imagens aleatórias de fantasia para tornar uma tela “mais TDA”.

Uma tela técnica não precisa de uma torre medieval atrás do painel de processamento.

A identidade já existe sem isso.

---

## Reduzir ruído visual

Evitar acumular simultaneamente:

- sombras fortes;
- glow;
- gradientes;
- bordas;
- textura;
- partículas;
- ícones;
- arte;
- dourado;
- backgrounds diferentes.

O TDA deve parecer **sofisticado pela composição**, e não pela quantidade de efeitos.

O visual deve ser calmo.

Os elementos mais ricos devem ganhar destaque justamente porque o restante da interface sabe ficar em silêncio.

---

## Divulgação progressiva

Informações secundárias ou técnicas não devem competir com o conteúdo principal.

Detalhes podem aparecer através de:

- accordions;
- menus;
- tooltips;
- drawers;
- páginas de detalhes;
- disclosures;
- modais quando apropriado.

Mostrar primeiro aquilo que o usuário precisa para compreender o contexto atual e decidir o próximo passo.

Depois permitir aprofundamento.

---

## A interface deve reagir ao estado

Não manter elementos visíveis apenas porque podem ser úteis em algum momento.

Se uma conexão precisa ser configurada, mostrar configuração.

Depois de conectada, reduzir essa área e mostrar o trabalho.

Se não existem resultados, apresentar um estado vazio útil.

Quando existem resultados, substituir o estado vazio pelos resultados.

Se ocorre erro, mostrar informação e ação suficientes para resolver.

A composição deve acompanhar o estado real da aplicação.

---

## Ações

Toda página deve deixar claro qual é a ação principal quando existir uma.

Evitar dez botões disputando atenção.

Diferenciar:

- ação principal;
- secundária;
- contextual;
- destrutiva.

Ações raras podem ser movidas para menus contextuais.

Ações destrutivas nunca devem parecer a ação preferencial.

---

## Layout deve aproveitar a tela

Não limitar artificialmente todo conteúdo a uma coluna estreita em monitores grandes.

Usar os tokens oficiais de largura e gutter e permitir que diferentes superfícies tenham composições adequadas ao conteúdo.

Um artigo pode precisar de uma coluna estreita para leitura.

Uma galeria, grafo, tabela ou ferramenta operacional pode precisar de muito mais largura.

**O layout deve seguir o conteúdo, e não o contrário.**

---

## Responsividade não significa apenas empilhar

Desktop, tablet e mobile devem preservar a mesma hierarquia de informação, mas podem reorganizar completamente a composição.

Não tentar reproduzir uma página desktop reduzindo tudo até caber.

No mobile:

- remover informações redundantes;
- reorganizar ações;
- simplificar metadata;
- reduzir títulos;
- priorizar conteúdo;
- evitar scroll horizontal.

---

## Navegação deve ser consistente

Usuários devem conseguir prever:

- onde estão;
- como voltar;
- onde encontrar páginas relacionadas;
- o que acontece ao clicar.

Não reinventar a navegação em cada feature.

Mudanças de composição são permitidas, mas o sistema de navegação e a linguagem de interação devem continuar familiares.

---

## Interface pública e interface operacional

O princípio do Design System permanece:

**“Visitante vê história; editor vê estado editorial.”**

Isso não significa que o público deve receber páginas exageradamente cinematográficas e o Edit páginas sem identidade.

Significa apenas que a **prioridade de informação é diferente**.

Na superfície pública, narrativa, arte e conteúdo podem liderar.

Nas superfícies operacionais, estado, dados e ações lideram.

Ambas continuam fazendo parte do mesmo produto.

---

## Consistência não significa páginas idênticas

Home, Sessões, Mundo, Grafo, Lore e Edit não precisam usar exatamente o mesmo template.

Elas precisam compartilhar:

- tokens;
- tipografia;
- navegação;
- linguagem de controles;
- estados;
- cores;
- ritmo;
- comportamento;
- qualidade.

O Design System deve criar parentesco visual, não clonagem.

---

## Evitar “design de mockup”

Não criar elementos apenas porque ficam bonitos em uma imagem estática.

Toda proposta deve considerar:

- dados reais;
- conteúdo longo;
- conteúdo curto;
- ausência de imagem;
- estados vazios;
- erros;
- loading;
- permissões;
- responsividade;
- teclado;
- foco;
- contraste;
- zoom;
- reduced motion.

Uma tela bonita que só funciona no cenário perfeito não é uma boa tela.

---

## Regra contra exagero

Quando houver dúvida entre aumentar e reduzir um elemento, começar pela versão menor.

Quando houver dúvida entre adicionar decoração e manter simples, começar simples.

Quando houver dúvida entre mostrar informação e escondê-la, verificar se ela interfere na decisão atual do usuário.

A complexidade deve ser conquistada pela necessidade.

---

## Referência prática de hierarquia

Como regra geral de composição:

**Título identifica.**

**Conteúdo domina.**

**Arte complementa.**

**Ação aparece quando necessária.**

**Metadata informa sem competir.**

**Decoração permanece em último lugar.**

---

## Direção visual final

O TDA deve parecer um **arquivo vivo de uma campanha**, não um template de dashboard, não uma landing page de startup e não uma interface medieval caricata.

Deve ser possível reconhecer o TDA mesmo em uma página sem nenhuma artwork.

Isso significa que sua identidade precisa sobreviver apenas com:

- tipografia;
- proporções;
- composição;
- cores;
- detalhes;
- controles;
- comportamento.

A arte deve elevar essa identidade, não sustentá-la sozinha.

O produto deve ser bonito quando parado, mas principalmente **bom de usar quando está cheio de dados reais**.

**Princípio final: o design do TDA deve servir ao conteúdo. Nunca obrigar o conteúdo a servir ao design.**
