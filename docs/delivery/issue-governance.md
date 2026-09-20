# Governança de Issues e Backlog

> Status: vigente
> Owner: produto / coordenação / delivery
> Última revisão: 2026-09-20
> Fonte de verdade: GitHub Issues de `Faysk/tda`, `docs/roadmap.md`, `docs/delivery/`, documentos donos e evidências vinculadas

Este documento define **como o TDA usa GitHub Issues para organizar trabalho**. A meta é manter um backlog pesquisável, priorizado e auditável sem criar uma segunda fonte de verdade para contratos, maturidade de features ou publicação.

A regra central é:

> **Roadmap decide direção e prioridade de produto; documentos donos definem contrato; Issues representam trabalho acionável; PRs representam mudanças candidatas; delivery/inventory registra estágio e evidência; runbooks e receipts comprovam publicação.**

Issues não substituem specs, ADRs, inventário de entregas nem histórico de deployments.

---

## 1. Por que esta governança existe

O TDA mistura trabalho de produto, Web, Companion local, ASR, banco, mídia, conteúdo narrativo, releases, segurança, documentação e auditorias. Sem uma taxonomia comum, o backlog tende a acumular:

- títulos inconsistentes;
- prioridades implícitas;
- bugs misturados com features planejadas;
- épicos sem filhos claros;
- dependências escondidas em comentários;
- issues antigas abertas sem decisão explícita;
- labels duplicadas com significados parecidos;
- “status” contraditório entre issue, roadmap, inventário e produção.

A governança abaixo evita isso sem transformar GitHub em burocracia.

---

## 2. Limites das Issues

### 2.1 O que deve virar Issue

Abrir Issue quando existir um **resultado observável** ou uma **decisão técnica verificável** a acompanhar, por exemplo:

- defeito reproduzível;
- feature ou melhoria aprovada;
- tarefa operacional ou de release;
- investigação com perguntas e saída definida;
- dívida técnica com impacto e critério de encerramento;
- trabalho de documentação ligado a uma mudança concreta;
- achado confirmado de auditoria;
- epic que coordena vários resultados independentes.

### 2.2 O que não deve virar Issue

Não criar Issue apenas para:

- guardar uma ideia sem decisão mínima;
- duplicar uma spec já dona do contrato;
- copiar checklist de uma auditoria sem achado;
- registrar conversa, hipótese solta ou lembrete pessoal;
- representar cada commit/arquivo;
- criar “status fake” de algo que já está no inventário de entregas;
- registrar feature futura como bug porque ainda não foi implementada.

Ideias imaturas ficam no documento de produto apropriado ou no roadmap até existir um resultado acionável.

---

## 3. Modelo de classificação

Cada issue aberta deve ser legível por cinco perguntas:

1. **O que é?** → `type:*`
2. **Onde atua?** → `area:*`
3. **Quão urgente é executar?** → `priority:*`
4. **Existe um estado excepcional relevante?** → `status:*`
5. **Veio de uma auditoria formal?** → `audit`

Não criar namespaces paralelos como `bug`, `fix`, `urgent`, `high`, `critical`, `backend` ou `frontend` se a informação já cabe na taxonomia canônica.

---

## 4. Labels canônicas

### 4.1 Família `type:*`

**Regra:** exatamente uma label `type:*` por issue após triage.

| Label | Uso |
| --- | --- |
| `type:bug` | comportamento implementado que viola contrato, expectativa ou invariante |
| `type:feature` | nova capacidade ou extensão funcional |
| `type:epic` | resultado amplo coordenando várias issues independentes |
| `type:ops` | operação, infraestrutura, configuração, migração operacional ou manutenção |
| `type:release` | corte, promoção, gate ou evidência de release |
| `type:test` | cobertura, harness, E2E, fixtures ou gates de teste |
| `type:docs` | documentação como resultado principal |
| `type:security` | hardening, autorização, segredo, assinatura ou risco de segurança |
| `type:performance` | custo, latência, throughput, memória, escala ou otimização |
| `type:investigation` | investigação cujo resultado é uma decisão/evidência, não implementação imediata |

`audit` **não é tipo**. Uma auditoria pode descobrir um bug, um gap de release, uma investigação ou uma feature planejada.

Evitar `type:task` enquanto os tipos acima forem suficientes. Se um padrão recorrente não couber neles, adicionar novo tipo somente após atualizar este documento.

