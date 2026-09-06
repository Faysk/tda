# Integração Supabase

> Status: implementado/canônico
> Owner: integrations + data + identity
> Última revisão: 2026-09-06

## Projeto

- ref: `dmrqnbdvbkfqzctcerbx`;
- campanha principal: `yuhara-main`;
- serviços usados/históricos: PostgreSQL, Auth, RLS, functions/RPCs.

É a **única base canônica** do reboot. Não criar um Supabase novo para contornar migration/legado.

## Responsabilidades

Supabase guarda:

- identidades/profiles e authorization metadata;
- sessions/evidence/transcripts;
- review/candidates/canon/publications;
- entities/memory;
- job/artifact metadata;
- provenance e integrações.

Não é destino obrigatório de áudio bruto do reboot.

## Acesso do site público

A aplicação Next executa consulta server-side estreita de conteúdo publicado. A secret usada atualmente possui poderes elevados; mitigação vem de boundary server-side e seleção explícita.

Não expor essa credencial ao client.

## Auth

`auth.users` se liga a `profiles.auth_user_id`. Login é identidade inicial; authorization exige profile + capability/scope.

## RLS

RLS está habilitado nas 43 tabelas públicas observadas. Muitas estão sem policy e portanto fechadas por padrão para roles sujeitas ao RLS.

Não abrir policy genérica para simplificar UI.

## RPCs

O legado utiliza RPCs `SECURITY DEFINER` para identity/access/review. Antes do Edit público, inventariar consumer e authorization interna função a função.

Ver [segurança do banco](../database/security.md).

## Migrations

Novas DDL do reboot:

- entram em `supabase/migrations`;
- são aplicadas de modo controlado;
- devem corresponder à migration history remota;
- atualizam documentação de schema/domínio.

Ver [migrations](../database/migrations.md).

## Queries do produto

Regras:

- filtrar campaign explicitamente;
- selecionar somente colunas necessárias;
- não usar `select('*')` em superfície pública sem justificativa;
- não transportar metadata/raw transcript por conveniência;
- normalizar/validar payload para model de domínio antes de renderizar;
- erros de credencial/configuração devem gerar estado explícito, não dados falsos.

## Service/secret key

Permitida apenas server-side/worker controlado enquanto for necessária. É dívida reconhecida para fronteira pública; futuro pode introduzir view/RPC/role com privilégio menor.

## Backup e produção

Produção contém dados reais e não é resetável. Mudança destrutiva exige plano explícito, verificação de dependências e backup/rollback apropriado.

## Observabilidade mínima

- migration history;
- advisor security/performance;
- erros de query/RPC;
- row counts/invariantes em auditorias;
- auth failures;
- logs server-side sem secrets.

## Failure modes

### Chave ausente

Site deve mostrar estado de preparação/configuração, sem inventar sessions.

### Schema drift

Parar mudança e reconciliar migration history + schema físico + repo.

### RLS bloqueando consumidor legítimo

Investigar capability/policy/grant correto. Não resolver distribuindo service key para client.

### RPC quebrando legado

Restaurar compatibilidade ou migrar consumer antes de remover contrato antigo.

## Referências

- [Banco](../database/README.md)
- [Segurança](../database/security.md)
- [ADR — Supabase existente](../adr/0002-existing-supabase.md)
