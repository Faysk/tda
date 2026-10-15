# 📈 Estatísticas privadas de transcrições

**Para quem:** membros de campanhas autorizadas. **Não é uma API pública** e não exibe falas privadas ao calcular os totais.

## Para que serve?

A página `/transcricoes` apresenta sessões e métricas agregadas da campanha selecionada, incluindo sessões sem transcrição. O documento dono registra essa solução como **publicada em Production em 28/09/2026**; a data é uma evidência histórica, não garantia de disponibilidade atual para toda conta.

## Como consultar

1. Entre numa conta que tenha `campaign.transcript.read` para a campanha. **Login por si só não basta**.
2. Abra [Transcrições](https://dnd.faysk.dev/transcricoes) ou o acesso pela área da conta, quando disponível.
3. Selecione a campanha correta; `?campanha=slug` identifica o conjunto escolhido, não uma soma global de campanhas.
4. Leia os totais **junto com a cobertura**. Sem segmentos, as palavras são desconhecidas; texto vazio explicitamente informado equivale a zero.
5. Depois de editar ou importar, **recarregue a tela**: uma aba aberta não promete atualização instantânea.

| Métrica | O que significa |
| --- | --- |
| Sessões | Conjunto autorizado da campanha selecionada |
| Palavras | Contagem operacional dos textos de segmentos, não análise linguística |
| Duração | `sessions.duration_ms` quando realmente registrada |
| Cobertura | Número de sessões com valor conhecido, separado de total de sessões |
| Ausência | Não informado; **não** se deve inventar zero nem duração pelo último segmento |

**Exemplo inventado:** três sessões, mas só duas possuem duração. Exibir o total conhecido e “cobertura 2 de 3” é mais correto do que deduzir o terceiro valor.

## Como a segurança funciona

~~~mermaid
flowchart TD
  A["Usuário autenticado"] --> B{"Capability na campanha?"}
  B -->|Não| C["Acesso negado"]
  B -->|Sim| D["Servidor filtra sessões"]
  D --> E["Agregados autorizados"]
  E --> F["Totais e cobertura"]
~~~

A autorização acontece **antes** da consulta. A tela não abre uma API pública de estatísticas nem serializa texto de transcrições para o navegador. Grants que valem somente para uma sessão ou recurso não são ampliados automaticamente para toda a campanha.

## Problemas comuns

**Não aparece a página.** Confira o contexto da campanha e `campaign.transcript.read`.

**Números antigos.** Recarregue após terminar a edição/importação.

**Total de palavras ou duração ausente.** É possível que os dados não tenham sido registrados; não trate ausência como zero.

Se uma consulta parcial falhar, o contrato determina indisponibilidade, não um total incompleto apresentado como definitivo.

**Fontes:** [Contrato da página e métricas](https://github.com/Faysk/tda/blob/main/docs/features/transcript-statistics.md) · [Permissões](https://github.com/Faysk/tda/blob/main/docs/domains/identity-access.md) · [Leitura de transcrições](https://github.com/Faysk/tda/blob/main/docs/features/edit-transcript-server-slice.md).

Continue: [Edit e revisão](https://github.com/Faysk/tda/wiki/Edit-e-revisao) · [Segurança](https://github.com/Faysk/tda/wiki/Seguranca-e-permissoes) · [Disponibilidade](https://github.com/Faysk/tda/wiki/Funcionalidades-e-estados).
