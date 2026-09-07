# Composição de candidato e marcos

> Status: preparado
> Owner: Prancheta - Organização de entregas; decisão de escopo por Polvo - Coordenação e produto
> Última revisão: 2026-09-07
> Fonte de verdade: inventory.md para estado; roadmap.md para prioridades; operations/release-runbook.md para publicação

## Objetivos e ordem proposta

O [roadmap vigente](../roadmap.md) documenta a consolidação público → Edit → narrativas. A [PR #55](https://github.com/Faysk/tda/pull/55) registra a rodada paralela autorizada, incluindo Pipipi, cinematic, grafo, Edit e consumidor local. A solicitação de Prancheta reforça Discord/acesso e local → importação durável → Edit, preservando narrativas conforme capacidade. A leitura direta dos últimos turnos de Polvo retornou metadados sem mensagens: não inferimos novas prioridades dessas durações. A ordem abaixo é proposta de convergência para Rabisco/Polvo incorporarem ao roadmap; não revoga trabalho existente nem cria novo compromisso de data.

| Ordem proposta / vínculo ao roadmap | Resultado observável e critério do marco | Recortes/dependências do inventário |
| --- | --- | --- |
| M0 / R2: preservar público | Sessões mantêm navegação, título, resumo e arte próprios no HTML servido; regressões do caminho default não voltam | MIDIA, DOCS; registro operacional dono |
| M1 / R3: Discord e acesso autorizado | Clique no botão inicia OAuth; retorno cria sessão válida; logout funciona; usuário sem capability não lê administração; autorizado acessa apenas o próprio escopo | AUTH, PERMISSOES; Crachá revisa semântica |
| M2 / R3 + R4: local → recibo → Edit | Resultado local real é exportado, importado uma vez, sobrevive a reinício/perda de resposta e é lido/editado com revision, conflito e audit; PC desligado não remove o conteúdo importado | LOCAL, SERVICO, IMPORT, EDIT; contrato Cofrinho e M1 |
| M3 / R5: Pipipi legível e compartilhável | Conteúdo autorizado preservado, links/imagens próprios, mobile/teclado e leitura sem JS; revelations públicas não fingem autorização | PIPIPI; mídia editorial e metadata |
| M4 / R6 e melhoria de M3 | Grafo usa apenas projection pública, nunca inventa canon; cinematic é opcional, não prejudica leitura/reduced motion | GRAFO, CINEMA; preview de PIPIPI e contratos donos |

Estatísticas é slice auxiliar de M2; gestão de concessão/revogação fica em backlog até contrato seguro de delegação, preservando a consulta já feita. CAS de mídia é operação independente, sem bloquear o resultado público já registrado. O conteúdo Pipipi pode ser entregue sem esperar cinematic/grafo se passar seus próprios gates; nenhuma dessas frentes é descartada.

## Manifesto do próximo candidato

Os heads, estado de integração e publicação vivem exclusivamente no [inventário](inventory.md). Se AUTH já estiver integrado ou em publicação conforme aquele corte, **não criar segundo candidato nem segundo deploy para a mesma correção**. O gate de acesso continua sendo funcional: provider → consentimento → callback → profile/capabilities → acesso autorizado → logout. Integração do código não substitui essa evidência.

PERMISSOES pode compor lote posterior somente com reconciliação dos arquivos compartilhados e validação conjunta de leitura por campanha; concessão/revogação continua fora desse candidato enquanto não existir contrato seguro de delegação. Não incluir IMPORT apenas porque CI isolada está verde.

Não há SHA composto congelado para um novo candidato nesta proposta. Quando Polvo abrir um lote, registrar no inventário: base, PR/head de cada membro, SHA conjunto, evidência Preview, decisão de escopo e responsável pelo próximo gate. Se optar por candidato menor, registrar explicitamente o resultado ainda não entregue.

Próximo lote proposto após acesso funcional comprovado: **TDA-RC-transcricao-01** — SERVICO + LOCAL + IMPORT + EDIT. Contrato único de SQL e fixture do exporter são pré-condições; ensaio conjunto anterior só vale para sua combinação original e seus SHAs exatos. M3/M4 podem compor lotes narrativos independentes quando tiverem artefatos revisáveis e capacidade de homologação. Não acumular tudo em um big bang.

## Gates verificáveis de liberação

Esta é a lista de aceite do candidato; estado e evidência de execução ficam no inventário. O [runbook de release](../operations/release-runbook.md) continua dono de execução, deploy e rollback.

| Gate | Evidência exigida | Responsável pelo próximo aceite |
| --- | --- | --- |
| G1 — composição | Base e heads imutáveis, PRs revisadas, arquivos compartilhados reconciliados, catálogo regenerado | Polvo; Rabisco para documentação |
| G2 — validação isolada | CI terminal de cada head; testes aplicáveis sem esconder falhas/skips; SQL com PostgreSQL sintético quando aplicável | Dono de cada recorte; Cofrinho para contrato SQL |
| G3 — validação conjunta | SHA do conjunto, build/check/E2E, mesmos contratos entre produtor e consumidor; evidências ligadas ao caminho real da UI | Polvo com donos do lote |
| G4 — acesso | Browser no ambiente autorizado: clique → provider → consentimento → callback → profile/capabilities → acesso e logout; negar escopo indevido | Catraca e Crachá; conta de teste autorizada pelo dono |
| G5 — durabilidade, quando M2 | Exporter preservado, hashes/origem, perda pós-commit/retry/mesmo recibo, restart/reload, sem duplicação; Edit readback/revision/conflito/audit; distinguir ASR real de fixture | Motorzinho, Painelzinho, Carteiro e Parafuso; Cofrinho revisa banco |
| G6 — conteúdo/visual | HTML e metadata pelo caminho default, assets elegíveis, mobile/teclado/reduced motion/sem JS; sem dados demo promovidos a canon | Pipoca/Claquete/Espaguete conforme membros; Lupa revisa achados |
| G7 — ambiente e reversão | Preview homologado com contexto de dados autorizado; migrations/configuração necessárias e seu plano de compatibilidade/reversão documentados; sem usar banco real por conveniência | Foguete; Cofrinho para plano de banco; dono autoriza operações |
| G8 — publicação | Aprovação deliberada, source SHA e deployment/ambiente, smoke do resultado, rollback conhecido e registro append-only | Foguete e dono do produto |

Main é a linha para produção, Preview é homologação, branches auxiliares são temporárias. Integração não prova G8. Nenhuma ação de merge, deploy, DNS, CAS, DDL, grants ou dados reais foi executada por Prancheta. Um gate ausente bloqueia a alegação correspondente; não converter ausência de evidência em aprovação tácita.
