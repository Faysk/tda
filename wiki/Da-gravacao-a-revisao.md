# 🎧 Da gravação à transcrição revisada — exemplo completo

> **Para quem:** pessoa que quer entender o caminho entre uma sessão gravada e a memória pronta para revisão. **Tipo de exemplo:** totalmente sintético, sem áudio ou informações de campanhas reais.

## O cenário

Um grupo jogou uma sessão chamada **A Ponte Antiga**. A gravação foi interrompida e retomada, formando duas fontes Craig. Uma pessoa autorizada quer obter a transcrição, corrigir erros de nomes próprios e decidir se existe material adequado para publicar.

**Resultado esperado:** uma transcrição **revisada**, com fontes preservadas; nada será publicado ou transformado em canon automaticamente.

## O fluxo de ponta a ponta

~~~mermaid
flowchart TD
  A["Duas fontes Craig da mesma sessão"] --> B["Companion local"]
  B --> C["Runs ASR individuais"]
  C --> D["Session Assembly validada"]
  D --> E["Revisão humana derivada"]
  E --> F{"Confirmação e capability para publicar?"}
  F -->|Não| G["Conservar revisão não publicada"]
  F -->|Sim, no ambiente habilitado| H["Revision publicada + receipt"]
  H --> I["Projeção pública autorizada"]
  H -.-> K["Canon continua decisão editorial separada"]
~~~

O esquema reúne contratos de processamento, *multi-recording* e publicação. **Não representa uma sequência de botões idêntica em todas as versões**: instalação, flags e capacidades podem diferir.

## Etapa 1 — conferir a origem e a autorização

A pessoa responsável identifica a campanha e a sessão corretas, sem usar identificadores de outra campanha. As duas fontes podem conter áudio sobreposto, com lacunas ou nomes distintos do mesmo participante.

**Não** suba áudio privado para a Wiki, não altere o source ZIP nem presuma que dois arquivos precisam ser concatenados.

## Etapa 2 — obter resultados locais

No Edit, com o Agent compatível conectado, o operador escolhe uma configuração de ASR disponível. Cada tentativa mantém seu **run** imutável; executar novamente não apaga o run anterior.

| Item | Exemplo sintético |
| --- | --- |
| Fonte | Craig A e Craig B |
| Perfil | Um perfil Qwen ou Whisper preparado |
| Resultado bruto | Texto reconhecido com possíveis erros |
| Erro plausível | Nome do personagem escrito de forma incorreta |
| Correção humana | Criar nova revisão derivada, preservando o original |

O resultado “concluído” é **local**, não uma publicação na nuvem.

## Etapa 3 — reunir e revisar

1. Use a associação das fontes à mesma sessão (*recording parts*).
2. Revise a ordem cronológica e a evidência temporal; não invente intervalo nem remova falas sobrepostas por semelhança.
3. Se o contrato permitir, forme uma **Session Assembly** que referencie os runs selecionados.
4. Leia o texto na ordem correta, identifique falas e participantes e corrija somente o que puder ser confirmado.
5. Guarde a revisão com controle de concorrência: se outra pessoa salvou uma versão mais recente, reavalie o conflito em vez de sobrescrevê-la.

A revisão deriva do texto bruto e preserva a proveniência. “Esta frase apareceu no áudio” e “o personagem fez isso no canon” **não são a mesma afirmação**.

## Etapa 4 — decidir sobre publicação

Somente um fluxo autorizado, com revisão elegível e **confirmação explícita**, pode publicar no ambiente habilitado. O contrato de publicação possui revisions, current pointer e receipts; o rollout do runtime é separado do schema.

**Se a feature flag estiver desabilitada ou não houver capability:** mantenha a revisão sem publicar. Não contorne o controle com chamadas diretas ou banco de dados.

## Etapa 5 — manter o histórico e corrigir depois

Uma nova revisão publicada pode substituir a revisão corrente sem apagar a anterior. **Unpublish, restore de revisão publicada e delete local** são operações distintas.

### Checklist final

- [ ] A sessão e a campanha são as corretas.
- [ ] Cada source e run possuem proveniência verificável.
- [ ] Não houve perda/duplicação inventada de áudio.
- [ ] Alterações humanas não sobrescreveram bytes brutos do modelo.
- [ ] Permissão, flag e revisão foram conferidas antes da publicação.
- [ ] Texto publicado não foi automaticamente promovido a canon.
- [ ] O áudio privado não saiu para a Wiki pública.

## Continue aprendendo

[Múltiplas gravações](https://github.com/Faysk/tda/wiki/Multiplas-gravacoes) · [Recuperação e exclusão](https://github.com/Faysk/tda/wiki/Resultados-locais-e-exclusao) · [Como comparar Qwen e Whisper](https://github.com/Faysk/tda/wiki/Qualidade-ASR).

**Fontes canônicas:** [Processamento Web](https://github.com/Faysk/tda/blob/main/docs/features/local-processing.md), [Assembly e fontes](https://github.com/Faysk/tda/blob/main/docs/features/multi-recording-sessions.md), [Revisão e publicação](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md) e [Proveniência e evidência](https://github.com/Faysk/tda/blob/main/docs/domains/evidence.md).
