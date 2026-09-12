# Especificações de features

> Status: vivo
> Owner: produto + domínios
> Última revisão: 2026-09-12
> Fonte de verdade: specs deste diretório e `../feature-catalog.md`

O [catálogo de features](../feature-catalog.md) responde **qual é o status canônico na `main`**. Este diretório responde **o que a feature significa, quais dados usa, o que falta decidir e qual é o critério para implementá-la sem quebrar o modelo**.

PRs abertas podem conter implementação validada e documentação candidata sem alterar automaticamente os estados deste índice. Dependências entre candidatos ficam no [roadmap](../roadmap.md); cada spec continua dona do contrato da sua área.

## Índice

[Fidelidade dos pacotes de D e Seika](lore-pack-fidelity.md) — contrato visual e aceite da restauração das páginas independentes.

Candidato em revisão: [Estatísticas privadas de transcrições](transcript-statistics.md) — palavras e duração registrada por sessão, totais completos autorizados; implementação de branch, sem publicação.

Candidato em revisão: [Pipipi — lore cinematográfica pioneira](pipipi-lore.md) — experiência editorial longa com cenas dirigidas por scroll, enhancement visual e fallback de leitura; implementação de branch, sem publicação.

Candidato em revisão: [World entity media foundation](world-entity-media-foundation.md) — identidade de asset, upload direto R2 com finalização/read-back, preview privado, vínculo entidade → portrait e publicação verificada; SQL permanece em `supabase/candidates/`.

| Feature | Estado na `main` | Spec |
| --- | --- | --- |
| Edit Workbench / administração | implementação incremental | [Edit Workbench](edit-workbench.md) |
| Edit / permissões | candidato somente leitura; sem grant/revoke | [Consulta de permissões](edit-permissions.md) |
| Edit / processamento local | candidato UI/adapters e ensaio sintético; ASR/sync cloud pendentes | [Processamento local](local-processing.md) |
| Edit / transcript server-side | leitura autorizada com `revision`; persistence atômica ainda pendente | [Slice server-side de transcrição](edit-transcript-server-slice.md) |
| Edit / bypass temporário | workbench disponível por flag explícita, desligada por default | [Modo temporário sem autenticação](edit-unsafe-development.md) |
| PCs/NPCs | preparado | [Personagens e NPCs](characters-and-npcs.md) |
| perfis editoriais de entities | scaffold integrado; projection pendente | [Entity profiles](entity-profiles.md) |
