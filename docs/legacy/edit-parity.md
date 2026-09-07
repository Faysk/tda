# Edit — paridade com `Faysk/dnd-scribe`

> Status: vivo; auditoria inicial concluída para transcript/access
> Owner: Edit + arquitetura
> Última revisão: 2026-09-07
> Fonte histórica principal: `Faysk/dnd-scribe`

## Regra de uso

Este documento é o **contrato de migração funcional** do Edit.

O legado não é autoridade arquitetural, mas comportamento útil não deve desaparecer por acidente. Para cada capacidade encontrada, registrar uma decisão explícita:

- **preservar** — mesma intenção e semântica;
- **adaptar** — mesma intenção, arquitetura/UX nova;
- **substituir** — nova abordagem cobre a necessidade;
- **descartar** — comportamento não deve voltar, com justificativa;
- **pendente** — ainda não há evidência suficiente para decidir.

## Escopo auditado nesta revisão

Foi inspecionada diretamente a implementação histórica de:

- página autenticada de transcrição por sessão;
- leitura da transcrição via contrato/API legado;
- mutation de segmento do editor;
- gestão de permissão de acesso à transcrição;
- relação com campaign, profile, RBAC e `transcript_segments`.

O restante das telas administrativas do `dnd-scribe` continuará sendo inventariado por slice. Não considerar esta revisão como prova de auditoria exaustiva de todo o repositório legado.

## Matriz — transcrição e edição

| Capacidade histórica | Evidência do legado | Decisão TDA | Observação |
| --- | --- | --- | --- |
| abrir transcrição por sessão autenticada | rota `/sessoes/[id]/transcricao` exige access token e redireciona para login | preservar/adaptar | fará parte do Edit, com server-first e authorization vigente |
| sessão contextualiza transcript | título, data, duração, arco, resumo e artwork aparecem antes da lista | preservar/adaptar | no workbench, contexto fica mais compacto para favorecer edição |
| edição de texto por segmento | `editor-segment.js` atualiza `transcript_segments.text` | preservar | vira mutation de domínio testável |
| edição de speaker | endpoint exige `speaker` e atualiza `speaker_name` | preservar/adaptar | deve respeitar participant/profile/entity vigentes; não perpetuar string solta como única identidade |
| limpar `character_name` ao trocar speaker | mutation histórica faz `character_name = null` | pendente/adaptar | preservar intenção de evitar identidade incoerente, mas regra precisa ser redesenhada com modelo atual |
| `text_chars` recalculado | calculado no SQL histórico | preservar | derivação server-side/domínio |
| `text_words` recalculado | calculado no SQL histórico | preservar | derivação server-side/domínio |
| status `pending` | aceito pelo endpoint | preservar inicialmente | pode ser normalizado no futuro via migration explícita |
| status `approved` | aceito pelo endpoint | preservar | revisão humana |
| status `needs_review` | aceito pelo endpoint | preservar | fila de atenção |
| status `discarded` | aceito pelo endpoint | preservar | não confundir com delete físico |
| alias histórico `unreviewed -> pending` | normalizado pelo endpoint | adaptar | aceitar apenas se houver consumidor legado durante transição; UI nova deve usar vocabulário canônico |
| `needs_review` deriva do status | true para `pending` e `needs_review` | preservar/adaptar | manter coerência; avaliar eliminar redundância física apenas em migration futura |
| validação de texto/speaker obrigatórios | endpoint rejeita vazio | preservar | validação client-side + server-side |
| limite de texto | legado corta em 10.000 caracteres | adaptar | validar contra necessidade/schema atual; não truncar silenciosamente na UX nova |
| limite de speaker | legado corta em 160 caracteres | adaptar | identidade estruturada deve reduzir dependência desse campo textual |
| campaign scoping da mutation | join `sessions -> campaigns` e filtro por slug | preservar | invariante de segurança |
| localizar por `source_segment_id` ou UUID | endpoint aceita ambos | compatibilidade temporária | recurso novo deve preferir UUID canônico; alias legado pode existir no adapter |
| retorno do segmento atualizado | endpoint devolve id/timestamps/speaker/text/status | preservar/adaptar | DTO novo deve ser mínimo e versionável |
| autosave/concorrência robusta | não comprovado no endpoint auditado | substituir | implementar save state e proteção contra write fora de ordem |
| histórico old/new por mutation | não comprovado no endpoint auditado | adicionar | exigido pelo contrato atual de evidence/audit |

