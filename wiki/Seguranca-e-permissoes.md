# 🔐 Login, permissões e privacidade

**Para quem:** visitantes, jogadores, mestres e contribuidores. **Objetivo:** entender por que duas pessoas podem ver conteúdos e botões diferentes no TDA.

## Em poucas palavras

**Entrar na conta não significa ter acesso a tudo.** O TDA diferencia três perguntas:

1. **Quem é você?** A autenticação identifica sua conta.
2. **O que você pode fazer?** Uma permissão técnica autoriza ações específicas em determinado contexto.
3. **O que você pode saber?** Uma regra de *audiência narrativa* determina quais fatos da história podem ser mostrados.

Um mestre pode ter tarefas editoriais autorizadas e, ainda assim, cada informação privada deve respeitar seu contrato de visibilidade.

~~~mermaid
flowchart TD
  A["Pessoa tenta acessar recurso"] --> B{"Está autenticada?"}
  B -->|Não| P["Somente conteúdo público"]
  B -->|Sim| C["Resolver perfil e grants"]
  C --> D{"Capability + scope corretos?"}
  D -->|Não| N["Ação negada"]
  D -->|Sim| E{"Conteúdo permite esta audiência?"}
  E -->|Não| N
  E -->|Sim| F["Recurso/ação autorizados"]
~~~

*Diagrama didático simplificado*: a implementação real acrescenta ownership, fronteiras server-side e políticas de banco, e pode diferir por operação.

## Exemplos sem dados privados

| Situação | O que esperar |
| --- | --- |
| Visitar campanha pública | Ver apenas a projeção editorial publicada |
| Fazer login sem grants | Continuar sem acesso a ferramentas privadas |
| Ser membro de uma campanha | Não ganhar automaticamente acesso às outras campanhas |
| Ter botão Edit visível | O servidor **ainda** precisa autorizar a operação |
| Estar autorizado tecnicamente | Não ganhar conhecimento narrativo que não pertence à sua audiência |
| Abrir um link com ID de outra campanha | O servidor deve negar ou ocultar o recurso; alterar URL não concede acesso |

## Conceitos importantes

- **Auth user:** identidade autenticada no provedor de login.
- **Profile:** identidade humana interna vinculada à conta.
- **Entity:** personagem, lugar ou outro elemento narrativo. Não é a própria conta.
- **Role:** conjunto administrado de capacidades.
- **Capability:** ação permitida (por exemplo, ler ou editar um recurso).
- **Scope:** onde a permissão vale: projeto, campanha, sessão ou recurso.
- **Audience:** público permitido para o conteúdo narrativo.

Os campos exatos e regras de migração pertencem ao contrato de identidade, não à Wiki.

## Para desenvolvedores: por que esconder um botão não basta?

O navegador não é a fronteira de segurança. Mesmo quando o menu esconde Edit, o servidor e as políticas de dados devem validar identidade, escopo e recurso antes de uma leitura ou alteração. A aplicação também deve **filtrar relações secretas antes de devolver o grafo**: esconder uma linha com CSS depois de enviá-la pode expor o segredo.

Na base PostgreSQL, **RLS** significa segurança por linha. Algumas tabelas são *deny-by-default* deliberadamente, sem policy de leitura aberta. Não acrescente regras amplas só para remover avisos de lint.

## Dúvidas frequentes

**Fiz login, mas não apareceu Edit.** Login prova identidade; não cria grant. Consulte quem administra as permissões da campanha.

**Posso compartilhar o link de um conteúdo privado?** O link não concede audiência ou autorização. Não use URLs privadas como prova de que o conteúdo se tornou público.

**É seguro colocar uma transcrição nesta Wiki?** Não. Exemplos devem ser sintéticos e sem dados pessoais, segredos narrativos, áudio ou trechos privados.

## Fontes verificadas

- [Identidade e autorização](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md)
- [RLS, RBAC, RPCs e grants](https://github.com/Faysk/tda/blob/main/docs/database/security.md)
- [Audiência narrativa](https://github.com/Faysk/tda/blob/main/docs/features/knowledge-audience.md)
- [Diretório público de campanhas](https://github.com/Faysk/tda/blob/main/docs/features/campaign-directory.md)
- [Fluxos e projeções seguras](https://github.com/Faysk/tda/blob/main/docs/architecture/data-flows.md)

Continue: [Usando o TDA](https://github.com/Faysk/tda/wiki/Usando-o-TDA) · [Modelo de dados](https://github.com/Faysk/tda/wiki/Banco-e-modelo-de-dados) · [Glossário](https://github.com/Faysk/tda/wiki/Glossario).
