# Edit Workbench — área administrativa do TDA

> Status: arquitetura aprovada; implementação incremental em andamento
> Owner: Edit / produto + frontend
> Última revisão: 2026-09-07

## Objetivo

O **Edit** é a superfície administrativa do TDA. Ele existe para transformar estado bruto, derivado ou pendente de revisão em conteúdo confiável, organizado, auditável e publicável sem misturar responsabilidades de visitante, jogador e operador editorial.

Princípio transversal do Design System:

> **Visitante vê história; editor vê estado editorial.**

O Edit não é um CRUD genérico do banco. É uma estação de trabalho orientada a tarefas editoriais e administrativas.

## Escopo inicial

O primeiro ciclo de implementação cobre, nesta ordem:

1. shell e navegação administrativa;
2. sessões;
3. transcrição por sessão;
4. correção de texto/speaker e estado de revisão;
5. revisão assistida e operações em lote;
6. acessos/permissões;
7. conteúdo e mídia relacionados;
8. histórico/auditoria;
9. refinamento de performance, teclado e acessibilidade.

Outros domínios podem ganhar superfícies no Edit depois, mas devem preservar seus próprios contratos de domínio.

## Fontes de verdade

- **produto/arquitetura vigente:** `Faysk/tda`;
- **schema vigente:** Supabase documentado em `docs/database/`;
- **identidade visual:** TDA Design System oficial;
- **comportamento histórico a recuperar:** `Faysk/dnd-scribe`, sempre classificado como referência histórica e revalidado antes de virar contrato atual.

A matriz de paridade fica em [Edit — paridade com o legado](../legacy/edit-parity.md).

## Modelo mental de UX

O Edit deve funcionar como uma **workstation**, não como uma sequência de formulários isolados.

A composição pode variar por breakpoint e domínio, mas deve preservar três responsabilidades:

```text
navegação/contexto  ->  área de trabalho  ->  inspector/estado/ações
```

Em desktop amplo, isso pode assumir três regiões simultâneas. Em telas menores, inspector e navegação podem virar drawers/painéis sem alterar o modelo conceitual.

### Objetivos de interação

- contexto da campanha/sessão sempre identificável;
- ação principal visível sem caça ao botão;
- edição rápida sem trocar de página desnecessariamente;
- estado de salvamento explícito e discreto;
- erros recuperáveis sem perder o trabalho;
- navegação por teclado para tarefas repetitivas;
- filtros e seleção preservados durante a sessão de trabalho quando possível;
- deep links para recursos relevantes;
- confirmação apenas em ações realmente destrutivas.

## Transcrição: primeiro fluxo crítico

O editor de transcrição deve permitir trabalhar em segmentos sem perder lineage de evidência.

Capacidades mínimas:

- visualizar segmentos ordenados temporalmente;
- identificar speaker/participant/track quando disponíveis;
- editar texto;
- corrigir speaker/apresentação compatível com o modelo vigente;
- alterar estado de revisão;
- navegar entre segmentos rapidamente;
- filtrar pendências/revisão;
- preservar timestamps e referências de origem;
- registrar mudanças críticas conforme política de auditoria;
- impedir que output novo de processamento sobrescreva silenciosamente revisão humana.

Estados históricos de revisão revalidados para a migração inicial:

- `pending`;
- `approved`;
- `needs_review`;
- `discarded`.

A permanência física desses valores no schema futuro não é garantida; qualquer normalização deve preservar a semântica e ser versionada.

## Salvamento e concorrência

Edição rápida exige autosave, mas autosave ingênuo pode gravar respostas fora de ordem.

Exemplo do problema:

```text
A inicia save
B inicia save depois
B termina primeiro
A termina depois e sobrescreve B
```

Contrato do Edit:

- cada recurso editável deve possuir estratégia explícita contra writes fora de ordem;
- preferir revision/version otimista quando o storage permitir;
- alternativamente usar fila serial por recurso no cliente combinada com validação server-side;
- conflito conhecido não deve ser tratado como sucesso;
- a UI deve distinguir `clean`, `dirty`, `saving`, `saved`, `error` e `conflict`;
- não disparar toast de sucesso a cada autosave.

### Estado local e recuperação do transcript

O editor deve preservar o trabalho local mesmo quando o request falha ou quando o servidor detecta concorrência.

Regras de UX vigentes:

- `dirty` é derivado da diferença entre snapshot salvo e rascunho local;
- iniciar save captura um snapshot imutável do rascunho enviado;
- o usuário pode continuar editando durante `saving`;
- se o save anterior concluir depois de uma edição local mais nova, apenas o snapshot salvo avança; o rascunho mais novo permanece `dirty` e nunca é apagado pela resposta antiga;
- `error` mantém o rascunho e oferece retry do mesmo conteúdo atual;
- `conflict` mantém o rascunho, bloqueia retry cego e exige nova leitura/reconciliação antes de outro write canônico;
- `Esc` desfaz apenas mudanças locais que ainda não estão em voo;
- o adapter unsafe existente continua sendo o único write temporário até a troca deliberada para a mutation canônica; este contrato de UX não cria gravação paralela.