### 4.2 Família `area:*`

**Regra:** pelo menos uma área; normalmente uma primária e no máximo uma secundária. Mais que duas áreas costuma indicar que a issue deveria ser um epic.

Áreas canônicas:

| Label | Boundary |
| --- | --- |
| `area:processing` | domínio ponta a ponta do processamento local |
| `area:processing-web` | `/edit/processamento`, conexão, submissão e UX Web |
| `area:companion` | Agent/Desktop, ASR, worker, runtime, MSI/updater |
| `area:transcripts` | sessões processadas, revisão, publicação e contratos editoriais |
| `area:auth` | login, sessão, capabilities, RBAC e scopes |
| `area:database` | PostgreSQL, migrations, RLS, grants, functions e integridade relacional |
| `area:sessions` | sessões públicas, participantes, resumos e navegação |
| `area:world` | World Explorer, relations, grafo, mapas e projections |
| `area:entities` | entities, NPCs, personagens, provenance e audience narrativa |
| `area:media` | Media Storage, R2, uploads, assets e delivery |
| `area:lore` | lores, conteúdo editorial e superfícies narrativas dedicadas |
| `area:design-system` | tokens, componentes, marca, acessibilidade e padrões visuais |
| `area:ux` | fluxos transversais de experiência e arquitetura de informação |
| `area:release` | pipeline, candidate, deploy, rollback e promoção |
| `area:governance` | branch protection, coordenação, políticas e backlog |
| `area:stats` | estatísticas, custo e métricas funcionais |

Criar nova `area:*` apenas quando ela representar **ownership durável**, não um arquivo, página isolada ou tecnologia temporária.

### 4.3 Família `priority:*`

**Regra:** toda issue acionável deve receber exatamente uma prioridade após triage. Epics puramente de índice e auditorias meta podem ficar sem prioridade se não competirem diretamente por execução.

| Label | Significado operacional |
| --- | --- |
| `priority:P0` | ação imediata; risco ativo grave de produção, segurança, perda/corrupção de dados ou gate que torna a próxima publicação insegura |
| `priority:P1` | caminho crítico, bloqueador de jornada/release ou invariante importante com impacto alto |
| `priority:P2` | problema importante, porém limitado, com workaround ou impacto não crítico |
| `priority:P3` | melhoria, manutenção ou otimização com baixa urgência |

Prioridade não é sinônimo de severidade técnica. Ela combina impacto, criticidade do caminho, risco e dependências.

Não inferir prioridade pela quantidade de testes, tamanho da issue, quantidade de código ou intensidade do texto.

### 4.4 `triage:needed`

Usar quando a issue ainda precisa de uma decisão de backlog, por exemplo:

- prioridade não definida;
- escopo atual precisa ser revalidado;
- issue antiga pode estar concluída, superseded ou reduzida;
- ownership/dependência não está claro;
- evidência atual é insuficiente para classificá-la.

`triage:needed` deve ser temporária. A revisão de backlog remove a label após a decisão.

### 4.5 Família `status:*`

Labels de status são **exceções**, não um segundo Kanban.

| Label | Uso |
| --- | --- |
| `status:blocked` | existe dependência externa/concreta que impede avanço |
| `status:planned` | direção aprovada, mas execução deliberadamente futura |

Não criar `status:in-progress`, `status:review`, `status:done` ou equivalentes. O estágio de entrega já pertence ao fluxo de `docs/delivery/workflow.md` e ao inventário operacional.

Quando GitHub dependency estiver disponível, registrar também a relação nativa `blocked by / blocking`. A label `status:blocked` continua útil para filtro visual, mas não substitui a dependência.

### 4.6 `audit`

Marca procedência: issue criada ou formalmente confirmada por uma auditoria.

Regras:

- `audit` não substitui `type:*`;
- o corpo deve apontar a auditoria/índice e baseline;
- fato, hipótese e limitação devem ficar separados;
- achado antigo revalidado pode receber `audit`;
- não aplicar apenas porque uma auditoria citou a issue sem confirmar seu conteúdo.

---

## 5. Paleta de cores

A cor comunica **família**, não significado completo. O texto da label continua sendo a fonte semântica.

