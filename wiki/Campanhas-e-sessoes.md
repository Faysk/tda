# 📅 Campanhas e sessões

Uma **campanha** agrupa uma jornada narrativa. Uma **sessão** é um encontro registrado nessa jornada; pode ter data, título, arco, participantes, fonte de gravação, resumo e, quando aprovado, material publicável.

## Como encontrar uma sessão

1. Abra [Campanhas](https://dnd.faysk.dev/campanhas).
2. Escolha um cartão público e selecione **Abrir campanha** ou **Sessões**.
3. Na lista de sessões, procure pelo título, data ou contexto disponível.
4. Abra o registro para ler o resumo publicado; a publicação pode não conter transcrição integral.

A página de campanhas só lista campanhas **ativas e públicas**. Ausência de uma campanha não confirma sua inexistência no banco. Cartões podem usar capa aprovada ou imagens públicas de sessões; campos ausentes não devem gerar histórias inventadas.

## De uma gravação a uma memória

~~~mermaid
flowchart LR
  C["Campanha"] --> S["Sessão"]
  S --> P["Participantes"]
  S --> E["Evidências"]
  E --> R["Revisão"]
  R --> U["Resumo/publicação"]
  U --> L["Leitura pública"]
~~~

**Evidência** (gravação, anotação ou transcrição) não é automaticamente uma verdade da história. Uma fala pode ser boato, erro, interpretação ou segredo. O que é publicado deve respeitar revisão e audiência.

## Pessoa, personagem e participação não são a mesma coisa

- **Pessoa/perfil:** identidade de um usuário.
- **Personagem:** entidade narrativa, mesmo que a pessoa que a interpreta mude.
- **Participante:** presença ou papel em **uma sessão específica**.
- **NPC:** figura do universo narrativo, que não precisa de conta de usuário.

Uma correspondência entre nomes históricos não autoriza inventar quem controlava um personagem.

## Uma sessão existe, mas não está pública?

Uma sessão pode atravessar estados como gravação, processamento, revisão, aprovação e publicação. Nem todas essas etapas são automáticas. O site público não deve revelar rascunhos, notas privadas ou arquivos brutos.

### Dúvidas comuns

**Por que não encontro uma transcrição?** Processar áudio não significa aprovar ou publicar texto. **Duas campanhas podem ter gravações com o mesmo identificador de origem?** Sim: a identidade interna é contextual à campanha e às regras de dados, não apenas ao número externo da gravação.

**Fontes canônicas:** [campanhas/sessões/participantes](https://github.com/Faysk/tda/blob/main/docs/domains/sessions.md), [diretório público](https://github.com/Faysk/tda/blob/main/docs/features/campaign-directory.md), [revisão e publicação](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md).

Continue: [Mundo e entidades](https://github.com/Faysk/tda/wiki/Mundo-e-entidades) · [Lore e imagens](https://github.com/Faysk/tda/wiki/Lores-e-Lembra)