A coluna física `transcript_segments.revision` já existe. A integração definitiva de `conflict` depende do boundary atômico da issue #32 retornar conflito real e da leitura autorizada fornecer a revision vigente. Até isso acontecer, a UI pode modelar e testar o estado de conflito, mas não deve simulá-lo como se tivesse vindo do banco.

Detalhes estruturais estão em [arquitetura do Edit](../architecture/edit-workbench.md).

## Permissões

O Edit consome o modelo canônico de **capability + scope**.

Regras:

- a UI pode esconder/desabilitar ação por capability, mas isso é UX, não segurança;
- toda mutation precisa validar novamente identidade, capability, scope e ownership/campaign no boundary server-side;
- não codificar regras como `role === "master"` quando uma capability expressa a intenção;
- acesso a transcrição não implica edição;
- edição não implica gestão de permissões;
- capacidade administrativa global não deve ser inferida apenas por participação narrativa.

Capabilities históricas observadas no legado, ainda sujeitas à validação contra o catálogo físico vigente:

- `campaign.transcript.read`;
- `campaign.content.edit`;
- `campaign.permissions.manage`.

Não criar capability nova por conveniência antes de conferir `permission_catalog` e documentar a necessidade.

## Acessibilidade e teclado

A densidade administrativa não reduz os requisitos de acessibilidade.

Mínimos:

- foco visível pelo token oficial;
- controles essenciais delimitados com `--ds-control-border`;
- labels programáticas;
- feedback de erro associado ao campo/recurso;
- ações por teclado equivalentes às ações de ponteiro;
- atalhos não devem capturar digitação dentro de inputs/editors sem contexto.

Mapa atual do transcript:

| Ação | Atalho |
| --- | --- |
| segmento anterior/próximo | `↑` / `↓` fora de campos editáveis |
| editar texto do segmento atual | `Enter` fora de campo editável |
| editar speaker | `S` fora de campo editável |
| marcar `needs_review` no rascunho | `Shift + Enter` fora de campo editável |
| salvar rascunho | `Ctrl/Cmd + Enter` |
| desfazer mudanças locais | `Esc` quando não há save em voo |
| command palette | `Ctrl/Cmd + K` planejado; não implementado neste slice |

## Design System

O Edit não cria um segundo design system.

Usar tokens, primitives, tipografia e padrões do TDA. Componentes novos só sobem para `src/components/ui` quando forem realmente genéricos. Componentes específicos do domínio ficam em `src/features/...`.

Primitives candidatas, se a repetição real justificar:

- `DataTable`;
- `Inspector`;
- `CommandBar`;
- `EditableField`;
- `SplitPane`;
- `Toolbar`;
- `ConfirmationDialog`;
- extensões de `StatusPill/StatusBadge`.

Nenhuma delas deve ser criada apenas para antecipar um futuro hipotético.

## Performance

Direção:

- server-first para carregamento e autorização;
- Client Components apenas onde interação exigir;
- queries estreitas por tarefa;
- paginação/cursor para listas extensas;
- mutations granulares;
- lazy loading de painéis secundários;
- virtualização apenas quando medidas demonstrarem necessidade.

`transcript_segments` possui dezenas de milhares de linhas no schema observado; o Edit nunca deve carregar a transcrição inteira da campanha por conveniência.

## Estados obrigatórios por tela

Toda superfície administrativa deve definir, quando aplicável:

- loading;
- vazio;
- sucesso;
- erro recuperável;
- sem autorização;
- recurso removido/não encontrado;
- conflito de concorrência;
- operação destrutiva em andamento.

## Critério de aceite por slice

Um slice do Edit só é considerado concluído quando possui:

- comportamento funcional;
- autorização server-side;
- tratamento de loading/empty/error quando aplicável;
- teste de domínio/mutation e casos negativos relevantes;
- acessibilidade básica validada;
- documentação atualizada na mesma PR;
- paridade do legado marcada como `preservado`, `adaptado`, `substituído` ou `descartado` com justificativa.

## Não objetivos

- recriar a navegação do `dnd-scribe` pixel a pixel;
- expor tabelas Supabase como CRUD automático;
- transportar endpoints CommonJS antigos para o App Router sem redesenho;
- usar role name como regra de autorização;
- misturar controles editoriais nas superfícies públicas;
- fazer big-bang rewrite de toda a administração antes de validar slices verticais.

## Ordem de entrega recomendada

A migração é vertical e incremental:

```text
contrato + shell
  -> sessões
  -> transcript read/edit
  -> revisão + bulk
  -> acessos
  -> conteúdo/mídia
  -> auditoria/histórico
  -> otimização e acabamento
```

A prioridade do primeiro ciclo é recuperar a utilidade prática do editor antigo com arquitetura, segurança e UX do reboot atual.
