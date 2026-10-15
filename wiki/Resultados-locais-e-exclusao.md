# 🧰 Resultados locais, recuperação e exclusão

> **Para quem:** operadores autorizados e pessoas com trabalho de transcrição no próprio computador. **Objetivo:** não perder gravações ou resultados ao lidar com falha, retry ou limpeza.

## O que fica salvo?

O Companion mantém sources, estados de job, runs, revisões e outros dados técnicos no computador. Um **run** representa a saída de uma tentativa concreta do processamento e não deve ser alterado “por cima” depois de uma correção humana.

~~~mermaid
flowchart TD
  A["Fonte local"] --> J["Job / tentativa"]
  J --> R["Run imutável"]
  R --> V["Revisão derivada"]
  V --> P["Publicação explícita"]
  J --> F{"Falhou?"}
  F -->|Sim| RE["Retry ou recuperação compatível"]
  RE --> R2["Novo resultado / tentativa"]
  F -->|Não| R
~~~

Um retry pode aproveitar checkpoints compatíveis quando existe evidência suficiente. Quando não existe, pode precisar retranscrever: não se deve inventar a compatibilidade para economizar GPU.

## O que fazer se houver interrupção?

1. Observe o estado no Desktop/Agent e anote identificador do job, versão do aplicativo e runtime, sem copiar informações privadas.
2. Confira o diagnóstico no [runbook oficial](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md); evite reiniciar, remover ou apagar pastas precipitadamente.
3. Diferencie *job ainda executando*, *falha recuperável*, *cancelamento* e *resultado concluído*.
4. Use apenas o retry/recovery compatível com a versão e mantenha os runs anteriores preservados.
5. Se o problema afetar publicação ou revisão, trate o estado editorial em separado.

## Excluir não é arquivar nem remover publicação

A ADR-0021 define a exclusão local atual. Uma exclusão confirmada registra um **tombstone** (comprovante durável de remoção) antes de concluir a limpeza dos bytes, para preservar a integridade após falhas. O diretório interno de quarentena existe para uma operação segura, **não para oferecer uma lixeira restaurável**.

| Ação | Significado |
| --- | --- |
| **Excluir resultado local** | Remoção local confirmada, sem botão de restauração de 7 dias |
| **Retry** | Nova tentativa sem destruir silenciosamente um run anterior |
| **Revisar** | Criar nova versão humana derivada |
| **Restaurar revisão publicada** | Operação editorial distinta, com histórico cloud próprio |
| **Remover publicação** | Deixar de disponibilizar uma revisão publicada, sem implicar delete do source local |

**Não prometa “Undo”, lixeira de sete dias ou recuperação depois de delete confirmado.** A quarentena técnica é mecanismo transacional interno, não recurso de produto.

### Antes de confirmar uma remoção

- Verifique exatamente **qual resultado e fonte** serão afetados.
- Confirme se a operação é realmente exclusão local, não unpublish.
- Não suponha que remover run apague publicações já feitas na cloud.
- Se existir conflito, falha ou dúvida de dependências, interrompa a ação e use o runbook.

## Aprofunde nos contratos vigentes

[ADR-0021 — delete local](https://github.com/Faysk/tda/blob/main/docs/adr/0021-local-run-delete-tombstone.md) · [Runs e revisão](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md) · [Diagnóstico e recuperação](https://github.com/Faysk/tda/blob/main/docs/operations/local-companion.md) · [Confiabilidade do Companion](https://github.com/Faysk/tda/blob/main/docs/operations/companion-reliability.md).

Próximo: [Edit](https://github.com/Faysk/tda/wiki/Edit-e-revisao) · [Qualidade ASR](https://github.com/Faysk/tda/wiki/Qualidade-ASR) · [Releases](https://github.com/Faysk/tda/wiki/Operacoes-e-releases)
