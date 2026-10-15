# Aceite humano da GitHub Wiki — TDA

> **Status:** protocolo de validação, **ainda não executado na Wiki pública**. Parent: #1745; QA: #1760; publicação: #1761.

A fonte `wiki/` é um **candidato em PR**, não uma Wiki publicada. O validador automatizado garante somente invariantes que consegue observar em Markdown e nos ficheiros canônicos. Este roteiro exige pessoas reais ou revisores independentes para avaliar entendimento, acessibilidade e material visual.

## Antes de iniciar

- [ ] A edição avaliada está associada a um SHA exato, com `wiki:check` e `wiki:test` concluídos.
- [ ] A Wiki foi publicada de forma aprovada no Git separado, com commit Wiki registrado e histórico preservado.
- [ ] Os testes ocorrem na **interface real** `github.com/Faysk/tda/wiki`, não só em preview de Markdown da PR.
- [ ] Registe **versão da página + persona + tamanho de tela + tema + resultado**, sem copiar dados de usuário/campanha.
- [ ] Se a página precisar mostrar UI real, use captura revisada sem texto privado, conta pessoal, token ou detalhe de campanha não público.
- [ ] Considere o histórico de release: uma fonte integrada no Git não prova funcionalidade em produção.

## Tarefas por público

| Persona | Tarefa sem ajuda oral | Onde deve chegar | O que reprova o teste |
| --- | --- | --- | --- |
| Iniciante, sem RPG/TI | Explicar o que é campanha e encontrar uma sessão pública | Home → Comece aqui → Campanhas e sessões | Precisa conhecer siglas ou não distingue ausência de sessão de erro |
| Jogador/visitante | Descobrir personagens e relações sem acreditar que fixtures sejam canon | Mundo e entidades → tutorial World Explorer | Confunde ligações visuais com relações publicadas |
| Usuário do Lembra | Saber onde guardar uma referência e para quem ela ficará visível | Lore/Lembra → Usar o Lembra → Permissões | Acredita que `Meus itens` ou campanha protege o conteúdo |
| Editor autorizado | Explicar o percurso Craig → run → assembly → revisão → publish | Da gravação à revisão → Edit | Interpreta `finished` como publicação automática ou canon |
| Operador local | Reconhecer diferença de retry, unpublish, delete e backup | Companion → Resultados locais e exclusão | Acredita existir Trash restaurável de 7 dias |
| Contribuidor | Localizar fonte canônica, ADR e testes de uma feature | Desenvolvimento → Arquitetura → ADRs | Sai sem saber que documento é autoridade ou confunde PR com release |
| Operador autorizado | Diagnosticar problema sem expor credenciais | Resolver problemas → runbook dono | Wiki orienta DDL, delete, service role ou bypass de autorização |

## Acessibilidade e clareza visual

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

## Precisão técnica por domínio

- [ ] Feature catalog: diferenciar implementado/preparado/planejado de aplicado/publicado.
- [ ] Campanhas: IDs relacionais, técnicos e públicos não são intercambiáveis; privacidade não é contornada por URL.
- [ ] ASR: não identificar Agent API version com versão MSI/runtime; não criar nome de download fixo sem fonte verificada.
- [ ] Session Assembly: múltiplas sources, runs e overlaps preservam provenance sem dedupe conjectural.
- [ ] Transcrições: ASR → revisão → publish → canon são gates diferentes; flag e capability são exigências do contrato.
- [ ] World: filtering server-side, audience e fixtures não publicadas não viram narrativa verdadeira.
- [ ] Mídia: origem/hash/MIME/decode/readback e licença; Brand Pack não foi redesenhado.
- [ ] Dados: migration no Git ≠ schema aplicado; não expor runbooks privados.
- [ ] Release: CI/main ≠ Production, e rollback é operação governada separada.

## Como registrar um resultado

Use uma issue ou comentário na PR com o seguinte **modelo**, substituindo campos sem incluir dados pessoais:

```text
Wiki source SHA:
Wiki published commit:
Página e seção:
Persona:
Desktop/mobile + largura aproximada:
Tema e interação (teclado/mouse/leitor de tela):
Tarefa tentada:
Resultado observado:
Compreensão sem ajuda: sim / não / parcial
Problema reprodutível:
Fonte canônica relevante:
Correção proposta / issue:
```

**Aceite final exige evidence real**, não só todos os itens marcados manualmente no Markdown. Se a Wiki ainda não está publicada, o resultado deve dizer **pendente**. A #1760 permanece aberta até as jornadas e QA editorial serem demonstrados.

## Como manter após a publicação

Quando um documento de `docs/` mudar, execute `pnpm wiki:impact` em branch com `origin/main` disponível para identificar possíveis guias afetados. Use `pnpm wiki:coverage` para ver áreas sem links canônicos, sem confundir links com cobertura didática completa. Revisores dos domínios devem atualizar os guias apropriados ou registrar por que não precisam de alteração; publicar só via processo de #1761.
