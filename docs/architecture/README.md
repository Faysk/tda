# Arquitetura — índice detalhado

> Status: vigente
> Owner: arquitetura do TDA
> Última revisão: 2026-09-20
> Fonte de verdade: `Faysk/tda`, ADR-0018 e documentos donos de cada domínio

Este diretório expande [architecture.md](../architecture.md).

## Documentos

- [Contexto e limites do sistema](system-context.md)
- [Fluxos ponta a ponta](data-flows.md)
- [Princípios e invariantes](invariants.md)
- [ADR-0018 — core portátil e providers substituíveis](../adr/0018-portable-core-github-control-plane.md)
- [Edit Workbench](edit-workbench.md)
- [Modelo canônico de dados](../data-model.md)
- [Design System](../design-system/README.md)
- [Domínios](../domains/README.md)
- [Features](../features/README.md)
- [Integrações](../integrations/README.md)
- [Operação](../operations/README.md)
- [ADRs](../adr/README.md)

## Visão de alto nível

```text
                        Usuários TDA
                             |
                            HTTPS
                             |
                     TDA web / Edit
                         Next.js
                             |
             +---------------+---------------+
             |                               |
          Data contract                  Media Storage
          PostgreSQL                     object/blob
             |                               |
      Supabase hoje                    R2 hoje
             ^
             |
       conteúdo sincronizado
             |
       Companion local
       processamento pesado
             |
       Craig/Discord/Roll20
```

GitHub fica acima desse desenho como **control plane**: código, docs, manifests, migrations, workflows e automação.

## Regra de composição

- `src/app`: rotas/layout/composição;
- `src/features`: domínio e casos de uso;
- `src/integrations`: edges externos/providers;
- `src/components`: apresentação reutilizável.

Não criar provider-specific regra de domínio quando um boundary pequeno resolve a integração.

Não criar adapter hipotético para providers que não usamos; abstrair a fronteira real.

## Fronteiras fundamentais

1. GitHub é o control plane canônico.
2. Produto cloud; processamento pesado local.
3. PostgreSQL é o contrato relacional; Supabase é o provider atual.
4. Media Storage guarda mídia; R2 é o provider atual.
5. Runtime/deploy é substituível; Vercel é o provider atual.
6. Toda mídia persistida/publicada pertence ao Media Storage, não ao Git.
7. Transcrição/evidência não é canon.
8. PC/NPC e objetos narrativos compartilham `entities`.
9. UI autoriza por capabilities/scope.
10. Preview não recebe Production irrestrita.
11. Visualização não dita schema.
12. Fixtures não viram canon.
13. Relation/knowledge pode ser secreta.
14. Marca/Design System são contratos compartilhados.
15. Edit pertence ao mesmo produto, não a frontend paralelo.
16. Infraestrutura é free-first sem sacrificar segurança/integridade.
17. Mudança estrutural exige docs na mesma PR.

## Providers atuais

| Edge | Contrato | Provider |
| --- | --- | --- |
| runtime | web runtime/deploy | Vercel |
| dados | PostgreSQL/Auth boundary | Supabase |
| mídia | Media Storage | Cloudflare R2 |

Trocar uma linha dessa tabela no futuro exige trabalho de integração e operação, não reescrita do domínio.

## Ownership

- decisão estrutural: ADR;
- regra de domínio: `docs/domains` + `data-model.md`;
- schema físico: `docs/database` + migrations;
- UI/brand: `docs/design-system`;
- feature: `docs/features`;
- provider/integração: `docs/integrations`;
- release/ambiente: `docs/operations`.