## Matriz — autorização e acesso

| Capacidade histórica | Evidência do legado | Decisão TDA | Observação |
| --- | --- | --- | --- |
| transcript read como capability | `campaign.transcript.read` | preservar | validar existência/semântica no catálogo vigente antes do binding final |
| edição exige capability separada | `campaign.content.edit` além de read | preservar/adaptar | capability específica pode ser reavaliada se catálogo atual oferecer nome melhor |
| gestão de acesso separada | `campaign.permissions.manage` | preservar | não acoplar a content edit |
| acesso delegado por role | role `transcript_viewer` | adaptar | role é agrupador; código novo pergunta por capability |
| assignment scoped à campaign | `scope_type='campaign'`, `scope_id=campaign` | preservar | compatível com RBAC canônico |
| concessão registra ator | `assigned_by = actor.profileId` | preservar | precisa permanecer auditável |
| revogação registra ator | `revoked_by = actor.profileId` | preservar | idem |
| grant/revoke em transação | `begin/commit/rollback` | preservar | operação administrativa não pode ficar em estado parcial |
| alvo precisa pertencer à campaign | consulta exige `campaign_members` | preservar intenção/adaptar | regra atual deve usar membership/identity contract vigente sem ressuscitar dependência desnecessária |
| metadata de origem da mudança | `source: edit_permissions` + action | preservar/adaptar | preferir audit event estruturado e estável |

## Matriz — UX da página histórica de transcript

| Comportamento | Decisão | Motivo |
| --- | --- | --- |
| página reservada separada da superfície pública | preservar | mantém fronteira editorial |
| link de retorno ao resumo público | preservar | contexto/navegação útil |
| artwork hero grande antes do transcript | adaptar | agradável para leitura, mas edição exige densidade maior |
| sessão + arco + data + duração | preservar | contexto operacional importante |
| erro próprio de transcript | preservar | falha do serviço não deve derrubar a sessão pública |
| login com `next` de retorno | preservar/adaptar | manter deep-link pós-auth |
| lista de transcript em componente dedicado | preservar arquitetura conceitual | implementação nova será feature-oriented |

## Diferenças deliberadas do reboot

O TDA **não** vai copiar:

- CommonJS/Vercel-style handlers como organização central do novo Edit;
- SQL de regra de negócio espalhado por endpoints;
- role slug como pergunta de autorização na UI/domínio;
- truncamento silencioso de inputs como experiência padrão;
- ausência de concorrência explícita para autosave;
- visual de leitura pública usado como workstation administrativa.

## Dependências canônicas atuais

A implementação nova deve respeitar:

- `docs/domains/evidence.md` para lineage e correção de transcript;
- `docs/domains/identity-access.md` para capability/scope;
- `docs/database/security.md` para RLS/RPC/boundary server-side;
- `docs/design-system/README.md` para identidade visual;
- `docs/features/edit-workbench.md` para UX/produto;
- `docs/architecture/edit-workbench.md` para organização técnica.

## Próximas áreas a inventariar

O inventário continuará conforme os slices forem implementados, priorizando:

1. shell/navigation do Edit legado;
2. listagem e administração de sessões;
3. filtros/busca/paginação do transcript;
4. componentes de revisão e operações em lote;
5. telas de permissões/diretório;
6. mídia e vínculos com áudio/timestamp;
7. candidates/publications/canon;
8. qualquer ferramenta administrativa que ainda não possua equivalente no reboot.

Nenhuma dessas áreas deve ser marcada como paridade concluída sem inspeção de código e teste/aceite no TDA.