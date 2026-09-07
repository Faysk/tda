# Medição de esforço e qualidade

> Status: preparado
> Owner: Prancheta - Organização de entregas
> Última revisão: 2026-09-07
> Fonte de verdade: eventos/artefatos identificados no inventário; números abaixo têm escopo declarado

## O que é possível afirmar

| Medida | Fonte e limite |
| --- | --- |
| Calendário de PR | `createdAt` e `mergedAt` do GitHub permitem medir abertura → merge; não incluem toda implementação, aceite ou publicação |
| Execução observável | Um job CI tem início/fim; é tempo de máquina daquele job, não horas humanas nem tempo total de trabalho |
| Espera/bloqueio | Há falhas de limite de uso e handoffs recusados nas tarefas; início efetivo de toda espera não foi registrado; duração total não disponível |
| Retrabalho | Mudança corretiva e teste que a motivou podem ser ligados; esforço gasto não disponível |
| Estimativas | Não há estimativa aceita por tarefa nem histórico homogêneo; data de entrega/SLE não disponível |
| Horas humanas, tokens, custos, produtividade, velocidade por pessoa | Não disponível; nenhuma inferência a partir de mensagens, commits, número de testes ou duração de turno |

Exemplo reproduzível de execução de máquina: [run 34158644919](https://github.com/Faysk/tda/actions/runs/34158644919), SHA `97ad16aec121e782eb12a8191508466ef6d79bd6`, job `transcript-import-postgres`: 20:14:36Z → 20:15:03Z em 2026-09-07, **27 segundos de calendário do job**, incluindo setup; não mede esforço de desenvolvimento. A suíte informou 6 testes aprovados/1 falho e 11,51 s internos. Não somar jobs paralelos para obter calendário. A situação atual da PR fica no [inventário](inventory.md); este exemplo histórico continua válido se o head mudar.

As avaliações locais `task-evaluation-2026-09-07.md` e `task-feedback-2026-09-07.json` registram observações e tentativas de handoff anteriores. Não são telemetria nem prova atual de produtividade. Fontes de tarefas acessíveis podem ter saída truncada, turnos sem mensagens ou timeouts; ausência de retorno não é ausência de trabalho.

## Feedback sustentado, sem ranking

| Observação com fonte | Consequência e ajuste verificável |
| --- | --- |
| Catraca / #59: browser real revelou Origin null no formulário; Lupa registrou revisão | Usar clique real como aceite do início OAuth; manter callback/profile como outro gate. Erro anterior de coordenação: smoke HTTP apresentado como fluxo funcional |
| Carteiro / #61 e comparação #62: fixture do exporter revelou divergências que CI web não cobre | Cofrinho registra contrato único e exige a mesma fixture sobre SQL final. Coordenação deve combinar dono antes de iniciar migrations concorrentes; novo SHA invalida verde anterior |
| Painelzinho / tarefa: recuperação pós-commit e readback foram exercitados em browser/serviço/PostgreSQL sintético | Preservar prova e seus SHAs; explicitar Auth stub e repetir no contrato final. Não perder a evidência existente nem promovê-la a OAuth real |
| Rabisco/Polvo / Production #003: helper testado com manifesto injetado não detectou registry runtime vazio | Verificar resultado default e diversidade real das 11 imagens. Responsabilidade compartilhada de revisão e integração, não falha atribuída só ao implementador |
| Tranca / #44: apoio com duas conexões supriu limite do teste originalmente sequencial, registrado na avaliação local | Levar cenário concorrente ao critério de início. Schema mínimo sintético não representa todo Supabase |
| Marreta / #26/#45: correções de lockfile/lint/a11y fecharam gates isolados, segundo avaliação e CI dos heads integrados | Verificar instalação frozen cedo; conservar limite de conteúdo/projection real. Não reativar apoio encerrado só para elogio |
| Pipoca/Claquete/Espaguete/Parafuso: tarefas mostram artefatos e testes parciais antes de falha de limite de uso | Retomar do checkpoint pelos donos quando houver capacidade, sem recriar trabalho. Falha externa não justifica classificação de baixa produtividade |
| Rabisco / #55 e acordo de ownership: documentação geral e entregas têm donos e arquivos distintos | Regenerar catálogo compartilhado sobre base final; não copiar tabelas de status para roadmap e outros documentos |

Gambiarra, Cuscuz e Bússola: leitura atual expirou; qualidade/entrega individual **não avaliável com as fontes acessíveis**. Para os demais recortes sem novo resultado, preservar evidência no inventário, sem nota automática. Avaliar adequação ao escopo e limites, não comparar tarefas heterogêneas.

## Coleta prospectiva simples

Na própria linha do inventário, registrar eventos apenas quando mudarem: `data UTC | recorte | de → para | motivo | PR/SHA ou evidência | dono`. Para bloqueio, adicionar aberto/fechado e próximo responsável; para retrabalho, ligar falha e correção. Atualização de status é registro operacional, não timesheet. Se houver medição humana voluntária, mantê-la identificada e separada do tempo de máquina; não reconstruí-la retrospectivamente.

Definir “iniciado” como primeiro trabalho observável após entrada em Pronto; “terminado” como resultado publicado/aceito, ou integração aceita para recorte documental. Medir WIP (iniciados ainda não terminados, inclusive bloqueados), idade até agora, tempo de ciclo até término e número de resultados concluídos por semana, separados por tipo de entrega. PRs/subtarefas não são unidade comparável de throughput. Não publicar percentagem global por contagem de testes ou PRs.

Na primeira revisão, preencher datas ausentes apenas com fonte. Até haver isso, WIP mínimo observável e distribuição de gates são sinais de fila; idade/ciclo completo continuam não disponíveis. Após uma amostra estável, Polvo pode propor expectativa probabilística de serviço com tamanho da amostra, período e percentil explícitos; não inventar previsão agora. Rever quando a mistura de trabalho mudar.

Limitação: o guia Kanban pede métricas de fluxo e expectativa de serviço; esta proposta inicia sua coleta, não alega já operar um sistema calibrado. A revisão semanal examina onde o trabalho esperou, o que voltou por falha e qual política pode reduzir a repetição, sempre com prova específica.
