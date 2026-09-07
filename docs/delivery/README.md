# Gestão de entregas

> Status: preparado
> Owner: Prancheta - Organização de entregas
> Última revisão: 2026-09-07
> Fonte de verdade: documentos donos abaixo; GitHub e evidências vinculadas no inventário

Objetivo de produto: permitir que o visitante explore sessões e histórias públicas com identidade própria, e que o operador autorizado transforme processamento local em transcrição durável e editável, preservando origem, autorização e recuperação. O site deve continuar útil com o PC desligado.

Esta proposta está em revisão documental. Não muda autorização, tarefas, contratos de banco ou política de publicação. Prancheta organiza entregas; Polvo - Coordenação coordena execução; Lupa - Auditoria continua dona da auditoria; Rabisco - Documentação mantém os documentos gerais.

- [Inventário e quadro atual](inventory.md): único registro operacional de entregas, com responsáveis, evidências, bloqueios e estado de cada recorte.
- [Fluxo e política de transições](workflow.md): limites, critérios de entrada/saída e handoff.
- [Composição de candidato](release-candidate.md): marcos observáveis, proposta de ordem e gates; consultar o inventário para status.
- [Medição e feedback](measurement.md): proveniência, limitações e coleta prospectiva.

## Fronteiras e manutenção

Ownership confirmado por Rabisco em 2026-09-07: `docs/delivery/` exclusivo desta frente. [Roadmap](../roadmap.md) continua dono de prioridade e dependências de produto; [catálogo de features](../feature-catalog.md) descreve maturidade na main; [documentação viva](../documentation/README.md) define a taxonomia oficial; [deployments](../operations/deployments.md) é o histórico append-only de publicações. Este inventário referencia essas fontes, não substitui contratos nem replica o histórico operacional completo.

PRs/issues são evidência primária de código/checks. Tarefas explicam escopo e trabalho parcial. O registro local `.local/coordination-chats.json` resolve identidades; seus campos de status, assim como `coordination-progress.json` e avaliações datadas, são fotografias históricas, não outra fila operacional a manter. Não versionar esses arquivos locais. Não criar planilhas paralelas.

O implementador registra mudança e evidência na PR; Prancheta atualiza somente a linha correspondente no inventário; Rabisco ajusta o documento dono quando houver mudança de contrato/prioridade; Polvo usa o próximo gate para coordenar. Uma mudança de SHA invalida a validação do candidato até confirmação dos checks daquele SHA. Registro sem novidade não exige mensagem nem commit. O inventário deve declarar data de corte; ausência de leitura atual vira “não disponível”, nunca “concluído”.

Os números de WIP definidos em `workflow.md` são uma política experimental de fluxo, não capacidade histórica ou medida da equipe. Não inferir produtividade, velocidade individual, horas disponíveis ou prazo de entrega a partir deles.

`docs/README.md` também é alterado pela #58: preservar ambos os links na integração. O catálogo é gerado e compartilhado por #54–#61: regenerar sobre a base final, sem resolver linhas manualmente. A #55 permanece dona da atualização geral do roadmap e do recibo de Production #004; reconciliar com ela as propostas de prioridade aqui antes de adotá-las.
