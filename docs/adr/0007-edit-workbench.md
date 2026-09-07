# ADR-0007 — Edit como workbench server-first orientado a capabilities

- Status: accepted
- Data: 2026-09-07
- Decisores: projeto TDA

## Contexto

O `Faysk/dnd-scribe` possui comportamento administrativo útil, especialmente em transcrição, revisão e acesso. O reboot `Faysk/tda` já definiu arquitetura server-first, RBAC por capability/scope, Design System oficial e separação entre superfície pública e estado editorial.

Copiar o frontend/API legado 1:1 recuperaria funcionalidade rapidamente, mas também reintroduziria acoplamentos que o reboot explicitamente separou: handlers com SQL/regra de negócio misturados, autorização dependente de contratos históricos e UX de leitura reutilizada para edição.

Ao mesmo tempo, reescrever toda a área administrativa de uma vez aumenta risco de regressão funcional e dificulta provar paridade com um sistema antigo que já era usado na prática.

## Decisão

O Edit será implementado como **workbench administrativo dentro do mesmo aplicativo Next.js do TDA**, usando slices verticais incrementais.

A organização preferida é:

```text
src/app -> composição/rotas
src/features -> casos de uso, domínio e UI específica
src/components -> primitives reutilizáveis
src/integrations -> persistence/serviços externos
```

As páginas são server-first. Interações ricas entram como Client Components pequenos e localizados.

Autorização nova pergunta por **capability + scope** e valida novamente no servidor. Nomes de role permanecem agrupadores administrativos, não regras de negócio locais.

O `dnd-scribe` é tratado como especificação comportamental histórica. Cada capacidade migrada recebe decisão explícita de preservar, adaptar, substituir ou descartar em `docs/legacy/edit-parity.md`.

O editor de transcript é o primeiro fluxo crítico. Mutations devem encapsular validação, campaign ownership, métricas derivadas, coerência de review state, concorrência e auditoria em boundaries testáveis.

Autosave deve possuir proteção explícita contra writes fora de ordem. Revision/version otimista é a estratégia preferida quando o schema permitir; serialização no cliente pode ser mitigação temporária, não proteção suficiente entre clientes diferentes.

## Consequências positivas

- recupera funcionalidade antiga sem tornar arquitetura antiga normativa;
- mantém um único frontend e um único Design System;
- segurança converge para o RBAC canônico;
- regras de edição ficam testáveis fora do componente visual;
- paridade pode ser entregue e validada por slice;
- concorrência e auditoria passam a ser requisitos explícitos;
- superfícies públicas não precisam carregar estado administrativo.

## Custos e riscos

- migração exige mais disciplina que copiar endpoints existentes;
- durante a transição haverá adapters/compatibilidade com IDs e capabilities históricos;
- revision/version pode exigir migration futura;
- auditoria completa ainda precisa de contrato físico e cobertura no banco;
- o workbench precisa equilibrar densidade com Design System e acessibilidade.

## Alternativas rejeitadas

### Copiar o Edit legado para uma rota nova

Rejeitada porque preservaria debt estrutural e criaria uma segunda arquitetura dentro do reboot.

### Criar aplicativo/admin separado

Rejeitada porque duplicaria Auth, Design System, deploy e boundaries sem benefício comprovado nesta fase.

### CRUD genérico do Supabase

Rejeitado porque o Edit opera regras de domínio, autorização, revisão e provenance que não podem ser reduzidas com segurança a edição de tabela.

### Big-bang rewrite de toda a administração

Rejeitado por elevar risco de regressão e dificultar prova de paridade.

## Referências

- [Edit Workbench — feature](../features/edit-workbench.md)
- [Arquitetura do Edit](../architecture/edit-workbench.md)
- [Paridade do legado](../legacy/edit-parity.md)
- [Identity/access](../domains/identity-access.md)
- [Evidence/transcription](../domains/evidence.md)
- [Segurança do banco](../database/security.md)
- [Design System](../design-system/README.md)