| Família / label | Cor | Hex |
| --- | --- | --- |
| `priority:P0` | vermelho escuro | `#B60205` |
| `priority:P1` | laranja forte | `#D93F0B` |
| `priority:P2` | amarelo | `#FBCA04` |
| `priority:P3` | verde | `#0E8A16` |
| todos `type:*` | azul | `#1D76DB` |
| todos `area:*` | verde-azulado | `#0E8A7A` |
| `status:blocked` | roxo forte | `#7057FF` |
| `status:planned` | roxo claro | `#D4C5F9` |
| `triage:needed` | azul claro | `#C5DEF5` |
| `audit` | roxo escuro | `#5319E7` |

Princípio: prioridade deve “gritar” mais que tipo/área. Não usar vermelho para todo bug; um bug P3 não deve parecer mais urgente que uma task operacional P0.

### 5.1 Descrições recomendadas

- `type:bug`: “Implemented behavior violates a contract or expected invariant.”
- `type:feature`: “New or expanded product capability.”
- `type:epic`: “Parent outcome coordinating multiple independently closable issues.”
- `type:ops`: “Operational, infrastructure or maintenance work.”
- `type:release`: “Release candidate, promotion or release evidence.”
- `type:test`: “Test coverage, harness or quality gate.”
- `type:docs`: “Documentation is the primary deliverable.”
- `type:security`: “Security, authorization, signing or hardening work.”
- `type:performance`: “Performance, cost, throughput or resource optimization.”
- `type:investigation`: “Evidence-gathering work ending in a decision.”
- `triage:needed`: “Needs backlog decision: priority, scope, ownership or current relevance.”
- `status:blocked`: “Cannot progress until an explicit dependency is resolved.”
- `status:planned`: “Approved direction intentionally scheduled for a later slice.”
- `audit`: “Confirmed or created through an evidence-backed audit.”

---

## 6. Convenção de títulos

### 6.1 Formato novo

Usar preferencialmente:

```text
<verb>(<scope>): <objective>
```

Exemplos:

```text
fix(processing): align Web compatibility with supported Companion
feat(transcripts): publish approved revisions with atomic activation
test(processing): gate the current Web-to-Companion journey in CI
ops(media): migrate legacy lore assets to the immutable pipeline
investigate(companion): validate Qwen on Turing GPUs
release(companion): promote a physically accepted recovery candidate
docs(delivery): define issue and backlog governance
```

### 6.2 Prefixos recomendados

- `fix`
- `feat`
- `test`
- `ops`
- `release`
- `docs`
- `security`
- `perf`
- `investigate`
- `epic`
- `audit`
- `data`
- `content`

O prefixo melhora leitura humana; a label `type:*` continua sendo a classificação canônica.

### 6.3 Idioma

- título técnico: inglês;
- corpo e discussão: português, salvo necessidade específica;
- nomes de APIs, campos, arquivos, estados e mensagens reproduzidas preservam o idioma original.

Issues históricas não são renomeadas em massa. Ajustar título legado somente quando a issue for reaberta/retriada e a mudança melhorar de fato a compreensão.

---

## 7. Anatomia obrigatória de uma Issue

Toda issue nova deve ter informações suficientes para outra pessoa entender **por que existe, como termina e o que não prova**.

### 7.1 Núcleo comum

1. **Contexto / objetivo**
2. **Classificação e prioridade**
3. **Baseline / evidência**
4. **Problema ou resultado desejado**
5. **Comportamento esperado**
6. **Critérios de aceite verificáveis**
7. **Testes/evidências necessários**
8. **Dependências e relações**
9. **Documento/contrato dono**
10. **Limites / não objetivos**

### 7.2 Bug

Adicionar:

- fato confirmado;
- passos de reprodução;
- resultado observado;
- resultado esperado;
- impacto;
- ambiente/SHA/versão;
- frequência conhecida, se houver evidência;
- workaround, se houver;
- regressão que deve provar a correção.

Não usar “bug” para capacidade ainda não implementada por design.

### 7.3 Feature

Adicionar:

- problema do usuário/produto;
- resultado observável;
- contrato afetado;
- não objetivos;
- dependências;
- definição de pronto;
- impacto em dados, segurança, UX, publicação e rollback quando aplicável.

### 7.4 Investigação

Adicionar:

