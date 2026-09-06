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
- [Design System](../design-system/README.md)
- [Domínios](../domains/README.md)
- [Features](../features/README.md)
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
│                                                              │
│  páginas editoriais    World Explorer        Edit            │
│  server-first          projection + React    capabilities    │
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
        ┌──────────────┐            ┌────────────┐
        │ Craig/Discord│            │  Roll20    │
        └──────────────┘            └────────────┘
```

## Regra de composição

A arquitetura do reboot evita múltiplos frontends concorrentes:

- `src/app`: rotas, layouts e composição de página;
- `src/features`: lógica de domínio e casos de uso;
- `src/integrations`: fronteiras externas/Supabase/R2/etc.;
- `src/components`: componentes de apresentação/composição reutilizável.

Não criar um segundo frontend público, proxy obrigatório para o legado ou uma segunda base apenas para acelerar uma feature.

## World Explorer como projection

A visualização de relações possui um boundary explícito:

```text
Supabase + domínio + audience
        ↓
query/case de uso server-side
        ↓
projection DTO autorizada
        ↓
React Flow no cliente
```

Consequências:

- React Flow não consulta schema bruto como modelo de domínio;
- nodes/edges visuais não são a fonte de verdade;
- posições do canvas não vivem em `entities`;
- relation secreta é removida antes do payload;
- páginas editoriais continuam server-first quando possível;
- somente o canvas/interações necessárias viram Client Components.

A decisão tecnológica está em [ADR-0006](../adr/0006-react-flow-world-explorer.md).

## Design System como boundary transversal

O **TDA Design System v1.0.0** e o Brand Pack oficial são contratos transversais de apresentação.

Eles não alteram domínio, mas todas as superfícies novas precisam respeitar:

- tokens semânticos;
- light/dark equivalentes;
- tipografia editorial/UI;
- foco/contraste/acessibilidade;
- marca oficial sem redesenho;
- princípio "Visitante vê história; editor vê estado editorial".

## Fronteiras fundamentais

1. **Produto cloud; processamento pesado local.**
2. **Supabase existente é a base canônica.**
3. **R2 armazena binários; banco armazena relações/metadados.**
4. **Transcrição/evidência não é canon.**
5. **PC/NPC e objetos narrativos compartilham `entities`.**
6. **UI não decide autorização por nome de role; usa capabilities.**
7. **O legado pode continuar operacional durante a migração, mas não dita nova arquitetura.**
8. **Preview/homologação não recebe acesso irrestrito a dados de produção.**
9. **Visualização não dita schema.**
10. **Fixtures/referências de UI não viram canon.**
11. **A própria existência de relation/knowledge pode ser secreta.**
12. **Marca e Design System são contratos compartilhados, não estilos locais por página.**

## Ownership de decisão

- desenho estrutural: ADR;
- regra de domínio: `docs/domains` + `data-model.md`;
- schema físico: `docs/database` + migrations;
- UI/brand/tokens: `docs/design-system`;
- comportamento de feature: `docs/features`;
- integração externa: `docs/integrations`;
- release/ambiente: `docs/operations`.