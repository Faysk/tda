# Identidade, Auth e autorização

> Status: implementado + convergência em andamento
> Owner: identity/access
> Última revisão: 2026-09-06

## Objetivo

Separar claramente:

- pessoa/conta;
- identidade externa;
- personagem;
- membership;
- função narrativa;
- role técnica;
- capability;
- scope.

Misturar essas categorias produz bugs de autorização difíceis de perceber.

## Identidades

### Auth user

Identidade autenticada do Supabase Auth. É mecanismo de login, não profile narrativo nem role.

### Profile

`profiles` é a identidade humana interna. Pode guardar vínculos Discord/Roll20 e `auth_user_id`.

### Character entity

PC é `entities(type=pc)`, ligado à pessoa por `profile_characters`.

### Participant

Aparição em sessão. Pode resolver profile e entity independentemente.

## Login

O candidato de 2026-09-07 implementa entrada **exclusivamente Discord**, sessão SSR e guards administrativos. Fluxo, configuração, evidências e limites estão no [runbook Discord](../operations/discord-auth.md). Preserva o contrato proposto na PR #43; não concede administração após login e não resolve os blockers de claim/RPC por conta própria.

O resolver server-only existente usa a representação física `scope_type=project, scope_id=tda` para o scope conceitual `project/tda`; a action precisa estar explicitamente presente no grant ativo. O runtime diferencia anônimo, autenticado sem profile, profile sem capabilities efetivas e autorizado; indisponibilidade de serviço é estado operacional adicional e nega acesso.

Direção vigente: OAuth/Auth do Supabase. Login bem-sucedido só prova identidade Auth; a aplicação ainda precisa resolver profile e capabilities.

Fluxo:

```text
provider OAuth
  -> auth.users
  -> profiles.auth_user_id
  -> assignments/membership
  -> capabilities no scope
```

## Profile claim

Quando conta autenticada ainda não está vinculada de forma confiável a um profile, `profile_claims` representa pedido de associação/correção.

Regras:

- usuário não escolhe arbitrariamente qualquer profile como seu;
- solicitação fica pendente até fluxo autorizado de revisão;
- character names sugeridos não criam automaticamente PCs novos;
- aprovação deve ser auditável.

## Membership legado

`campaign_members` guarda role simples por campaign. Continua necessário para RPCs históricas, mas não é o destino do novo design.

## RBAC

RBAC é composto por:

```text
permission_catalog(action)
        ▲
role_permissions
        │
role_definitions
        ▲
role_assignments(profile, scope)
```

### Capability

A menor decisão de autorização útil. Exemplo conceitual: visualizar transcrição, revisar conteúdo, publicar resumo, administrar determinada integração.

A UI pode usar capabilities para habilitar ações, mas o backend/RPC deve validar novamente. UI escondida não é controle de segurança.

### Role

Agrupador administrável de capabilities. Nome da role não deve vazar para regras locais desnecessárias.

### Scope

Limita onde assignment vale:

- projeto;
- campanha;
- sessão;
- recurso;
- integração.

`project/tda` é o scope técnico canônico do reboot.

## Função de DM

`dm_tenures` explicita período/função de DM e evita tratar toda responsabilidade narrativa como simples role técnica eterna.

Futuro pode comportar primary DM, co-DM e DM de sessão sem destruir histórico.

## Ordo

`ordo_access_members` é um mecanismo especializado do legado/superfície Ordo. Não deve virar terceiro RBAC global. Enquanto existir, documentar seus consumidores e manter boundary explícito.

## Regras de autorização

1. Validar identidade no servidor/RPC.
2. Resolver profile de forma confiável.
3. Verificar capability no scope apropriado.
4. Verificar ownership/campaign do recurso.
5. Aplicar visibility/audience do conteúdo.
6. Retornar somente campos necessários.

## Casos especiais

### Público

Não precisa profile para conteúdo `public_web`, mas o endpoint ainda limita campaign/status/campos.

### Player

Ter membership não significa acesso a segredos de mestre. Visibility e capability continuam valendo.

### DM

Ser DM não implica automaticamente permissão técnica global fora da campaign/scope quando o produto evoluir para múltiplas campanhas/integrações.

### Companion

É ator técnico, não jogador. Deve receber credencial/scope mínimo para sincronização permitida.

## Dívida atual

- dois modelos coexistem: campaign_members e RBAC;
- RPCs `SECURITY DEFINER` precisam inventário/revisão por função;
- scope `dnd-scribe` continua por compatibilidade;
- Ordo possui acesso especializado separado;
- audit_log ainda não demonstra cobertura completa.

## Critério para encerrar legado de acesso

`dnd-scribe`/campaign role legado só pode ser removido quando:

- todas as novas superfícies usam capability;
- RPCs antigas foram migradas/substituídas;
- testes positivos/negativos cobrem os fluxos;
- companion/Discord/Ordo consumidores foram verificados;
- nenhum código mantém scope hardcoded antigo.

## Referências

- [Segurança do banco](../database/security.md)
- [Modelo de dados](../data-model.md)
- [ADR de identidade do projeto](../adr/0001-project-identity.md)