- perguntas que precisam ser respondidas;
- hipóteses separadas de fatos;
- método permitido;
- evidência esperada;
- decisão de saída.

Uma investigação fecha quando produz uma decisão/evidência, não quando “parece que entendemos”.

### 7.5 Release / operação

Adicionar:

- artefato/SHA/tag exatos;
- pré-requisitos;
- gates;
- evidência de CI;
- evidência física/ambiente quando exigida;
- rollback;
- receipt;
- o que **não** foi validado.

### 7.6 Achado de auditoria

Adicionar:

- auditoria/índice de origem;
- baseline e data;
- fato versus hipótese;
- reprodução sintética/segura;
- impacto;
- prioridade fundamentada;
- gate de aceite;
- testes;
- limitações;
- assuntos fora de fronteira.

---

## 8. Epics, sub-issues e dependências

GitHub suporta hierarquia por sub-issues e relações de dependência. Usar essas relações sempre que possível, em vez de depender apenas de listas de links.

### 8.1 Quando criar Epic

Criar `type:epic` quando:

- há um resultado de produto único;
- existem 3 ou mais entregas independentes;
- cada filho pode ser implementado/validado/fechado separadamente;
- o epic serve como coordenação, não como checklist técnico gigante.

O Epic deve conter:

- objetivo final;
- definição de sucesso;
- filhos;
- ordem/dependências;
- gates;
- itens explicitamente fora de escopo.

O Epic fecha somente quando o resultado global foi atingido ou quando foi formalmente substituído.

### 8.2 Sub-issues

Filhos devem:

- possuir critérios de aceite próprios;
- ter suas próprias labels;
- apontar para o parent;
- não repetir toda a descrição do epic;
- poder ser fechados independentemente.

### 8.3 Dependências

Usar dependência para representar causalidade real:

```text
#B blocked by #A
```

Não usar dependência apenas para dizer “é relacionado”.

Quando a dependência impedir trabalho atual, aplicar também `status:blocked`.

### 8.4 Auditoria não é automaticamente Epic de entrega

Uma issue de índice de auditoria coordena **evidência**, não necessariamente implementação. As issues resultantes podem pertencer a epics de produto diferentes.

---

## 9. Milestones

Milestone representa um **objetivo finito de entrega**, não área nem time.

Usar para:

- uma release Web;
- uma versão Stable do Companion;
- um marco de recuperação;
- um lote de produto com definição de concluído.

Não usar milestone para:

- “Frontend”;
- “Companion”;
- “Bugs”;
- backlog permanente;
- ideias futuras sem janela/resultado definido.

Uma issue deve pertencer a no máximo um milestone ativo.

Datas só entram quando forem compromisso real; não usar due date como palpite.

---

## 10. GitHub Projects

O TDA atualmente mantém `docs/delivery/inventory.md` como registro operacional único. Não criar um Project paralelo editável sem decidir qual fonte será canônica.

Se GitHub Projects for adotado no futuro:

- alinhar Status com `docs/delivery/workflow.md`;
- não duplicar Priority se Issues já carregam `priority:*`;
- usar views para filtro, não criar nova semântica;
- decidir explicitamente se Project substitui o inventário operacional ou apenas o projeta;
- registrar a mudança de ownership documental.

Views recomendadas:

- **Critical path** — P0/P1 abertos;
- **Blocked** — `status:blocked`;
- **Needs triage** — `triage:needed`;
- **Processing recovery** — epic e áreas processing/companion;
- **Editorial** — transcripts/entities/lore/world;
- **Release** — type release/ops + milestone ativo.

---

## 11. Triage

### 11.1 Entrada

Nova issue criada por formulário recebe tipo quando possível e `triage:needed`.

### 11.2 Triage mínima

Antes de remover `triage:needed`, confirmar:

- há exatamente um `type:*`;
- há pelo menos uma `area:*`;
- prioridade foi definida ou há justificativa para não competir por execução;
- duplicatas abertas e fechadas foram pesquisadas;
- parent/epic está correto;
- dependências estão explícitas;
- acceptance criteria existem;
- documento dono está identificado;
- planned não foi confundido com bug;
- evidência sensível não foi copiada para GitHub.

### 11.3 Revisão periódica

Na revisão do backlog, olhar nesta ordem:

