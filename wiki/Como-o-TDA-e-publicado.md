# 🚀 Como uma mudança chega ao TDA

**Para quem:** contribuidores e pessoas curiosas sobre atualizações. **Objetivo:** diferenciar projeto, testes, integrações, implantação e publicação editorial.

## Por que o botão novo não aparece depois de uma PR?

Porque uma proposta de código revisada e integrada **não significa** que a aplicação de produção tenha recebido aqueles bytes. O TDA usa GitHub Actions como controlador da entrega e requer etapas e evidências específicas para publicação.

~~~mermaid
flowchart TD
  A["Branch + pull request"] --> B["Checks de qualidade"]
  B --> C["Revisão e integração em main"]
  C --> D["Preview manual do SHA exato"]
  D --> E["Validação e aprovação"]
  E --> F["Production CD deliberado"]
  F --> G["Health/smoke e receipt"]
  G -.->|"se falhar"| H["Rollback controlado"]
~~~

O fluxo resume a **política deliberada documentada em 15/10/2026**, não autoriza executar deploy a partir desta página. O status de cada etapa depende do commit e dos workflows efetivamente concluídos.

## Palavras parecidas, responsabilidades diferentes

| Nome | Em linguagem simples |
| --- | --- |
| **CI** | Executar verificações em código e contratos |
| **PR** | Proposta em revisão; pode falhar, mudar ou ser rejeitada |
| **main** | Linha canônica do repositório |
| **Preview** | Ambiente para testar o SHA da mudança |
| **Staged** | Artefato preparado para uma validação controlada |
| **Production** | Versão realmente disponibilizada pelo ambiente |
| **Receipt** | Comprovante verificável de bytes, SHA, ambiente e operação |
| **Rollback** | Operação de recuperação para artefato/estado anterior |
| **Publicação editorial** | Disponibilizar uma transcrição ou lore revisada; não é um deploy |

## O que mudou na política de publicação

O contrato operacional do TDA declara **Preview de main por disparo manual**, com SHA de origem exato, e **Production manual** com aprovações e evidências anteriores. A presença de CI verde por si só não dispara automaticamente um novo deploy de produção.

O Companion Windows também tem ciclo separado: Agent, Desktop, MSI e motores de IA podem ter versões e aceites físicos próprios. Uma build sintética verde **não comprova** uma instalação real funcionando numa GPU específica.

## Como identificar o que está disponível agora

1. Consulte [o catálogo de features](https://github.com/Faysk/tda/blob/main/docs/feature-catalog.md) para o estado contratual.
2. Abra o documento dono da funcionalidade e confira se ele fala de candidato, main ou artefato publicado.
3. Para decisões de produção, confira receipts e saúde do ambiente com o responsável pela operação.
4. Não confunda “schema criado” com “migration aplicada” ou “editor aprovou texto” com “site foi atualizado”.

## E a própria GitHub Wiki?

Esta Wiki possui um Git separado do código principal. Uma PR que muda `wiki/*.md` é apenas **fonte versionada**. A publicação na aba Wiki requer cópia controlada, comparação com a versão remota e verificação de páginas e links. Isso é **outro processo**, independente do deploy do site.

**Fontes:** [CI/CD vigente](https://github.com/Faysk/tda/blob/main/docs/operations/ci-cd.md) · [Release e rollback](https://github.com/Faysk/tda/blob/main/docs/operations/release-runbook.md) · [Documentação viva](https://github.com/Faysk/tda/blob/main/docs/documentation/README.md) · [Governança de releases](https://github.com/Faysk/tda/blob/main/docs/releases.md).

Continue: [Operações](https://github.com/Faysk/tda/wiki/Operacoes-e-releases) · [Estados das funcionalidades](https://github.com/Faysk/tda/wiki/Funcionalidades-e-estados) · [Atualizar a Wiki](https://github.com/Faysk/tda/wiki/Como-manter-a-Wiki)
