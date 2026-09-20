# Infraestrutura e estado

> Status: vigente
> Owner: infraestrutura/operação
> Última revisão: 2026-09-20
> Fonte de verdade: ADR-0018, runbooks operacionais, providers observados e evidências datadas

Este documento resume **quem faz o quê** na infraestrutura atual. Ele não congela número de Production, deployment ID ou SHA corrente: esses valores mudam com frequência e devem ser verificados no ambiente/receipt correspondente.

## Modelo atual

| Capability | Contrato do TDA | Provider atual | Política |
| --- | --- | --- | --- |
| control plane | Git + configuração declarativa + CI/CD | GitHub / GitHub Actions | canônico |
| runtime/deploy web | runtime web substituível | Vercel Hobby | provider atual |
| dados relacionais | PostgreSQL + migrations versionadas | Supabase Free | provider atual |
| Media Storage | object/blob storage | Cloudflare R2 Standard | provider atual |
| processamento pesado | execução local recuperável | TDA Companion | local |

A direção estrutural está em [ADR-0018](adr/0018-portable-core-github-control-plane.md): providers são substituíveis e a infraestrutura é free-first.

## GitHub

`Faysk/tda` é a fonte de verdade do reboot.

- `main` é a linha canônica de código aceita para Production;
- GitHub Actions é o controlador de entrega;
- Vercel Git auto-deploy permanece desligado;
- manifests, migrations, ADRs, workflows e documentação ficam versionados;
- secrets operacionais usados por Actions ficam preferencialmente em GitHub Environments;
- merge e publicação são eventos distintos.

O fluxo atual está em [CI/CD — operação, promoção e recuperação](operations/ci-cd.md).

## Runtime/deploy — Vercel

Provider atual: Vercel.

Recursos pinados pela operação:

```text
team:    team_9wuTfarCQ3L63xtufPKUDzi0
project: prj_hDiDvvRiesg3qCDekGWE8JQMkIyH
domain:  https://dnd.faysk.dev
```

A versão efetivamente publicada deve ser comprovada pelo domínio canônico (`/api/version`, `/api/health`) e pelo receipt/histórico da release. Não manter neste arquivo um “Production #N atual” que se torna falso no próximo deploy.

Histórico append-only: [deployments](operations/deployments.md).

## Dados — PostgreSQL / Supabase

Contrato principal: PostgreSQL e migrations versionadas.

Provider atual:

```text
Supabase project: dmrqnbdvbkfqzctcerbx
```

ADR-0002 continua válido para reutilizar a base existente enquanto ela atende ao TDA. Supabase não é identidade permanente da arquitetura.

Migration integrada no Git não prova aplicação remota. Estado de schema e aplicação deve ser confrontado com:

- [migrations](database/migrations.md);
- [segurança](database/security.md);
- [verification log](database/verification-log.md);
- [runbook de banco](operations/database-runbook.md).

## Media Storage — Cloudflare R2

Provider atual: Cloudflare R2.

```text
public:  tda-media-public
private: tda-media-private
preview: tda-media-preview
origin:  https://media.dnd.faysk.dev
```

Evidências históricas comprovam uso real do bucket público e entrega por `media.dnd.faysk.dev`. Private/preview permanecem boundaries restritos e não são fallback público.

A regra permanente é **Media Storage**, não “R2 para sempre”. Ver [integração atual](integrations/r2.md) e [ADR-0018](adr/0018-portable-core-github-control-plane.md).

### Controle operacional do publisher

A Production CD usa GitHub Environment `production` como boundary dos secrets operacionais do provider R2 e calcula mídia pendente desde o SHA realmente publicado até o novo `main`.

O workflow valida as credenciais somente quando esse lifecycle é necessário e falha antes de build/stage quando alguma estiver ausente.

A PR #414 integrou esse contrato e a Production CD subsequente foi promovida com o lifecycle de mídia corretamente `skipped`, porque o baseline já havia ultrapassado Astel/Noah durante o comportamento antigo.

Para recuperar essa dívida anterior ao novo planner, a repair release de 2026-09-20 altera somente a ordenação JSON dos manifests `astel.json` e `noah.json`, sem mudar assets, hashes, bytes, MIME, keys ou URLs. O objetivo é recolocar explicitamente esses dois manifests no range não publicado e obrigar a pipeline compartilhada a publicar/reutilizar + read-back + public verification.

Esse reparo é excepcional e não vira mecanismo normal de retry: a partir da #414, manifests de uma release falha permanecem acumulados automaticamente até Production alcançá-los.

Configuração documental não prova secret existente, e manifest não prova objeto publicado. O aceite do reparo exige receipt com contagens reais e verificação pública.

## Custos

Política: **free-first**.

Hoje os providers/tier atuais foram escolhidos porque atendem o uso observado sem custo recorrente necessário. Não habilitar serviço/tier pago por conveniência.

Quando um limite real aparecer:

1. medir a necessidade;
2. tentar otimização;
3. comparar alternativa gratuita/self-host/novo provider;
4. comparar upgrade;
5. documentar a decisão antes de criar custo recorrente.

Custo zero nunca justifica enfraquecer segurança, integridade, backup necessário ou autorização.

## Como descobrir o estado real

Use a fonte apropriada:

| Pergunta | Fonte |
| --- | --- |
| qual código está aceito? | `main` |
| qual versão está servindo? | `dnd.faysk.dev/api/version` + release receipt |
| qual deployment foi promovido? | Vercel + `operations/deployments.md` |
| migration foi aplicada? | verification log/runbook do banco |
| objeto de mídia foi publicado? | receipt/read-back/GET público da operação |
| qual provider devemos usar hoje? | este documento + ADR-0018 |
| qual era o estado numa data antiga? | auditoria/evidência datada |

**CI verde, manifest versionado ou merge em `main` não substituem evidência de mutação remota.**