1. `priority:P0`;
2. `priority:P1`;
3. `status:blocked`;
4. `triage:needed`;
5. epics ativos;
6. issues antigas sem evento recente;
7. issues cujo corpo já afirma que o objetivo foi entregue.

Não fechar automaticamente por idade.

---

## 12. Definition of Ready

Uma issue está **Pronta** quando possui:

- resultado observável;
- prioridade decidida;
- owner funcional conhecido;
- contrato/documento dono conhecido;
- dependências identificadas;
- dados/fixtures/ambiente permitidos;
- critério de aceite testável;
- nenhuma pergunta estrutural que obrigue outra investigação antes.

Issue sem isso fica em backlog/triage, não deve ser “puxada” só porque parece pequena.

---

## 13. Definition of Done

Uma issue só fecha como `completed` quando o escopo que ela prometeu foi realmente atingido.

Dependendo do tipo, isso pode exigir:

- patch integrado;
- testes no SHA exato;
- documentação dona atualizada;
- migration aplicada quando a issue prometia aplicação;
- smoke no ambiente real;
- receipt de release;
- hardware/artefato físico exato;
- evidência de rollback/recuperação.

Se publicação não pertence ao escopo da issue, declarar explicitamente e permitir fechamento após integração/aceite correspondente.

Nunca tratar:

- CI verde como deploy;
- merge como migration aplicada;
- RC publicado como Stable aceita;
- ASR concluído como transcript publicado;
- fixture como dado canônico;
- ausência de erro como evidência de aceite completo.

---

## 14. Fechamento e razões

### Completed

Acceptance criteria cumpridos no escopo declarado.

### Duplicate

Fechar com state reason de duplicate e link para a issue canônica.

### Not planned

Usar quando a decisão é não executar. Explicar por quê.

### Superseded

Fechar como not planned e apontar o sucessor/epic que assumiu o trabalho.

### Obsolete by architecture

Quando contrato mudou e a issue deixou de fazer sentido, registrar qual ADR/spec a tornou obsoleta.

Não deixar issue aberta apenas “para histórico”. GitHub já preserva issues fechadas.

---

## 15. Relação com PRs

Toda PR de implementação deve apontar a Issue dona quando existir.

Preferir:

```text
Closes #123
```

somente quando merge da PR realmente satisfizer a Definition of Done da issue.

Se a issue exige publicação, migration aplicada ou aceite físico posterior, usar relação não-closing:

```text
Refs #123
```

e fechar apenas após o gate final.

Uma Issue pode exigir várias PRs. Um PR pode resolver múltiplas issues somente quando o vínculo é explícito e o acceptance de cada uma foi realmente cumprido.

---

## 16. Relação com documentação e ADRs

Issue não é contrato durável.

Quando a implementação muda comportamento estrutural:

- atualizar documento dono na mesma PR;
- atualizar feature catalog/roadmap se maturidade ou prioridade mudarem;
- criar ADR para decisão estrutural de alto impacto;
- não copiar a spec completa para o corpo da Issue.

A Issue explica **o trabalho**; o documento dono explica **a regra que permanece válida depois que a Issue fecha**.

---

## 17. Relação com auditorias

Auditorias podem criar backlog, mas devem obedecer três regras:

1. pesquisar issue aberta, fechada e PR antes de criar;
2. reutilizar item existente quando o problema é o mesmo;
3. não promover hipótese a bug sem evidência.

Achados confirmados recebem `audit` e o tipo/área/prioridade normais.

Gaps deliberadamente futuros recebem `status:planned`, não são descritos como regressão.

Índices de auditoria permanecem separados de epics de implementação.

---

## 18. Segurança e privacidade

Nunca colocar em issue:

- tokens;
- secrets;
- `.env`;
- conteúdo privado de transcrição;
- áudio privado;
- dumps produtivos;
- dados pessoais desnecessários;
- paths locais sensíveis se não forem necessários.

Reproduções devem usar fixtures sintéticas e informações sanitizadas sempre que possível.

Issue pública não é cofre, meus consagrados.

---

## 19. Filtros operacionais recomendados

### Prioridade alta

```text
is:issue is:open label:"priority:P0"
is:issue is:open label:"priority:P1"
```

### Aguardando triage

```text
is:issue is:open label:"triage:needed"
```

### Bloqueados

```text
is:issue is:open label:"status:blocked"
```

### Bugs do Companion

