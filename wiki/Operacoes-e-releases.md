# 🛡️ Operações e releases

**Para quem:** mantenedores, contribuidores e curiosos. **Este é um guia público**, não um runbook de acesso privilegiado: nenhuma chave, token, log privado ou procedimento de alteração de Production deve ser exposto aqui.

## Etapas diferentes de uma entrega

~~~mermaid
flowchart LR
  A["Branch / PR"] --> B["Checks e revisão"]
  B --> C["Integrado em main"]
  C --> D["Release validada"]
  D --> E["Publicação deliberada"]
  E --> F["Smoke + receipt"]
  F -.->|"se falhar"| G["Rollback"]
~~~

**Validado** significa que algo foi testado para um SHA/artefato específico. **Integrado em main** não quer dizer que está publicado. **Publicado/aplicado** exige evidência do ambiente real. Uma migration no Git não significa que foi aplicada no banco.

## Qual versão usar?

Uma versão de **API**, uma de **Companion MSI**, a do **Agent**, a de **Qwen Runtime**, a de **Whisper Runtime** e o **SHA Web** podem ser diferentes. Para download ou upgrade, consulte a fonte atual de release; números antigos da Wiki não são prova de compatibilidade.

## Onde investigar problemas

| Sintoma | Referência canônica |
| --- | --- |
| Site ou rota indisponível | [Release / rollback](https://github.com/Faysk/tda/blob/main/docs/operations/release-runbook.md) |
| Erro de integração CI | [CI/CD](https://github.com/Faysk/tda/blob/main/docs/operations/ci-cd.md) |
| Companion não inicia | [Companion](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md) |
| Imagem pública 404 | [Media pipeline](https://github.com/Faysk/tda/blob/main/docs/integrations/r2/media-pipeline.md) |
| Banco e migration divergem | [Evolução do banco](https://github.com/Faysk/tda/blob/main/docs/database/migrations.md) |
| Documento contradiz comportamento | [Documentação viva](https://github.com/Faysk/tda/blob/main/docs/documentation/README.md) |

Não tente consertar o ambiente de produção apenas com este resumo. O operador responsável deve seguir os runbooks donos, permissões e comprovantes do artefato exato.

**Fontes:** [Política de release](https://github.com/Faysk/tda/blob/main/docs/releases.md), [Runbook](https://github.com/Faysk/tda/blob/main/docs/operations/release-runbook.md), [Gestão de entregas](https://github.com/Faysk/tda/blob/main/docs/delivery/README.md), [Segurança](https://github.com/Faysk/tda/blob/main/docs/operations/security-checklist.md).

Voltar: [Índice](https://github.com/Faysk/tda/wiki/Indice) · [Desenvolvimento](https://github.com/Faysk/tda/wiki/Desenvolvimento)
