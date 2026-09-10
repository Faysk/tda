export type PipipiSceneId =
	| "casa"
	| "super-herois"
	| "corredores"
	| "cadeira"
	| "ultimo-dia"
	| "acordou";

export type PipipiStorySection = {
	id: string;
	title: string;
	major: boolean;
	html: string;
	sceneAfter?: PipipiSceneId;
};

export type PipipiStoryPart = {
	id: string;
	number: string;
	eyebrow: string;
	title: string;
	description: string;
	sections: PipipiStorySection[];
};

/**
 * Conteúdo editorial aprovado do pack Pipipi.
 * HTML é estático, versionado e não recebe input do usuário em runtime.
 */
export const PIPIPI_STORY: {
	hero: { eyebrow: string; title: string; quote: string; attribution: string };
	turningPoint: { kicker: string; title: string; html: string };
	parts: PipipiStoryPart[];
	finaleHtml: string;
} = {
  "hero": {
    "eyebrow": "Pipipi",
    "title": "A Casa Onde os Super-Heróis Visitavam",
    "quote": "“Eu tive muita sorte quando era viva. Eu morava numa casa enorme, cheia de crianças, brinquedos e super-heróis.”",
    "attribution": "Pipipi"
  },
  "turningPoint": {
    "kicker": "Até aqui",
    "title": "Pipipi não mentiu nenhuma vez.",
    "html": "<p>Ela realmente morou naquele lugar.</p>\n<p>As crianças realmente estavam lá.</p>\n<p>Os brinquedos realmente chegavam.</p>\n<p>Os heróis realmente visitavam.</p>\n<p>A mãe realmente dormia na cadeira.</p>\n<p>A família realmente apareceu toda no mesmo dia.</p>\n<p>Pipipi realmente dormiu segurando a mão da mãe.</p>\n<p>Ela só não sabia <strong>o nome das coisas que estava vendo</strong>.</p>"
  },
  "parts": [
    {
      "id": "parte-01",
      "number": "01",
      "eyebrow": "Capítulo",
      "title": "A Casa",
      "description": "As lembranças de Pipipi começam no lugar onde ela aprendeu a brincar, esperar e cuidar.",
      "sections": [
        {
          "id": "a-casa",
          "title": "A Casa",
          "major": false,
          "html": "<p>Pipipi não se lembra de ter chegado à Casa.</p>\n<p>Na memória dela, simplesmente sempre esteve lá.</p>\n<p>A Casa era enorme.</p>\n<p>Tinha muitos quartos.</p>\n<p>Muitas camas.</p>\n<p>Muitas crianças.</p>\n<p>Alguns adultos que trabalhavam lá usavam roupas engraçadas e carregavam coisas de um quarto para outro.</p>\n<p>Pipipi conhecia os corredores muito bem.</p>\n<p>Sabia quais faziam barulho.</p>\n<p>Quais tinham janelas.</p>\n<p>Quais levavam para lugares onde adultos diziam para esperar.</p>\n<p>Quando uma criança nova chegava, Pipipi gostava de mostrar tudo.</p>\n<p>Ela achava importante que ninguém ficasse perdido dentro da própria Casa.</p>"
        },
        {
          "id": "as-regras-da-casa-segundo-pipipi",
          "title": "As regras da Casa, segundo Pipipi",
          "major": false,
          "html": "<p>A Casa possuía regras estranhas.</p>\n<p>Algumas eram óbvias.</p>\n<p>Outras eram coisas que adultos aparentemente inventavam porque gostavam de complicar a vida das crianças.</p>\n<p>Havia a <strong>Poção Ruim</strong>.</p>\n<p>Havia a <strong>Máquina que Tira Foto por Dentro</strong>.</p>\n<p>Havia a <strong>Garrafinha que Anda Junto</strong>.</p>\n<p>Às vezes os adultos queriam saber números.</p>\n<p>Às vezes queriam que Pipipi ficasse parada.</p>\n<p>Às vezes diziam que uma coisa ia doer só um pouquinho.</p>\n<p>Pipipi aprendeu muito cedo que “só um pouquinho” era uma unidade de medida completamente inútil.</p>\n<p>Mesmo assim, quase sempre cooperava.</p>\n<p>Depois reclamava.</p>\n<p>Reclamar fazia parte do processo.</p>"
        },
        {
          "id": "a-casa-que-recebia-presentes-sem-fazer-aniversario",
          "title": "A Casa que recebia presentes sem fazer aniversário",
          "major": false,
          "html": "<p>Uma coisa excelente sobre a Casa era que brinquedos apareciam sem ninguém precisar fazer aniversário.</p>\n<p>Caixas chegavam.</p>\n<p>Sacolas chegavam.</p>\n<p>Às vezes apareciam bichos de pelúcia.</p>\n<p>Às vezes livros.</p>\n<p>Às vezes coisas que ninguém sabia muito bem o que eram, mas crianças sempre encontram uma utilidade.</p>\n<p>Pipipi não achava isso estranho.</p>\n<p>Casas grandes provavelmente recebiam presentes.</p>\n<p>Era assim que o mundo funcionava.</p>"
        },
        {
          "id": "os-super-herois",
          "title": "Os super-heróis",
          "major": false,
          "html": "<p>De vez em quando, super-heróis visitavam a Casa.</p>\n<p>Princesas também.</p>\n<p>Palhaços.</p>\n<p>Músicos.</p>\n<p>Gente fantasiada.</p>\n<p>Uma vez apareceu até um cachorro que parecia trabalhar lá.</p>\n<p>Pipipi nunca entendeu exatamente por que pessoas tão importantes tinham tanto tempo livre.</p>\n<p>Mas não reclamava.</p>\n<p>Os músicos eram especialmente bons.</p>\n<p>Quando alguém tocava, a Casa ficava diferente por alguns minutos.</p>\n<p>Os sons ruins pareciam menores.</p>\n<p>As pessoas nos corredores paravam.</p>\n<p>Algumas crianças conseguiam sair dos quartos.</p>\n<p>Outras escutavam da cama.</p>\n<p>Pipipi gostava de imaginar que a Casa era o melhor lugar do mundo para se apresentar.</p>"
        },
        {
          "id": "a-pulseira-do-clube",
          "title": "A Pulseira do Clube",
          "major": false,
          "html": "<p>Pipipi tinha uma pulseira lilás.</p>\n<p>Pequena.</p>\n<p>Simples.</p>\n<p>Ela via outras crianças usando pulseiras parecidas.</p>\n<p>Então concluiu que aquilo era algum tipo de clube.</p>\n<p>Pipipi gostava de clubes.</p>\n<p>Gostava ainda mais da ideia de fazer parte de um que ocupava uma Casa inteira.</p>\n<p>A pulseira virou uma das coisas que nunca queria perder.</p>"
        },
        {
          "id": "as-criancas-que-eram-ruins-em-morar-la",
          "title": "As crianças que eram ruins em morar lá",
          "major": false,
          "html": "<p>Algumas crianças eram péssimas em morar na Casa.</p>\n<p>Chegavam.</p>\n<p>Ficavam um tempo.</p>\n<p>Depois desapareciam.</p>\n<p>Pipipi perguntava para onde tinham ido.</p>\n<p>As respostas eram sempre meio vagas.</p>\n<blockquote><p>“Foi embora.”</p></blockquote>\n<blockquote><p>“Foi descansar.”</p></blockquote>\n<blockquote><p>“Agora não está mais sentindo dor.”</p></blockquote>\n<p>Pipipi juntou essas informações e chegou a uma conclusão simples:</p>\n<p><strong>elas tinham ido para casa.</strong></p>\n<p>Ela achava curioso.</p>\n<p>Afinal, aquela também era uma Casa.</p>"
        },
        {
          "id": "minha-mae-trabalhava-demais",
          "title": "Minha mãe trabalhava demais",
          "major": false,
          "html": "<p>A mãe de Pipipi não morava na Casa o tempo todo.</p>\n<p>Ela trabalhava.</p>\n<p>Trabalhava muito.</p>\n<p>Pipipi achava isso profundamente inconveniente.</p>\n<p>Às vezes um super-herói aparecia e ela não estava.</p>\n<p>Às vezes havia uma apresentação e ela chegava depois.</p>\n<p>Às vezes Pipipi passava o dia inteiro guardando uma história incrível para contar e precisava esperar até a noite.</p>\n<p>Quando a mãe finalmente aparecia, vinha cansada.</p>\n<p>Pipipi reclamava:</p>\n<blockquote><p>“Você perdeu de novo!”</p></blockquote>\n<p>E a mãe normalmente respondia alguma versão de:</p>\n<blockquote><p><strong>“Na próxima eu vejo.”</strong></p></blockquote>\n<p>Pipipi acreditava.</p>\n<p>Por que não acreditaria?</p>\n<p>Sempre existia outra semana.</p>\n<p>Outra visita.</p>\n<p>Outra música.</p>\n<p>Outro dia.</p>\n<p>Outra próxima vez.</p>"
        },
        {
          "id": "minha-mae-era-meio-burra",
          "title": "Minha mãe era meio burra",
          "major": false,
          "html": "<p>Essa é uma das histórias que Pipipi costuma contar rindo.</p>\n<p>Segundo ela, a mãe era muito inteligente para algumas coisas e completamente incapaz de compreender o funcionamento de camas.</p>\n<blockquote><p>“Meu quarto tinha uma cama enorme.”  “E minha mãe dormia sentada.”</p></blockquote>\n<p>Ela aponta isso como evidência incontestável.</p>\n<p>Havia uma cadeira ao lado da cama.</p>\n<p>Uma cadeira ruim.</p>\n<p>Pipipi sabia que era ruim porque já havia sentado nela.</p>\n<p>Mesmo assim, em algumas noites, acordava e encontrava a mãe ali.</p>\n<p>Torta.</p>\n<p>Com a cabeça caída para um lado.</p>\n<p>Às vezes ainda segurando a mão dela.</p>\n<p>Pipipi chegou a oferecer espaço na cama várias vezes.</p>\n<p>A resposta era quase sempre:</p>\n<blockquote><p>“Eu estou confortável.”</p></blockquote>\n<p>Pipipi nunca acreditou completamente nisso.</p>\n<p>Mas achava engraçado.</p>\n<p>Adultos eram estranhos.</p>"
        },
        {
          "id": "o-melhor-dia-da-vida-de-pipipi",
          "title": "O melhor dia da vida de Pipipi",
          "major": false,
          "html": "<p>Se alguém pergunta qual foi o melhor dia que ela viveu, Pipipi não precisa pensar.</p>\n<p>Ela sabe.</p>\n<p>Foi:</p>"
        },
        {
          "id": "o-dia-em-que-todo-mundo-faltou-ao-trabalho",
          "title": "O Dia em que Todo Mundo Faltou ao Trabalho",
          "major": true,
          "html": "<p>Já começou excelente porque a mãe estava lá desde cedo.</p>\n<p>Isso por si só era raro.</p>\n<p>Pipipi esperou algum momento em que a mãe olharia para a porta, perceberia o horário e sairia correndo.</p>\n<p>Não aconteceu.</p>\n<p>Depois chegou mais gente.</p>\n<p>Um familiar.</p>\n<p>Depois outro.</p>\n<p>E outro.</p>\n<p>Gente que Pipipi não via havia algum tempo apareceu no mesmo dia.</p>\n<p>Aquilo obviamente significava alguma coisa.</p>\n<p>Ela chegou a perguntar:</p>\n<blockquote><p>“É meu aniversário?”</p></blockquote>\n<p>Talvez alguém tenha respondido:</p>\n<blockquote><p>“Hoje pode ser.”</p></blockquote>\n<p>Pipipi adorou a ideia.</p>\n<p>Não havia bolo de aniversário de verdade, mas isso era detalhe administrativo.</p>\n<p>Todo mundo estava ali.</p>\n<p>Ninguém parecia com pressa.</p>\n<p>Ninguém precisava trabalhar.</p>\n<p>Ninguém dizia que passaria mais tarde.</p>\n<p>Talvez tenha tido música.</p>\n<p>Pipipi lembra de música.</p>\n<p>E lembra de uma coisa ainda mais importante:</p>\n<p><strong>a mãe assistiu até o fim.</strong></p>\n<p>Dessa vez ela não perdeu a apresentação.</p>\n<p>Pipipi venceu.</p>"
        },
        {
          "id": "depois-eu-fiquei-com-sono",
          "title": "Depois eu fiquei com sono",
          "major": false,
          "html": "<p>No fim daquele dia, Pipipi estava cansada.</p>\n<p>Muito cansada.</p>\n<p>A mãe perguntou se ela queria dormir.</p>\n<p>Pipipi não queria.</p>\n<p>Não porque estivesse com medo.</p>\n<p>Porque não queria perder nada.</p>\n<blockquote><p>“Mas vocês vão embora.”</p></blockquote>\n<p>A mãe respondeu:</p>\n<blockquote><p>“Não vamos.”</p></blockquote>\n<p>Pipipi insistiu:</p>\n<blockquote><p>“Quando eu acordar vocês vão estar aqui?”</p></blockquote>\n<blockquote><p>“Vamos.”</p></blockquote>\n<p>Isso resolveu o problema.</p>\n<p>Ela podia dormir.</p>\n<p>Pipipi segurou a mão da mãe.</p>\n<p>Fechou os olhos.</p>\n<p>E essa é praticamente a última coisa de que se lembra daquele dia.</p>\n<p>Quando abriu os olhos novamente, alguma coisa tinha mudado.</p>\n<p>Ela estava leve.</p>\n<p>Não sentia dor.</p>\n<p>Não precisava carregar a Garrafinha que Anda Junto.</p>\n<p>E, mais importante:</p>\n<blockquote><p><strong>“Eu sabia voar.”</strong></p></blockquote>\n<p>Pipipi considera esse um final excelente.</p>"
        }
      ]
    },
    {
      "id": "parte-02",
      "number": "02",
      "eyebrow": "Capítulo",
      "title": "O outro nome da Casa",
      "description": "As mesmas memórias continuam verdadeiras. O que muda é aquilo que elas significavam.",
      "sections": [
        {
          "id": "a-casa-tinha-outro-nome",
          "title": "A Casa tinha outro nome",
          "major": true,
          "html": "<p>A Casa era um hospital.</p>\n<p>Pipipi passou uma parte significativa da infância internada por causa de uma doença grave.</p>\n<p>Não era uma criança completamente alheia ao que acontecia consigo.</p>\n<p>Ela sabia que estava doente.</p>\n<p>Sabia que os remédios eram necessários.</p>\n<p>Sabia que havia dias em que o corpo não obedecia.</p>\n<p>Sabia que certos procedimentos doíam.</p>\n<p>Sabia que existiam crianças que conseguiam correr mais do que ela.</p>\n<p>Sabia que os adultos ficavam preocupados quando alguns números mudavam.</p>\n<p>Mas Pipipi era uma criança.</p>\n<p>Ela conhecia fatos.</p>\n<p>Não conhecia prognósticos.</p>\n<p>Não conhecia estatísticas.</p>\n<p>Não conhecia cuidados paliativos.</p>\n<p>Não sabia diferenciar uma tentativa de cura de uma tentativa de aliviar sofrimento.</p>\n<p>E ninguém conseguiu transformar em linguagem infantil uma verdade que até adultos tinham dificuldade para aceitar:</p>\n<p><strong>Pipipi não ficaria boa.</strong></p>",
          "sceneAfter": "casa"
        },
        {
          "id": "a-pulseira-do-clube-nao-era-de-um-clube",
          "title": "A Pulseira do Clube não era de um clube",
          "major": false,
          "html": "<p>A pequena pulseira lilás que Pipipi usa até hoje era uma pulseira hospitalar.</p>\n<p>Um objeto banal.</p>\n<p>Uma identificação.</p>\n<p>Nada mágico.</p>\n<p>Nada exclusivo.</p>\n<p>Nada criado para marcar amizade entre crianças.</p>\n<p>Mas Pipipi viu muitas crianças usando pulseiras semelhantes.</p>\n<p>E criou uma explicação que fazia sentido para ela.</p>\n<p>O que, para um adulto, era burocracia hospitalar, para Pipipi virou pertencimento.</p>\n<blockquote><p><strong>“Eu faço parte daqui.”</strong></p></blockquote>\n<p>Talvez seja por isso que a pulseira tenha permanecido tão importante depois da morte.</p>\n<p>Ela não preserva um documento.</p>\n<p>Preserva a única casa da qual realmente se lembra.</p>"
        },
        {
          "id": "os-presentes-nao-apareciam-por-acaso",
          "title": "Os presentes não apareciam por acaso",
          "major": false,
          "html": "<p>As caixas de brinquedos eram doações.</p>\n<p>Muitas delas destinadas especificamente a crianças que passavam longos períodos internadas.</p>\n<p>Talvez algumas chegassem em datas comemorativas.</p>\n<p>Talvez outras viessem de instituições, comunidades ou desconhecidos que jamais conheceriam Pipipi pessoalmente.</p>\n<p>Para Pipipi, brinquedos simplesmente surgiam.</p>\n<p>Para os adultos, eram tentativas pequenas de devolver infância a um lugar onde a infância frequentemente precisava dividir espaço com exames, remédios e medo.</p>\n<p>Pipipi estava correta sobre uma coisa:</p>\n<p>às vezes aquilo realmente parecia aniversário.</p>\n<p>Só que algumas daquelas crianças talvez não chegassem ao próximo.</p>"
        },
        {
          "id": "os-super-herois-nao-vieram-salva-la",
          "title": "Os super-heróis não vieram salvá-la",
          "major": false,
          "html": "<p>As princesas não eram princesas.</p>\n<p>Os heróis mascarados não haviam acabado de salvar uma cidade.</p>\n<p>Os palhaços não trabalhavam num circo secreto dentro da Casa.</p>\n<p>Os músicos não estavam ali porque aquele era o melhor palco da região.</p>\n<p>E o cachorro que “trabalhava lá” provavelmente fazia parte de alguma atividade terapêutica.</p>\n<p>Eram voluntários.</p>\n<p>Projetos sociais.</p>\n<p>Artistas.</p>\n<p>Gente disposta a vestir uma fantasia, carregar um instrumento ou simplesmente passar algumas horas junto de crianças que enfrentavam coisas que criança nenhuma deveria precisar compreender.</p>\n<p>Pipipi dizia que conheceu muitos super-heróis.</p>\n<p>Talvez essa seja uma das poucas interpretações dela que não precise ser corrigida.</p>\n<p>A fantasia estava errada.</p>\n<p>O heroísmo, talvez não.</p>",
          "sceneAfter": "super-herois"
        },
        {
          "id": "algumas-criancas-nunca-foram-para-casa",
          "title": "Algumas crianças nunca foram para casa",
          "major": false,
          "html": "<p>Essa é uma das memórias que muda completamente depois que se conhece a realidade.</p>\n<p>Pipipi viu muitas crianças desaparecerem dos corredores.</p>\n<p>Algumas receberam alta.</p>\n<p>Voltaram para suas casas.</p>\n<p>Retomaram vidas que haviam sido interrompidas pela doença.</p>\n<p>Outras não.</p>\n<p>Algumas das camas vazias pertenciam a crianças que morreram.</p>\n<p>Quando Pipipi perguntava onde estavam, os adultos davam respostas incompletas porque ela era pequena, porque não sabiam o que dizer ou simplesmente porque estavam tentando protegê-la.</p>\n<blockquote><p>“Foi embora.”</p></blockquote>\n<blockquote><p>“Foi descansar.”</p></blockquote>\n<blockquote><p>“Agora não está mais sentindo dor.”</p></blockquote>\n<p>Pipipi encaixou todas essas respostas na única lógica que conhecia:</p>\n<p><strong>elas foram para casa.</strong></p>\n<p>Por isso não teve medo quando chegou sua própria vez de desaparecer daquele quarto.</p>\n<p>Ela acreditava que era assim que a Casa funcionava.</p>\n<p>Todos, cedo ou tarde, iam embora.</p>",
          "sceneAfter": "corredores"
        },
        {
          "id": "o-dia-da-pocao-ruim",
          "title": "O Dia da Poção Ruim",
          "major": false,
          "html": "<p>A Poção Ruim não era uma brincadeira inventada pelos adultos.</p>\n<p>Era o nome que Pipipi deu ao tratamento que sabia que precisava receber, mesmo odiando o que vinha depois.</p>\n<p>Talvez náusea.</p>\n<p>Talvez fraqueza.</p>\n<p>Talvez dor.</p>\n<p>Talvez dias inteiros sem energia para brincar.</p>\n<p>Não é necessário que Pipipi compreenda o nome médico exato para que sua lembrança seja verdadeira.</p>\n<p>Ela lembra da textura.</p>\n<p>Do gosto.</p>\n<p>Do cheiro.</p>\n<p>Da antecipação.</p>\n<p>Do adulto dizendo que estava quase terminando.</p>\n<p>Da recompensa depois.</p>\n<p>Da mão que ela apertava.</p>\n<p>Crianças muitas vezes não guardam a terminologia de uma doença.</p>\n<p>Guardam o que ela fazia com seus dias.</p>"
        },
        {
          "id": "a-garrafinha-que-andava-junto",
          "title": "A Garrafinha que Andava Junto",
          "major": false,
          "html": "<p>O objeto que Pipipi tratava como companheiro de corredor era parte de seu tratamento.</p>\n<p>Soro.</p>\n<p>Medicação.</p>\n<p>Um suporte que precisava acompanhá-la quando saía do quarto.</p>\n<p>Pipipi humanizou aquilo porque fazia parte da rotina.</p>\n<p>Talvez tivesse até dado um nome absurdo.</p>\n<p>Talvez reclamasse quando uma roda travava.</p>\n<p>Talvez corresse com ele quando não deveria.</p>\n<p>Na lembrança dela, era só mais uma característica estranha da Casa.</p>\n<p>Na realidade, era uma das inúmeras formas pelas quais seu corpo precisava de ajuda para continuar funcionando.</p>"
        },
        {
          "id": "minha-mae-trabalhava-demais-verdade",
          "title": "“Minha mãe trabalhava demais.”",
          "major": true,
          "html": "<p>Pipipi estava certa.</p>\n<p>A mãe trabalhava demais.</p>\n<p>Só que Pipipi nunca soube por quê.</p>\n<p>Não via contas.</p>\n<p>Não via conversas médicas.</p>\n<p>Não via o dinheiro indo embora.</p>\n<p>Não via o esforço para conciliar trabalho com internações, consultas e emergências.</p>\n<p>Não via o medo de perder o emprego ao mesmo tempo em que tinha medo de perder a filha.</p>\n<p>Não sabia quantas vezes a mãe provavelmente chorou longe do quarto para conseguir voltar sorrindo.</p>\n<p>Não sabia quantas vezes aquela mulher ouviu informações que nenhuma mãe gostaria de ouvir e, minutos depois, entrou no quarto como se o mundo não tivesse acabado um pouco.</p>\n<p>Pipipi só sabia que a mãe às vezes chegava atrasada.</p>\n<p>E que prometia:</p>\n<blockquote><p><strong>“Na próxima eu vejo.”</strong></p></blockquote>\n<p>Essa frase parecia simples porque todos ainda fingiam que existiria uma próxima.</p>"
        },
        {
          "id": "a-cadeira",
          "title": "A cadeira",
          "major": false,
          "html": "<p>A mãe não dormia sentada porque achava confortável.</p>\n<p>Dormia sentada porque queria permanecer ao lado da filha.</p>\n<p>Talvez depois de trabalhar o dia inteiro.</p>\n<p>Talvez depois de horas falando com médicos.</p>\n<p>Talvez porque voltar para casa significasse ficar longe demais caso alguma coisa acontecesse.</p>\n<p>Então ficava.</p>\n<p>Na cadeira ruim.</p>\n<p>Perto da cama boa.</p>\n<p>Pipipi acordava e ria daquilo.</p>\n<p>Talvez essa seja uma das lembranças mais cruéis da história justamente porque <strong>não existe crueldade dentro dela</strong>.</p>\n<p>Há somente uma criança achando engraçado que sua mãe prefira uma cadeira desconfortável.</p>\n<p>E uma mãe cansada demais para explicar que a cadeira era o preço mais barato que pagaria para continuar ali.</p>",
          "sceneAfter": "cadeira"
        },
        {
          "id": "o-dia-em-que-todo-mundo-faltou-ao-trabalho-verdade",
          "title": "O Dia em que Todo Mundo Faltou ao Trabalho",
          "major": true,
          "html": "<p>Esse era realmente um dia diferente.</p>\n<p>Só não pelo motivo que Pipipi imaginava.</p>\n<p>Sua condição havia piorado.</p>\n<p>O tratamento já não mudaria o que estava acontecendo.</p>\n<p>Em algum momento, os médicos conversaram com a família.</p>\n<p>Não havia mais promessa honesta de recuperação para oferecer.</p>\n<p>Restava conforto.</p>\n<p>Tempo.</p>\n<p>Presença.</p>\n<p>E a informação mais simples e mais impossível:</p>\n<p><strong>se alguém quisesse se despedir, deveria vir.</strong></p>\n<p>Foi por isso que a mãe não trabalhou.</p>\n<p>Foi por isso que familiares apareceram no mesmo dia.</p>\n<p>Foi por isso que ninguém tinha pressa.</p>\n<p>Foi por isso que ninguém disse:</p>\n<blockquote><p>“Na próxima eu vejo.”</p></blockquote>\n<p>Porque os adultos no quarto sabiam uma coisa que Pipipi não sabia.</p>\n<p><strong>Talvez não existisse uma próxima.</strong></p>"
        },
        {
          "id": "e-meu-aniversario",
          "title": "“É meu aniversário?”",
          "major": false,
          "html": "<p>Não era.</p>\n<p>Mas a pergunta provavelmente destruiu alguém naquele quarto.</p>\n<p>Pipipi viu pessoas que amava reunidas.</p>\n<p>Viu atenção.</p>\n<p>Viu presentes ou pequenos agrados.</p>\n<p>Viu música.</p>\n<p>Viu gente tentando sorrir.</p>\n<p>O cérebro infantil encontrou a explicação mais próxima que conhecia para uma reunião daquele tipo:</p>\n<blockquote><p><strong>festa.</strong></p></blockquote>\n<p>Se alguém respondeu:</p>\n<blockquote><p>“Hoje pode ser.”</p></blockquote>\n<p>não estava necessariamente mentindo para ela.</p>\n<p>Talvez aquela família só tivesse decidido que as últimas horas de Pipipi não precisavam pertencer à doença.</p>\n<p>Poderiam pertencer a Pipipi.</p>"
        },
        {
          "id": "a-ultima-apresentacao",
          "title": "A última apresentação",
          "major": false,
          "html": "<p>Pipipi lembra que houve música.</p>\n<p>O detalhe importante para ela não é a música.</p>\n<p>É a mãe.</p>\n<p>A mãe ficou até o final.</p>\n<p>Durante boa parte da infância, Pipipi acumulou pequenas frustrações porque trabalho, dinheiro e cansaço roubavam da mãe momentos que ela gostaria de compartilhar.</p>\n<p>Naquele dia, nada tirou a mãe da cadeira.</p>\n<p>Nada fez olhar para o relógio.</p>\n<p>Nada produziu a frase:</p>\n<blockquote><p>“Na próxima.”</p></blockquote>\n<p>Pipipi finalmente teve a plateia que queria.</p>\n<p>Sem saber que aquele era o único motivo pelo qual ninguém ousaria sair dali.</p>",
          "sceneAfter": "ultimo-dia"
        },
        {
          "id": "quando-eu-acordar-voces-ainda-vao-estar-aqui",
          "title": "“Quando eu acordar vocês ainda vão estar aqui?”",
          "major": true,
          "html": "<p>Talvez essa tenha sido uma das últimas perguntas de Pipipi.</p>\n<p>Ela não queria dormir porque todo mundo finalmente estava junto.</p>\n<p>A mãe prometeu ficar.</p>\n<p>Não prometeu que Pipipi acordaria.</p>\n<p>Não prometeu amanhã.</p>\n<p>Não prometeu recuperação.</p>\n<p>Prometeu somente aquilo que ainda conseguia cumprir:</p>\n<blockquote><p><strong>“Nós vamos estar aqui.”</strong></p></blockquote>\n<p>Pipipi dormiu segurando sua mão.</p>\n<p>A família ficou.</p>\n<p>A mãe ficou.</p>\n<p>E Pipipi morreu sem descobrir que aquela era uma despedida.</p>"
        },
        {
          "id": "quando-pipipi-acordou",
          "title": "Quando Pipipi acordou",
          "major": true,
          "html": "<p>Não havia dor.</p>\n<p>Não havia máquinas.</p>\n<p>Não havia tratamento.</p>\n<p>Não havia agulhas.</p>\n<p>Não havia a Garrafinha que Andava Junto.</p>\n<p>Não havia necessidade de pedir para ninguém ficar.</p>\n<p>Ela simplesmente estava leve.</p>\n<p>Flutuando.</p>\n<p>E, sendo Pipipi, sua conclusão não foi filosófica.</p>\n<p>Não pensou sobre mortalidade.</p>\n<p>Não perguntou aos deuses por que uma criança precisava morrer.</p>\n<p>Não analisou a injustiça da própria vida.</p>\n<p>Pensou:</p>\n<blockquote><p><strong>“EU SEI VOAR.”</strong></p></blockquote>\n<p>Talvez tenha sido exatamente assim que nasceu o fantasminha que existe hoje.</p>\n<p>Não de uma compreensão da morte.</p>\n<p>Mas da descoberta de que, pela primeira vez em muito tempo, nada doía.</p>",
          "sceneAfter": "acordou"
        },
        {
          "id": "as-duas-metades-da-historia",
          "title": "As duas metades da história",
          "major": true,
          "html": "<p>Pipipi não viveu uma mentira.</p>\n<p>O hospital era um hospital.</p>\n<p>A doença era grave.</p>\n<p>Os tratamentos eram reais.</p>\n<p>Sua mãe estava exausta.</p>\n<p>Crianças morreram nos quartos ao redor.</p>\n<p>Sua própria família foi chamada para se despedir.</p>\n<p>Tudo isso é verdade.</p>\n<p>Mas também é verdade que Pipipi brincou.</p>\n<p>Que ganhou presentes.</p>\n<p>Que conheceu amigos.</p>\n<p>Que riu dos adultos.</p>\n<p>Que esperou ansiosa por músicos.</p>\n<p>Que gostou dos visitantes fantasiados.</p>\n<p>Que foi cuidada.</p>\n<p>Que foi amada.</p>\n<p>E que seu último dia pode, de fato, ter sido um dos dias mais felizes de sua curta vida.</p>\n<p>Pipipi não estava errada.</p>\n<blockquote><p><strong>Pipipi estava vendo apenas metade da história.</strong></p></blockquote>\n<p>A outra metade era composta por adultos tentando fazer com que ela continuasse sendo criança até o último momento possível.</p>"
        }
      ]
    },
    {
      "id": "parte-03",
      "number": "03",
      "eyebrow": "Capítulo",
      "title": "O que ficou",
      "description": "Algumas coisas terminaram naquele quarto. Outras continuaram voando com ela.",
      "sections": [
        {
          "id": "o-que-ficou-depois-da-morte",
          "title": "O que ficou depois da morte",
          "major": true,
          "html": "<p>Pipipi continua cuidando.</p>\n<p>Não porque tenha compreendido conscientemente todas essas coisas.</p>\n<p>Mas porque foi assim que aprendeu amor.</p>\n<p>Quando alguém está machucado, ela aproxima.</p>\n<p>Quando alguém está com medo, ela tenta ocupar o espaço ao lado.</p>\n<p>Quando alguém precisa tomar alguma coisa horrível, ela pode transformar aquilo numa brincadeira.</p>\n<p>Quando alguém diz:</p>\n<blockquote><p>“Não precisa ficar.”</p></blockquote>\n<p>Pipipi tende a ficar mesmo assim.</p>\n<p>Ela conhece, sem saber explicar, a diferença entre <strong>resolver um problema</strong> e <strong>não deixar alguém enfrentá-lo sozinho</strong>.</p>\n<p>Os médicos não conseguiram impedir sua morte.</p>\n<p>Sua família não conseguiu impedir sua morte.</p>\n<p>Sua mãe não conseguiu impedir sua morte.</p>\n<p>Nenhum dos super-heróis conseguiu impedir sua morte.</p>\n<p>Isso não significa que falharam com ela.</p>\n<p>Porque no momento em que já não havia nada a salvar...</p>\n<p>ninguém foi embora.</p>"
        },
        {
          "id": "a-ferida-que-pipipi-nunca-nomeou",
          "title": "A ferida que Pipipi nunca nomeou",
          "major": true,
          "html": "<p>Pipipi não demonstra grande medo da própria morte.</p>\n<p>Talvez porque, para ela, morrer tenha parecido dormir depois de um dia muito bom e acordar sem dor.</p>\n<p>Seu medo aparece de outra maneira.</p>\n<p>Ela detesta a ideia de alguém estar sozinho quando precisa de ajuda.</p>\n<p>Detesta chegar tarde.</p>\n<p>Detesta descobrir que alguma coisa aconteceu enquanto ela não estava.</p>\n<p>Insiste em acompanhar.</p>\n<p>Insiste em conferir.</p>\n<p>Insiste em cuidar.</p>\n<p>Às vezes mais do que deveria.</p>\n<p>Talvez exista dentro dela uma versão infantil da mesma promessa que ouviu naquela última noite:</p>\n<blockquote><p><strong>“Eu vou estar aqui.”</strong></p></blockquote>\n<p>Pipipi repete essa promessa para todo mundo sem perceber.</p>"
        },
        {
          "id": "pipipi-e-dandelion",
          "title": "Pipipi e Dandelion",
          "major": true,
          "html": "<p>Dandelion e Pipipi possuem respostas diferentes para sofrimento.</p>\n<p>Dandelion transforma dor em espetáculo.</p>\n<p>Pipipi transforma dor em cuidado.</p>\n<p>Ele procura a piada capaz de fazer alguém respirar entre duas lágrimas.</p>\n<p>Ela procura a cadeira ao lado.</p>\n<p>Por isso os dois podem funcionar tão bem juntos — e se irritar tanto.</p>\n<p>Dandelion pode tentar esconder uma ferida com uma apresentação inteira.</p>\n<p>Pipipi talvez espere a música acabar, aproxime-se e diga:</p>\n<blockquote><p>“Você está machucado.”</p></blockquote>\n<p>Dandelion responde:</p>\n<blockquote><p>“Estou dramaticamente ferido. É diferente.”</p></blockquote>\n<blockquote><p>“Senta.”</p></blockquote>\n<blockquote><p>“Pipipi—”</p></blockquote>\n<blockquote><p><strong>“Senta.”</strong></p></blockquote>\n<p>Ela não precisa vencer a máscara dele.</p>\n<p>Só precisa permanecer perto tempo suficiente para que ele não precise usá-la sozinho.</p>"
        },
        {
          "id": "a-pulseirinha",
          "title": "A pulseirinha",
          "major": true,
          "html": "<p>A pulseira continua no braço de Pipipi.</p>\n<p>Pequena.</p>\n<p>Lilás.</p>\n<p>Simples.</p>\n<p>Ela não precisa carregar nome, prontuário ou qualquer explicação legível.</p>\n<p>Para Pipipi, é só a Pulseira do Clube.</p>\n<p>Para quem conhece a história, é uma das últimas provas materiais de que aquela criança realmente esteve ali.</p>\n<p>E talvez isso seja o que torna o objeto tão forte.</p>\n<p>Pipipi olha para a pulseira e lembra de pertencimento.</p>\n<p>Para quem conhece a história, a mesma pulseira lembra de tudo que ela nunca entendeu.</p>\n<p>As duas interpretações são verdadeiras ao mesmo tempo.</p>"
        },
        {
          "id": "o-coracao-de-pipipi",
          "title": "O coração de Pipipi",
          "major": true,
          "html": "<p>A história de Pipipi não é sobre uma criança que descobriu que iria morrer.</p>\n<p>Ela nunca descobriu.</p>\n<p>Também não é sobre transformar doença em algo bonito.</p>\n<p>Doença não é bonita.</p>\n<p>Perder uma criança não é bonito.</p>\n<p>O que existe de bonito é aquilo que as pessoas fizeram <strong>apesar disso</strong>.</p>\n<p>Transformaram corredores em lugar de brincadeira.</p>\n<p>Transformaram doações em presentes inesperados.</p>\n<p>Transformaram voluntários em super-heróis.</p>\n<p>Transformaram tratamentos em nomes que uma criança conseguia suportar.</p>\n<p>Transformaram uma cadeira desconfortável em lugar de permanência.</p>\n<p>E, no último dia, quando já não havia como prometer cura, prometeram apenas presença.</p>\n<p>Essa promessa foi cumprida.</p>\n<p>Pipipi dormiu acreditando que, quando acordasse, sua família ainda estaria lá.</p>\n<p>Ela nunca descobriu se estavam.</p>\n<p>Mas eles ficaram enquanto puderam.</p>\n<p>E talvez seja por isso que, mesmo sem compreender a própria história, Pipipi carrega uma certeza para a eternidade:</p>\n<blockquote><p><strong>Quando você não consegue salvar alguém, ainda pode ficar.</strong></p></blockquote>"
        }
      ]
    }
  ],
  "finaleHtml": "<p>Pipipi diz que o melhor dia de sua vida foi aquele em que ninguém precisou trabalhar e todo mundo ficou com ela.</p>\n<p>Ela está certa.</p>\n<p>Só nunca soube <strong>por que todos estavam ali.</strong></p>"
};
