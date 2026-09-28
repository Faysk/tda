# Media Storage — governança (provider atual: R2)

> Status: vigente
> Owner: integrations/media (Balde), em coordenação com infraestrutura/operação (Nuvem)
> Última revisão: 2026-09-29

ADR-0018 define o boundary de Media Storage. **Cloudflare R2 é a implementação canônica vigente de todo blob/object storage do TDA.** `Media Storage` é um nome de domínio/arquitetura, não um provider paralelo. Public, private e preview são boundaries R2; não existe outro backend de blobs configurado.

Detalhamento: `r2/README.md`. Estado operacional dinâmico continua em `docs/infrastructure.md`, `docs/operations/` e evidências datadas. Portabilidade futura continua permitida, mas só passa a existir operacionalmente mediante ADR, migração e atualização documental explícitas.
