# Fluxo de entregas

> Status: preparado
> Owner: Prancheta - Organização de entregas; execução por Polvo - Coordenação
> Última revisão: 2026-09-07
> Fonte de verdade: política proposta neste documento; estado em inventory.md

## Método escolhido

Kanban leve se adapta à chegada irregular de correções, às dependências entre especialidades e à publicação deliberada do TDA. Não adotar sprints, pontos, reuniões diárias ou meta de utilização. A unidade de trabalho é um resultado observável, não uma conversa: uma tarefa pode entregar vários recortes, e um recorte pode depender de várias PRs. O [inventário](inventory.md) mostra o quadro real; a proposta de [candidato](release-candidate.md) conecta os recortes ao produto.

O [Kanban Guide, maio de 2025](https://kanbanguides.org/the-kanban-guide/) fundamenta fluxo explícito, controle de WIP e acompanhamento de idade, tempo de ciclo e entregas concluídas. Os limites e cadências abaixo são escolhas iniciais do TDA, não números prescritos pelo guia. A expectativa de serviço ainda não tem amostra confiável; por enquanto há prazo de revisão de bloqueios, não promessa estatística de entrega. É uma adoção progressiva, ainda sem SLE calibrada.

## Quadro e transições

As colunas são estados de trabalho e reutilizam a [taxonomia oficial](../documentation/README.md). “Validado” recebe qualificadores de escopo, sem criar outra taxonomia de maturidade.

| Coluna | Entrada e evidência de saída | Quem confirma a passagem |
| --- | --- | --- |
| Backlog | Objetivo e vínculo ao marco; para sair: prioridade confirmada no roadmap, dono, contrato e dependências identificados | Polvo com dono do produto |
| Pronto | Critérios de início completos e capacidade disponível; sair quando houver primeiro trabalho observável registrado | Dono do recorte |
| Em execução | Implementação local/branch; sair com artefato revisável, PR/SHA e limites declarados | Dono do recorte |
| Em validação/revisão | Instalação/checks aplicáveis no SHA exato; revisão técnica e de contrato; resultados isolados separados dos ensaios conjuntos | Dono entrega evidência; Lupa revisa riscos sem duplicar execução |
| Pronto para integrar | CI terminal, revisão e dependências do lote resolvidas; sair após integração identificável e validação do conjunto | Polvo |
| Integrado/aguarda publicação | SHA canônico e ensaio conjunto registrados; sair somente pelo runbook, com autorização e evidência do ambiente | Polvo prepara; Foguete - Publicação registra operação autorizada |
| Publicado/concluído | Resultado observável no ambiente e recibo operacional; documentação pura termina com integração aceita, marcada “publicação não aplicável” | Dono operacional e produto |

Bloqueado é marcador sobre a coluna original: motivo, detectado em, próximo passo, responsável e próxima revisão. Não retirar do WIP para esconder espera. Correção que retorna à execução mantém o mesmo ID, abre evento de retrabalho e invalida apenas as provas afetadas. Encerrado/substituído exige motivo e sucessor; não conta como resultado entregue. Uma PR verde pode permanecer bloqueada por contrato, conteúdo, OAuth ou integração.

### Critérios para iniciar

Resultado demonstrável; responsável único pelo recorte e revisor/consumidores identificados; arquivos e contrato donos combinados; dependência com versão ou comportamento esperado; fixture permitida e ambiente viável; testes de aceite e limites explícitos; possibilidade de abrir PR e executar checks verificada; nenhuma mudança remota inferida. Para SQL, Cofrinho decide o contrato único; consumidores não abrem RPC/migration paralela. Para conteúdo, origem e autorização editorial precisam estar identificadas.

### Critérios para concluir

Artefato/PR/SHA ou documento integrado; testes realmente executados e falhas/skips; prova do caminho padrão do usuário; integração com dependências na versão exata; documentação dona atualizada e indexada; bloqueios residuais com responsável; publicação/aplicação comprovada ou explicitamente não aplicável ao recorte. “Fundação local entregue” não fecha o marco “transcrição processada, importada e editada”. Testes com Auth stub não fecham acesso real; migration integrada não comprova aplicação.

## Limites iniciais propostos de trabalho em andamento

Proposta para experimentar por duas revisões semanais, com ajuste baseado em espera observada. Estes números são uma política inicial de fluxo, **não capacidade medida**, histórico de produtividade ou previsão de entrega.

| Controle | Limite inicial | Como aplicar |
| --- | --- | --- |
| Resultado em execução por dono | 1 | Vários arquivos/PRs do mesmo resultado não liberam outra vaga |
| Recortes iniciados e ainda não encerrados | 8 no total | Inclui bloqueados, revisão e espera de publicação; documentação e operação contam se forem recortes ativos |
| Validação/revisão ativa | 3 dentro do total | Dar preferência aos que destravam outros; demais aguardam na mesma coluna |
| Lote em integração/homologação | 1 dentro do total | Um conjunto de SHAs congelados e um dono; não testar várias combinações sem registro |
| Emergência produtiva | 1, exceção explícita | Polvo registra impacto, item pausado e expiração na próxima revisão; não criar fila de urgências |

Se um corte do inventário exceder o limite proposto, preservar todo trabalho atual, marcar o excedente e evitar puxar novo trabalho comparável até reduzir a fila; não encerrar artificialmente nem descartar branches para atingir o número. O limite não redistribui implementação, não cancela paralelismo já autorizado e não deve ser usado para inferir produtividade. Dentro do limite experimental, preservar o caminho Discord/local/Edit e a evolução Pipipi; grafo/cinemáticas seguem seus contratos enquanto não competirem com a convergência. Polvo confirma a ordem com o roadmap.

## Rotina mínima e handoff

Atualização assíncrona apenas após artefato, mudança de gate, bloqueio ou decisão. Formato: `ID | objetivo | PR/SHA | evidência nova e seu escopo | dependência/bloqueio | próximo responsável | integrado/publicado`. Mensagem entregue não é decisão aceita. Erro “already responding” ou timeout fica como handoff pendente, sem insistência repetida.

Uma revisão semanal de até 20 minutos (ou equivalente assíncrono), conduzida por Polvo: olhar itens mais antigos/bloqueados, conferir capacidade e prioridades com o produto, escolher o próximo resultado a concluir e revisar uma falha de coordenação. O tempo é orçamento proposto para a reunião, não medição de esforço. Bloqueio no caminho crítico é revisto no próximo dia útil ou antes da próxima integração, o que ocorrer primeiro. Não criar automação nesta proposta.

Antes de um lote: fixar base e heads, reconciliar arquivos/contratos, conferir evidência de cada dependência e executar ensaio conjunto. Mudança de head reabre os gates afetados. Ao encerrar: um handoff com fatos novos e próximo dono. Não reativar tarefa concluída só para atualização ou elogio.

## GitHub Projects: modelo, sem novo quadro

A [documentação oficial do GitHub](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects) descreve tabelas, quadros, roadmap e campos personalizados integrados a issues/PRs. Seria útil como visualização, mas a consulta atual `gh project list --owner Faysk` falhou por falta de `read:project`: existência de quadro é **não disponível**, não “nenhum”. Nenhum novo quadro ou serviço foi criado; não ampliar permissões nesta entrega.

Modelo concreto se o dono decidir adotá-lo após inspecionar os existentes: item = recorte com ID do inventário; campos Resultado, Marco, Dono, Status (colunas acima), Bloqueado, Próximo gate, PR, SHA, Evidência, Dependência, Candidato, Ambiente, Data de entrada. Vistas: “Fluxo” agrupado por Status, “Bloqueios” filtrado por Bloqueado, “Próxima entrega” filtrado por Candidato, “Backlog” ordenado pela prioridade do roadmap. PR fechada não move automaticamente para Publicado. Antes de migração, escolher uma única fonte de status e tornar a outra somente leitura/link; não manter edições independentes em Projects e Markdown. Por ora, o inventário Markdown é suficiente e revisável.
