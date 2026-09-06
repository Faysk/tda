# Arquitetura — índice detalhado

> Status: vigente
> Owner: arquitetura do TDA
> Última revisão: 2026-09-06
> Fonte de verdade: `Faysk/tda` + Supabase `dmrqnbdvbkfqzctcerbx`

Este diretório expande [architecture.md](../architecture.md), que permanece como visão executiva curta.

## Documentos

- [Contexto e limites do sistema](system-context.md)
- [Fluxos ponta a ponta](data-flows.md)
- [Princípios e invariantes](invariants.md)
- [Modelo canônico de dados](../data-model.md)
- [Domínios](../domains/README.md)
- [Integrações](../integrations/README.md)
- [Operação](../operations/README.md)
- [ADRs](../adr/README.md)

## Visão de alto nível

```text
                        ┌─────────────────────────────┐
                        │        Usuários TDA         │
                        │ público / player / DM/admin │
                        └──────────────┬──────────────┘
                                       │ HTTPS
                                       ▼
┌──────────────────────────────────────────────────────────────┐
│                      TDA web / Edit                          │
│                         Next.js                              │
│  src/app ─ src/components ─ src/features ─ src/integrations │
└──────────────┬───────────────────────┬───────────────────────┘
               │                       │
               │ server-side           │ objetos/mídia
               ▼                       ▼
      ┌─────────────────┐      ┌──────────────────┐
      │    Supabase     │      │  Cloudflare R2   │
      │ DB/Auth/RPC/RLS │      │ public/private   │
      └────────┬────────┘      └──────────────────┘
               ▲
               │ conteúdo sincronizado / metadados
               │
┌──────────────┴───────────────────────────────────────────────┐
│                    Companion local                           │
│ ingestão Craig / áudio / transcrição / classificação pesada │
│ processamento retomável, sem exigir PC ligado para leitura  │
└──────────────┬───────────────────────────┬───────────────────┘
               │                           │
               ▼                           ▼
        ┌────────────┐              ┌────────────┐
        │ Craig/Discord│             │  Roll20    │
        └────────────┘              └────────────┘
```

## Regra de composição

A arquitetura do reboot evita múltiplos frontends concorrentes:

- `src/app`: rotas, layouts e composição de página;
- `src/features`: lógica de domínio e casos de uso;
- `src/integrations`: fronteiras externas/Supabase/R2/etc.;
- `src/components`: componentes de apresentação/composição reutilizável.

Não criar um segundo frontend público, proxy obrigatório para o legado ou uma segunda base apenas para acelerar uma feature.

## Fronteiras fundamentais

1. **Produto cloud; processamento pesado local.**
2. **Supabase existente é a base canônica.**
3. **R2 armazena binários; banco armazena relações/metadados.**
4. **Transcrição/evidência não é canon.**
5. **PC/NPC e objetos narrativos compartilham `entities`.**
6. **UI não decide autorização por nome de role; usa capabilities.**
7. **O legado pode continuar operacional durante a migração, mas não dita nova arquitetura.**
8. **Preview/homologação não recebe acesso irrestrito a dados de produção.**

## Ownership de decisão

- desenho estrutural: ADR;
- regra de domínio: `docs/domains` + `data-model.md`;
- schema físico: `docs/database` + migrations;
- integração externa: `docs/integrations`;
- release/ambiente: `docs/operations`.
