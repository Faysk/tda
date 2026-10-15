# 📊 Qualidade do reconhecimento de fala (ASR)

> **Para quem:** usuários avançados, revisores e pessoas que querem escolher um perfil Qwen/Whisper com critérios verificáveis.

## Um modelo mais lento é sempre melhor?

Não é possível afirmar isso para toda gravação. Uma medição honesta compara os motores na **mesma amostra**, com **texto de referência corrigido por uma pessoa**, preservando os resultados originais e a identidade da amostra. Uma execução rápida ou um output “bonito” não é uma nota de qualidade.

O benchmark documentado pelo TDA compara **quatro perfis** numa amostra inicial de cinco minutos. Os outputs são preservados como artefatos locais; criar referência e calcular métrica **não publica transcrição nem canon**.

~~~mermaid
flowchart LR
  A["Mesmo trecho da gravação"] --> Q["Qwen quality/fast"]
  A --> W["Whisper detailed/turbo"]
  Q --> O["Outputs preservados"]
  W --> O
  O --> H["Referência humana versionada"]
  H --> M["Métricas por perfil"]
~~~

## O que significam os números?

| Métrica | Explicação prática |
| --- | --- |
| **WER** | Taxa de erros em palavras, comparando com a referência humana |
| **CER** | Taxa de erros em caracteres |
| **S/D/I** | Substituições, deleções e inserções em relação à referência |
| **Por track** | Resultado de cada faixa/participante, quando o contrato permite |
| **Glossário** | Fidelidade dos termos específicos da campanha |
| **Timing** | Qualidade de alinhamento, somente com referência temporizada suficiente |

A fórmula básica do WER é:

```text
WER = (substituições + deleções + inserções) / palavras da referência
```

Um WER **pode superar 100%** quando há inserções suficientes. Não se deve limitar o resultado artificialmente a 100%.

## Referência Level 1, Level 2 e Level 3

- **Level 1:** texto por faixa; permite WER, CER, S/D/I e avaliação de glossário.
- **Level 2:** referência com turns temporizados; pode acrescentar medições de tempo, speaker e overlap.
- **Level 3:** referência alinhada por palavra é capacidade opcional/futura; não há suporte presumido.

**Nenhum score composto e nenhum “campeão automático”.** Em uma campanha com muitos nomes próprios, o glossário pode importar tanto quanto a taxa geral de palavras. Compare as métricas separadamente e considere falhas de preparação ou compatibilidade.

## Exemplo didático (não é um resultado medido no TDA)

Se uma referência tem 100 palavras e um perfil troca 5, omite 3 e adiciona 2, então WER = (5+3+2)/100 = **10%**. Esse número é apenas uma conta ilustrativa; não representa Qwen, Whisper ou uma gravação real.

## Cuidados importantes

- A referência humana precisa pertencer **à mesma amostra** e não deve ser alterada silenciosamente durante a comparação.
- Comparações incompletas ou sem artefatos antigos aparecem como **qualidade não medida**, não como nota zero.
- Um modelo que conclui ASR não recebeu aprovação editorial; benchmark não autoriza publicação.
- O aceite físico em GPU exige evidência própria; testes sintéticos comprovam apenas o que testaram.

**Fonte técnica:** [Contrato de qualidade ASR](https://github.com/Faysk/tda/blob/main/docs/features/processing-benchmark-quality.md) e [Processamento local](https://github.com/Faysk/tda/blob/main/docs/features/local-processing.md).

Próximo: [Companion](https://github.com/Faysk/tda/wiki/Companion-e-IA) · [Recuperação e exclusão](https://github.com/Faysk/tda/wiki/Resultados-locais-e-exclusao) · [Termos](https://github.com/Faysk/tda/wiki/Glossario)
