# 📝 Edit, transcrições, revisão e publicação

**Para quem:** editores, mestres e operadores **com as permissões necessárias**. Este guia explica o fluxo, não concede acesso nem publica conteúdo.

## A ideia em uma frase

O **Edit** organiza trabalho editorial: recebe ou referencia evidências, ajuda a revisar resultados e controla decisões explícitas de publicação. A gravação e os dados privados não devem aparecer na Wiki.

## Entenda o fluxo completo

~~~mermaid
flowchart TD
  A["Fonte Craig / gravação local"] --> B["TDA Companion"]
  B --> C["Processamento ASR local"]
  C --> D["Run concluído e imutável"]
  D --> E["Comparar / corrigir transcrição"]
  E --> F["Revisão e aprovação humana"]
  F --> G{"Autorização e publicação explícita?"}
  G -->|Sim| H["Revision publicada + receipt"]
  G -->|Não| I["Permanece local/não publicado"]
  H --> J["Conteúdo elegível a projeções públicas"]
  H -.-> K["Canon é decisão editorial separada"]
~~~

**Quatro separações fundamentais:**
1. O ASR processa áudio e produz texto; **não publica sozinho**.
2. Um **run** é o resultado preservado de uma tentativa, não um rascunho mutável.
3. **Revisão/aprovação** é escolha editorial autorizada.
4. **Publicação** não equivale automaticamente a **canon**.

O protocolo do job mantém auto-sync como “not configured”; isso **não** apaga o fluxo explícito de revisão/handoff/publicação descrito no contrato vigente. O uso real ainda depende de flags, autorização e evidência de ativação do ambiente.

## Como reconhecer um trabalho seguro

- Antes de iniciar, confirme a campanha e sua autorização.
- Se uma sessão tiver várias gravações, o processo pode formar uma **Session Assembly** preservando as fontes e a proveniência.
- Erro de rede ou etapa de ASR não é autorização para excluir gravações, sobrescrever runs nem tentar publicar um texto parcial.
- Uma correção editorial deve preservar versão e resolver conflitos de revisão; publicação deve ter identificação verificável.

## E se der erro?

| Sintoma | Verifique primeiro |
| --- | --- |
| Companion não conecta | Agent local em execução, compatibilidade e sessão de conexão |
| Processamento foi concluído mas texto não aparece na Web pública | Conclusão local não cria publicação automática |
| Revisão em conflito | Consulte a revisão vigente antes de tentar salvar de novo |
| Job com falha/cancelado | Histórico de attempts, checkpoints e recovery previstos |
| Outra campanha aparece | Não retaggear run; revisar contexto e capability |

Não execute comandos de reparo destrutivos sem seguir o runbook autorizado.

## Fonte de verdade

- [Edit Workbench](https://github.com/Faysk/tda/blob/main/docs/features/edit-workbench.md)
- [Processamento Web/local](https://github.com/Faysk/tda/blob/main/docs/features/local-processing.md)
- [Runs, revisão e publicação](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md)
- [Múltiplas gravações](https://github.com/Faysk/tda/blob/main/docs/features/multi-recording-sessions.md)
- [Canon, fontes e aprovação](https://github.com/Faysk/tda/blob/main/docs/domains/canon-review.md)
- [ADR-0016](https://github.com/Faysk/tda/blob/main/docs/adr/0016-transcript-runs-review-publication.md)

Continue: [Como funciona o Companion](https://github.com/Faysk/tda/wiki/Companion-e-IA) · [Glossário](https://github.com/Faysk/tda/wiki/Glossario)


## Exemplo prático sem dados privados

Veja [A Ponte Antiga — um percurso sintético da gravação à revisão](https://github.com/Faysk/tda/wiki/Da-gravacao-a-revisao) para acompanhar cada etapa e identificar os pontos de aprovação.


## Estatísticas de sessões e transcrições

A leitura privada de totais, duração, palavras e cobertura está explicada em [Estatísticas privadas de transcrições](https://github.com/Faysk/tda/wiki/Estatisticas-de-transcricoes). Ela exige autorização de campanha e não equivale à API pública de sessões.
