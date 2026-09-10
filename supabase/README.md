# Supabase do TDA

Projeto canônico existente: `dmrqnbdvbkfqzctcerbx`.

Este diretório versiona mudanças do reboot TDA a partir do momento em que o novo repositório passou a assumir mudanças revisadas de schema. O histórico anterior continua registrado no próprio Supabase e no legado `Faysk/dnd-scribe`; ele não deve ser copiado para cá fingindo que foi criado pelo reboot.

## Diretórios

- `supabase/migrations/`: **somente migrations autorizadas para aplicação remota**. O Production CD pode executar `supabase db push` sobre esta pasta.
- `supabase/candidates/`: SQL candidato ainda não autorizado para Production. Pode ser executado somente em ensaios scratch explicitamente preparados para esse candidato; o Supabase CLI não o considera em `db push`.
- `supabase/tests/`: fixtures e verificações SQL sintéticas.

Promover um candidato não significa mover o arquivo histórico de volta para `migrations/`. Depois da aprovação, criar uma migration nova com timestamp atual, revisar o SQL contra o schema vigente e registrar a nova versão na documentação antes da aplicação. O candidato original permanece como evidência do desenho ensaiado ou é arquivado deliberadamente.

## Regras

- Production data não é resetável por conveniência de desenvolvimento.
- Toda DDL autorizada para Production entra em `supabase/migrations` e deve corresponder ao nome/versão registrada no Supabase após aplicação.
- SQL ainda aguardando decisão operacional fica em `supabase/candidates` e deve estar explicitamente documentado como não aplicado.
- Migration deployável já integrada não é editada, renomeada ou removida para corrigir history; criar migration corretiva.
- Migrations de transição devem preservar o legado enquanto ele ainda estiver operacional.
- Não remover tabelas, columns, scopes ou grants legados sem comprovar independência do TDA.
- RLS e grants são mudanças de contrato de segurança; revisar consumidores antes de alterar.
- Dados narrativos derivados não viram canon por migration automática.
- Identidade de entity deve convergir para UUID/slug; nomes são apresentação e busca. A constraint histórica `(campaign_id, name)` permanece apenas enquanto o consolidator legado usar esse `ON CONFLICT`.

## Primeiras migrations do reboot

- `20260906210333_align_tda_domain_identity.sql`: cria o scope canônico `tda` em paralelo ao legado e liga PCs à registry de entities.
- `20260906210427_backfill_narrative_entity_links.sql`: recupera links de participantes históricos para PCs e adiciona índices do domínio narrativo.
- `20260906211040_relax_reboot_entity_name_lookup.sql`: remove apenas a unicidade case-insensitive adicionada pelo reboot, mantém lookup case-insensitive e preserva a constraint exata exigida pelo consolidator legado.

## Candidatos atuais

Os candidatos de importação de transcrição permanecem deliberadamente não aplicados em Production:

- `candidates/20260907193704_transcript_import_capability.sql`;
- `candidates/20260907193705_transcript_import_atomic.sql`.

O contrato e os gates de ativação continuam em `docs/integrations/transcript-import.md` e `docs/database/migrations.md`.
