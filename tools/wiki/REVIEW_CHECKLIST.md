# Aceite humano da GitHub Wiki — TDA

> **Status:** protocolo de validação, **ainda não executado na Wiki pública**. Parent: #1745; QA: #1760; publicação: #1761.

A fonte `wiki/` é um **candidato em PR**, não uma Wiki publicada. O validador automatizado garante somente invariantes que consegue observar em Markdown e nos ficheiros canônicos. Este roteiro exige pessoas reais ou revisores independentes para avaliar entendimento, acessibilidade e material visual.

## Dois aceites diferentes — não criar dependência circular

**Fase A — conteúdo antes da publicação.** O revisor humano lê a página na PR no SHA exato, compara com `docs/`, confirma segurança, maturidade e clareza e regista um parecer verificável. A Fase A pode acontecer **sem Wiki Git publicada** e desbloqueia o `editorial-gate.mjs --require-approved` somente depois das aprovações reais das páginas. O dossiê `tda-wiki-editorial-<checkout-sha>` organiza a revisão, mas não substitui a leitura.

**Fase B — smoke visual depois do push aprovado.** Um mantenedor publica por Git não-forçado e verifica o commit com readback. Só **depois** disso, executam-se as tarefas por persona, mobile/teclado/tema e validação real de Mermaid/SVG na interface da Wiki. Uma falha bloqueia o **aceite final da publicação**, exige correção e novo teste ou rollback; ela não autoriza marcar retrospectivamente a Fase A como realizada. Não fechar #1760/#1761 só porque o `git push` passou.

### Pré-requisitos da Fase A — fonte e conteúdo

- [ ] O artigo e a fonte canônica estão associados a um **SHA exato**, com `wiki:check` e `wiki:test` concluídos.
- [ ] Uma pessoa leu conteúdo e fontes, distinguiu vigente/planejado/publicado e verificou exemplos/segredos.
- [ ] O parecer da página está ligado a issue/PR, revisor, data e SHA-256 dos bytes efetivos; edição posterior exige novo aceite.
- [ ] Nenhum revisor, data ou sucesso foi inferido a partir dos testes automatizados.

### Pré-requisitos da Fase B — interface publicada

- [ ] A publicação autorizada ocorreu no Git **separado da Wiki**, com source SHA, Wiki commit, histórico e readback registados.
- [ ] Os testes são na **interface real** `github.com/Faysk/tda/wiki`, não apenas no preview da PR.
- [ ] Registar **commit Wiki + página + persona + viewport + tema + interação + resultado**, sem informação pessoal de campanha.
- [ ] Se houver capturas, são revisadas sem tokens, dados privados, conta pessoal ou lore restrita.
- [ ] Considerar o histórico de release: fonte integrada no Git não comprova funcionalidade em produção.

## Tarefas por público (Fase B)

| Persona | Tarefa sem ajuda oral | Onde deve chegar | O que reprova o teste |
| --- | --- | --- | --- |
| Iniciante, sem RPG/TI | Explicar o que é campanha e encontrar uma sessão pública | Home → Comece aqui → Campanhas e sessões | Precisa conhecer siglas ou não distingue ausência de sessão de erro |
| Jogador/visitante | Descobrir personagens e relações sem acreditar que fixtures sejam canon | Mundo e entidades → tutorial World Explorer | Confunde ligações visuais com relações publicadas |
| Usuário do Lembra | Saber onde guardar uma referência e para quem ela ficará visível | Lore/Lembra → Usar o Lembra → Permissões | Acredita que `Meus itens` ou campanha protege o conteúdo |
| Editor autorizado | Explicar o percurso Craig → run → assembly → revisão → publish | Da gravação à revisão → Edit | Interpreta `finished` como publicação automática ou canon |
| Operador local | Reconhecer diferença de retry, unpublish, delete e backup | Companion → Resultados locais e exclusão | Acredita existir Trash restaurável de 7 dias |
| Contribuidor | Localizar fonte canônica, ADR e testes de uma feature | Desenvolvimento → Arquitetura → ADRs | Sai sem saber que documento é autoridade ou confunde PR com release |
| Operador autorizado | Diagnosticar problema sem expor credenciais | Resolver problemas → runbook dono | Wiki orienta DDL, delete, service role ou bypass de autorização |