```text
is:issue is:open label:"type:bug" label:"area:companion"
```

### Processamento Web

```text
is:issue is:open label:"area:processing-web"
```

### Auditoria ainda aberta

```text
is:issue is:open label:audit
```

### Features planejadas

```text
is:issue is:open label:"type:feature" label:"status:planned"
```

---

## 20. Política para issues antigas

Não fazer uma “higienização cosmética” que apague contexto histórico.

Migração incremental:

1. adicionar `type:*`;
2. adicionar `area:*`;
3. marcar `triage:needed` quando prioridade/relevância atual não estiver comprovada;
4. aplicar `status:blocked` somente com bloqueio explícito;
5. fechar completed/duplicate/superseded quando houver evidência suficiente;
6. não renomear em massa por idioma ou estilo;
7. ao tocar uma issue antiga novamente, adequar seu corpo ao padrão atual na medida útil.

---

## 21. Estado observado em 20/09/2026

Na revisão que originou este documento:

- o repositório possui Issues habilitadas;
- o owner é uma conta pessoal (`Faysk`), não uma GitHub Organization;
- por isso Issue Types e Issue Fields organizacionais não são a base escolhida neste momento;
- o backlog aberto foi classificado com `type:*` e `area:*`;
- prioridades confirmadas da auditoria receberam `priority:*`;
- itens antigos ou sem decisão explícita de prioridade receberam `triage:needed`;
- bloqueios explicitamente documentados receberam `status:blocked`;
- gaps deliberadamente futuros usam `status:planned`;
- achados da rodada focada usam `audit`;
- a paleta de cores e descrições é sincronizada por `.github/workflows/label-governance.yml` usando `tools/github/sync-issue-labels.mjs`; o workflow cria labels canônicas ausentes e corrige metadados divergentes na `main`.

Se o repositório migrar para uma Organization no futuro, reavaliar Issue Types e Issue Fields nativos antes de duplicar a taxonomia.

---

## 22. Governança da taxonomia

A definição executável das labels vive em `tools/github/sync-issue-labels.mjs` e deve permanecer equivalente a esta seção. Mudança de nome, cor ou descrição canônica atualiza **documento + script na mesma PR**; o workflow `Label Governance` reconcilia o GitHub após integração em `main`.

Alterar labels canônicas somente quando:

- existe caso recorrente não representado;
- o novo valor melhora busca/ownership;
- não duplica informação de outro campo;
- o benefício compensa migração;
- este documento é atualizado junto.

Evitar explosão de labels. Como regra prática:

- tipos: poucos e estáveis;
- áreas: boundaries duráveis;
- prioridades: quatro;
- statuses: somente exceções;
- provenance: mínimo necessário.

---

## 23. Checklist de manutenção do backlog

### Semanal / após rodada grande

- [ ] revisar P0/P1;
- [ ] revisar bloqueados;
- [ ] esvaziar `triage:needed` sempre que houver evidência;
- [ ] verificar epics e filhos;
- [ ] fechar duplicatas/superseded;
- [ ] conferir issues antigas com objetivo já entregue;
- [ ] conferir milestones/release gates ativos;
- [ ] garantir que novas issues possuem type/area;
- [ ] checar se planned foi confundido com bug;
- [ ] checar se PRs fecham issues cedo demais;
- [ ] preservar documentos donos e inventário como fontes canônicas.

### Antes de release

- [ ] filtrar P0/P1 do milestone/caminho;
- [ ] conferir `status:blocked`;
- [ ] confirmar issues de release/gates;
- [ ] ligar PR/SHA/CI/receipt;
- [ ] não fechar item que exige evidência física ou operacional ainda ausente.

---

## 24. Referências

Documentação interna:

- [Gestão de entregas](README.md)
- [Fluxo de entregas](workflow.md)
- [Inventário de entregas](inventory.md)
- [Composição de candidato](release-candidate.md)
- [Roadmap](../roadmap.md)
- [Catálogo de features](../feature-catalog.md)
- [Documentação viva](../documentation/README.md)
- [Publicação controlada](../releases.md)

GitHub:

- Issues: https://docs.github.com/en/issues/tracking-your-work-with-issues/learning-about-issues/about-issues
- Projects best practices: https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/best-practices-for-projects
- Issue templates/forms: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates
- Issue form syntax: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
