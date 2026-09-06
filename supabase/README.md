# Supabase do TDA

Projeto canônico existente: `dmrqnbdvbkfqzctcerbx`.

Este diretório versiona somente migrations do reboot TDA aplicadas a partir do momento em que o novo repositório passou a assumir mudanças revisadas de schema. O histórico anterior continua registrado no próprio Supabase e no legado `Faysk/dnd-scribe`; ele não deve ser copiado para cá fingindo que foi criado pelo reboot.

## Regras

- Production data não é resetável por conveniência de desenvolvimento.
- Toda DDL nova entra em `supabase/migrations` e deve corresponder ao nome/versão registrada no Supabase.
- Migrations de transição devem preservar o legado enquanto ele ainda estiver operacional.
- Não remover tabelas, columns, scopes ou grants legados sem comprovar independência do TDA.
- RLS e grants são mudanças de contrato de segurança; revisar consumidores antes de alterar.
- Dados narrativos derivados não viram canon por migration automática.
- Identidade de entity deve convergir para UUID/slug; nomes são apresentação e busca. A constraint histórica `(campaign_id, name)` permanece apenas enquanto o consolidator legado usar esse `ON CONFLICT`.

## Primeiras migrations do reboot

- `20260906210333_align_tda_domain_identity.sql`: cria o scope canônico `tda` em paralelo ao legado e liga PCs à registry de entities.
- `20260906210427_backfill_narrative_entity_links.sql`: recupera links de participantes históricos para PCs e adiciona índices do domínio narrativo.
- `20260906211040_relax_reboot_entity_name_lookup.sql`: remove apenas a unicidade case-insensitive adicionada pelo reboot, mantém lookup case-insensitive e preserva a constraint exata exigida pelo consolidator legado.