## Acessibilidade e clareza visual (Fase B)

Testar pelo menos **desktop amplo**, **mobile com largura próxima de 390 px** e **teclado sem mouse**; quando possível, com leitor de telas e tema claro/escuro do GitHub.

- [ ] A Home explica TDA na primeira região visível sem depender da imagem.
- [ ] `_Sidebar` e `_Footer` permitem voltar aos temas sem perder contexto.
- [ ] Toda figura tem alt e **informação textual equivalente**; Mermaid continua compreensível como texto narrativo.
- [ ] Não há tabela crítica ilegível sem alternativa textual em mobile.
- [ ] Headings seguem ordem lógica; ícones nunca são única indicação da categoria.
- [ ] Links distinguem claramente **guia**, **issue futura**, **fonte técnica** e **site público**.
- [ ] PDFs, vídeos ou screenshots não são exigidos para executar uma tarefa essencial.
- [ ] O GitHub Wiki renderiza as imagens oficiais externas e os blocos Mermaid como esperado. Caso não renderize, manter texto/fallback, corrigir a imagem e reexecutar.
- [ ] Não interpretar uma limitação do tema nativo do GitHub como defeito a resolver com CSS/JS custom.

## Precisão técnica por domínio (Fase A, revalidar na Fase B quando necessário)

- [ ] Feature catalog: diferenciar implementado/preparado/planejado de aplicado/publicado.
- [ ] Campanhas: IDs relacionais, técnicos e públicos não são intercambiáveis; privacidade não é contornada por URL.
- [ ] ASR: não identificar Agent API version com versão MSI/runtime; não criar nome de download fixo sem fonte verificada.
- [ ] Session Assembly: múltiplas sources, runs e overlaps preservam provenance sem dedupe conjectural.
- [ ] Transcrições: ASR → revisão → publish → canon são gates diferentes; flag e capability são exigências do contrato.
- [ ] World: filtering server-side, audience e fixtures não publicadas não viram narrativa verdadeira.
- [ ] Mídia: origem/hash/MIME/decode/readback e licença; Brand Pack não foi redesenhado.
- [ ] Dados: migration no Git ≠ schema aplicado; não expor runbooks privados.
- [ ] Release: CI/main ≠ Production, e rollback é operação governada separada.

## Como registrar os resultados, em separado

**Fase A — parecer editorial, antes da publicação:**

```text
Fase: A — revisão da fonte
Git SHA da fonte:
Página e SHA-256 dos bytes:
Revisor GitHub:
Data da leitura:
Documento(s) canônico(s) e estado de entrega verificados:
Clareza, privacidade e autorização:
Problemas encontrados e correções:
Parecer explícito: aprovado / requer correção
URL da evidência (issue/comentário):
```

**Fase B — smoke real após publicação:**

```text
Fase: B — GitHub Wiki publicada
Git SHA da fonte aprovada:
Wiki published commit:
Página e seção:
Persona:
Desktop/mobile + largura aproximada:
Tema e interação (teclado/mouse/leitor de tela):
Tarefa tentada:
Resultado observado:
Compreensão sem ajuda: sim / não / parcial
Problema reprodutível:
Correção proposta / rollback / issue:
```

**Aceite final exige as duas evidências reais.** Fase A não pode reivindicar renderização da Wiki antes do push; Fase B não substitui o parecer editorial sobre conteúdo. Se a Wiki ainda não está publicada, registre `Fase B: pendente`. A #1760 permanece aberta até o aceite por persona, sem confundir a conclusão do texto com a renderização real.

## Como manter após a publicação

Quando um documento de `docs/` mudar, execute `pnpm wiki:impact` em branch com `origin/main` disponível para identificar possíveis guias afetados. Use `pnpm wiki:coverage` para ver áreas sem links canônicos, sem confundir links com cobertura didática completa. Revisores dos domínios devem atualizar os guias apropriados ou registrar por que não precisam de alteração; publicar só via processo de #1761.
