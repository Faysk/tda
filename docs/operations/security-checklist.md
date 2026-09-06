# Checklist de segurança operacional

> Status: vigente
> Owner: security/operations
> Última revisão: 2026-09-06

Use antes de abrir uma nova superfície, publicar release ou alterar integração sensível.

## Identidade e autorização

- [ ] usuário é autenticado no boundary correto;
- [ ] `auth_user` resolve para profile quando necessário;
- [ ] ação é validada por capability + scope no servidor/RPC;
- [ ] campaign/resource pertence ao scope permitido;
- [ ] UI não é o único controle de autorização;
- [ ] há testes negativos para usuário sem permissão.

## Dados

- [ ] payload retorna somente campos necessários;
- [ ] transcript/raw metadata não entram em endpoint público por acidente;
- [ ] conteúdo master/private possui audience explícita;
- [ ] outtake sensitive respeita consent/approval próprio;
- [ ] logs não despejam PII/transcript/secrets;
- [ ] novos JSONB não escondem relações/segredos sem contrato.

## Supabase

- [ ] migration versionada para DDL/grant/policy/function;
- [ ] RLS revisado;
- [ ] policy não é `true` ampla sem justificativa;
- [ ] `SECURITY DEFINER` valida auth/capability internamente;
- [ ] `EXECUTE` só para roles necessárias;
- [ ] query server-side não usa secret para bypass indiscriminado;
- [ ] advisors revisados quando mudança afeta DB.

## Secrets

- [ ] nenhum secret em Git/docs;
- [ ] nenhum secret em `NEXT_PUBLIC_*`;
- [ ] credencial tem escopo mínimo;
- [ ] Production e Preview não compartilham secret sem necessidade;
- [ ] bootstrap token temporário foi revogado;
- [ ] rotação está documentada quando necessária.

## R2/mídia

- [ ] bucket correto por environment/audience;
- [ ] public access deliberado;
- [ ] URL assinada só após authorization;
- [ ] MIME/origem/path validados;
- [ ] raw audio não foi enviado para cloud sem decisão de retenção;
- [ ] deleção não remove única fonte necessária para review.

## Vercel

- [ ] conta `projeto-desenv-6905` confirmada;
- [ ] environment correto;
- [ ] env vars corretas;
- [ ] auto-deploy continua conforme política;
- [ ] SHA conhecido;
- [ ] rollback conhecido.

## Companion/API externa

- [ ] credencial técnica limitada;
- [ ] idempotency/retry definidos;
- [ ] input externo validado;
- [ ] protocol/schema version validado;
- [ ] key externa armazenada hashed quando aplicável;
- [ ] revogação/expiração possível.

## Canon e IA

- [ ] output de IA continua identificado como derivado;
- [ ] candidate não pula review;
- [ ] source/provenance preservada;
- [ ] confidence não é tratada como aprovação;
- [ ] reprocessamento não sobrescreve decisão humana;
- [ ] embedding/search não muda status canônico.

## Antes de tornar Edit público

Obrigatório resolver/inventariar:

- [ ] RPCs `SECURITY DEFINER` expostas;
- [ ] capabilities de cada ação do Edit;
- [ ] audit trail dos writes críticos;
- [ ] dataset/strategy de Preview;
- [ ] policy de mídia privada;
- [ ] profile claim flow;
- [ ] tests de escalation/cross-campaign;
- [ ] secrets do companion/distribuição.

## Incidente

Se houver possível exposição de secret/dado:

1. revogar/rotacionar credencial;
2. conter acesso público;
3. preservar logs/evidência necessária;
4. identificar superfície/dados afetados;
5. corrigir root cause;
6. documentar decisão/guardrail novo;
7. só restaurar acesso após smoke negativo/positivo.
