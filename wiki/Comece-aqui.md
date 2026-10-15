# 🧭 Comece aqui

**Para quem:** qualquer pessoa, incluindo quem nunca jogou RPG ou usou GitHub. **Objetivo:** descobrir o que há no TDA e navegar por uma primeira memória pública.

## 1. O que é uma campanha?

Em um jogo de interpretação de papéis (RPG), um grupo vive uma história coletiva. Chamamos essa jornada de **campanha**. Cada encontro do grupo é uma **sessão**. Uma campanha pode ter personagens, locais, acontecimentos, itens, músicas e histórias próprias.

O TDA procura preservar e conectar essas memórias. Algumas informações são abertas a visitantes; outras dependem de login, de uma campanha específica ou da autorização do editor.

## 2. Faça a primeira visita

1. Abra [o site TDA](https://dnd.faysk.dev/).
2. Procure **Campanhas**, ou abra [o diretório público](https://dnd.faysk.dev/campanhas).
3. Se houver campanhas públicas, escolha uma delas. Campanhas privadas ou arquivadas não aparecem nessa lista.
4. No hub da campanha, utilize o acesso às **Sessões**. Abra uma sessão publicada para ver as informações disponibilizadas.
5. Se não houver conteúdo ou ocorrer um erro, não deduza que a campanha foi apagada: há diferenças entre falta de conteúdo, indisponibilidade técnica e restrição de acesso.

O caminho concreto das campanhas usa uma identidade **pública**, não o código interno de banco de dados. Nomes e elementos de apresentação podem evoluir.

~~~mermaid
flowchart TD
  A["Abrir o TDA"] --> B["Campanhas públicas"]
  B --> C{"Há campanha disponível?"}
  C -->|Sim| D["Abrir uma campanha"]
  D --> E["Escolher Sessões"]
  E --> F["Ler uma sessão publicada"]
  C -->|Não| G["Ver estado vazio ou indisponibilidade"]
~~~

**Importante:** o desenho ensina uma jornada de navegação; os dados disponíveis no site podem variar.



## Se não encontrar o menu

O TDA usa o **avatar no canto superior direito** para abrir um painel com **Explorar, Ferramentas autorizadas e Conta e preferências**. Campanhas e Sessões ficam em Explorar; Personagens e NPCs ficam dentro de **Mundo** (segunda camada). A marca do canto superior esquerdo leva à Home. Para o passo a passo completo, consulte [Como usar o menu do TDA](https://github.com/Faysk/tda/wiki/Usando-o-TDA).

## 3. Preciso entrar com uma conta?

Para conteúdos públicos, não necessariamente. Ferramentas de edição, algumas bibliotecas e ações administrativas exigem autenticação e **capabilities**, isto é, permissões concedidas para ações e campanhas específicas. Entrar com uma conta não torna você automaticamente editor.

Veja [Usando o TDA](https://github.com/Faysk/tda/wiki/Usando-o-TDA) e [o contrato de autorização](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md).

## 4. E se eu não entender os nomes?

- **NPC:** personagem do mundo que não é controlado como personagem de jogador.
- **Lore:** texto ou apresentação narrativa de um universo ou personagem.
- **Canon:** informação tratada como parte estabelecida da história após revisão apropriada.
- **ASR:** reconhecimento automático de fala, usado para criar uma primeira versão de transcrição.
- **Edit:** área de trabalho para operadores com autorização editorial.

Há mais termos no [Glossário](https://github.com/Faysk/tda/wiki/Glossario).

## 5. Por onde continuar?

| Se você quer… | Leia |
| --- | --- |
| Entender como usar menus, conta e as áreas públicas | [Usando o TDA](https://github.com/Faysk/tda/wiki/Usando-o-TDA) |
| Navegar entre campanhas e memórias | [Campanhas e sessões](https://github.com/Faysk/tda/wiki/Campanhas-e-sessoes) |
| Conhecer o mapa visual das relações | [Mundo e entidades](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) |
| Saber de onde vêm as transcrições | [Companion e IA](https://github.com/Faysk/tda/wiki/Companion-e-IA) |
| Entender por que nem tudo é público | [Revisão e publicação](https://github.com/Faysk/tda/wiki/Edit-e-revisao) |

**Fonte técnica:** [diretório de campanhas](https://github.com/Faysk/tda/blob/main/docs/features/campaign-directory.md), [sessões](https://github.com/Faysk/tda/blob/main/docs/domains/sessions.md) e [navegação global](https://github.com/Faysk/tda/blob/main/docs/features/global-navigation.md).
