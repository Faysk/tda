# Documentação viva

Este diretório define **como a documentação do TDA é mantida**. A documentação faz parte do produto: mudança relevante sem documentação correspondente é mudança incompleta.

## Objetivos

A documentação deve ser:

- **canônica**: deve existir uma fonte principal para cada fato importante;
- **modular**: documentos pequenos por domínio, conectados por índices;
- **auditável**: distinguir contrato, fotografia observada, hipótese e histórico;
- **viva**: ser atualizada junto com código/schema/infra;
- **escalável**: permitir novos domínios sem transformar `docs/README.md` em um arquivo gigante;
- **operacional**: conter passos de validação, falha e rollback quando necessário;
- **segura**: nunca conter secrets, tokens ou dados pessoais desnecessários.

## Tipos de documento

### Contrato
Define regra vigente. Exemplos: `data-model.md`, segurança do banco, domínio de canon.

### Índice
Navega uma área e indica ownership documental. Exemplos: `database/README.md`, `domains/README.md`.

### Auditoria
Fotografia datada do estado real. Pode ficar desatualizada e deve informar sua data. Exemplo: `database-audit.md`.

### Runbook
Procedimento executável para operação, release, incidente ou recuperação.

### ADR
Decisão arquitetural com contexto, decisão, consequências e alternativas. ADR aprovado não deve ser reescrito para fingir que o passado foi diferente; uma nova decisão cria novo ADR que substitui o anterior.

### Catálogo
Inventário de itens com status padronizado: features, tabelas, integrações, migrations.

### Histórico/legado
Evidência do projeto anterior. Nunca é automaticamente contrato do reboot.

## Cabeçalho recomendado

Todo documento detalhado novo deve declarar, quando aplicável:

```md
> Status: implementado | preparado | planejado | em desenho | histórico
> Owner: domínio responsável
> Última revisão: YYYY-MM-DD
> Fonte de verdade: arquivo/schema/serviço
```

## Regra de ownership

Cada conceito possui um documento dono. Outros documentos **linkam**, não duplicam definições completas.

Exemplos:

- identidade `Profile` vs `Entity`: `data-model.md`;
- schema físico: `database/schema-catalog.md`;
- segurança Supabase: `database/security.md`;
- fluxo de canon: `domains/canon-review.md`;
- deploy: `operations/release-runbook.md`;
- estado observado do banco: `database-audit.md`.

## Definition of Done documental

Uma PR que altera comportamento relevante deve responder:

1. Qual contrato mudou?
2. Qual documento é dono desse contrato?
3. O schema/fluxo/estado documentado ainda corresponde ao sistema?
4. Existe migration/rollback quando necessário?
5. A feature catalog/roadmap precisa mudar de status?
6. Há nova decisão arquitetural que merece ADR?
7. Há novo risco operacional ou de segurança?

Se alguma resposta for sim, a documentação deve mudar na mesma PR.

## Política para banco

- Toda DDL nova: migration versionada.
- Toda tabela nova: entrada no catálogo de schema e no domínio dono.
- Toda nova policy/grant/RPC: atualizar segurança.
- Todo novo enum/check relevante: documentar semântica e transições.
- Toda mudança de identidade/relacionamento: atualizar modelo canônico e diagrama textual.
- Backfills devem explicar origem, invariantes e o que **não** foi inferido.

## Política para features

Antes de implementar feature estrutural:

1. registrar no `feature-catalog.md`;
2. definir domínio/identidades envolvidos;
3. registrar estados e regras de visibilidade;
4. separar evidência de canon quando houver IA/lore;
5. decidir se exige ADR;
6. só então desenhar schema/API/UI.

## Política para legado

Ao reutilizar algo de `Faysk/dnd-scribe`, registrar uma destas decisões:

- **revalidado**: permanece desejado no TDA;
- **adaptado**: intenção permanece, arquitetura muda;
- **compatibilidade temporária**: só existe durante transição;
- **histórico**: útil para contexto, não será reimplementado agora;
- **descartado**: não pertence ao reboot.

## Revisões periódicas

### Catálogo automático e revisão humana

O [catálogo completo](catalog.md) lista recursivamente páginas, responsáveis, estados e datas declarados. Gerar com `pnpm docs:generate` após criar, remover, renomear ou revisar cabeçalhos. `pnpm docs:check` falha se o catálogo estiver desatualizado e continua verificando links e alcance a partir do índice.

O catálogo não substitui índices editoriais. Ao adicionar página, também criar link no índice da área. Metadados ausentes aparecem como lacunas; não inferir revisão pelo Git nem preencher aprovação automaticamente.

Revisar na mesma entrega, nos marcos de release e após incidentes ou mudanças de domínio/custo/segurança/schema. Atualizar data só após confrontar com a fonte; auditorias históricas preservam sua data.

O implementador mantém contratos/evidências; o proprietário decide direção e custos. Runbooks explicam pré-condições, verificação e recuperação. Features distinguem intenção, implementação, teste e publicação.

Revisar ao menos nos marcos de release:

- links quebrados;
- status de features;
- schema vs catálogo;
- migrations aplicadas vs versionadas;
- integrações e ambientes;
- riscos de segurança;
- ADRs substituídos;
- documentação histórica que ainda está sendo tratada como vigente por engano.

## Convenções de nome

- diretórios: substantivos de domínio (`database`, `domains`, `operations`);
- arquivos: kebab-case;
- ADR: `NNNN-slug.md`;
- não numerar documentação viva comum por ordem cronológica;
- datas pertencem a auditorias/registros, não ao nome de contratos duradouros.
