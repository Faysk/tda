# 🎙️ Quando uma sessão tem várias gravações

> **Para quem:** jogadores curiosos e editores autorizados. **Objetivo:** entender como o TDA preserva uma mesma sessão de RPG gravada em duas ou mais partes.

## O problema em linguagem simples

Imagine que a mesa começou às 20h. O Craig gravou a primeira parte, caiu às 21h10 e recomeçou alguns minutos depois. Agora existem dois ZIPs, mas **apenas uma sessão de jogo**. Juntar os arquivos sem critério pode trocar a ordem, duplicar falas ou perder a origem de cada trecho.

O TDA trata a **sessão** como unidade narrativa, e cada ZIP Craig como uma **fonte independente**. Isso permite reprocessar uma gravação sem alterar silenciosamente outra.

## As partes do fluxo

~~~mermaid
flowchart TD
  S["Sessão de RPG"] --> P1["Parte A · ZIP Craig"]
  S --> P2["Parte B · ZIP Craig"]
  P1 --> R1["Run ASR A"]
  P2 --> R2["Run ASR B"]
  R1 --> W["Workspace de sessão"]
  R2 --> W
  W --> A["Session Assembly imutável"]
  A --> REV["Revisão derivada"]
  REV -.-> PUB["Publicação explícita"]
~~~

**O diagrama é um exemplo sintético de duas partes**, não uma gravação real. O fluxo suporta uma ou várias fontes.

| Conceito | Significado |
| --- | --- |
| **Recording Part** | Participação de uma fonte na sessão, sem copiar todo o áudio |
| **Source** | Arquivo de origem identificado pelo próprio conteúdo |
| **Run** | Resultado imutável de uma tentativa de reconhecimento de fala |
| **Workspace** | Organização local ainda editável: partes, ordem e participantes |
| **Assembly** | Fotografia imutável de uma composição validada da sessão |
| **Review** | Correções humanas derivadas da assembly, sem adulterar o original |

## O que acontece se as partes se sobrepõem?

O sistema distingue **intervalos vazios (gaps)** de **intervalos sobrepostos (overlaps)**. A solução conservadora preserva material quando não é possível provar duplicação; não apaga frases parecidas por adivinhação. A ordenação automática depende de evidência temporal confiável; em casos ambíguos, uma pessoa pode confirmar a continuidade.

~~~mermaid
flowchart TD
  A["Duas gravações"] --> B{"Cronologia confiável?"}
  B -->|Sim| C["Ordenação por evidência"]
  B -->|Não| D["Confirmação editorial de ordem"]
  C --> E{"Há overlap?"}
  D --> E
  E -->|Não| F["Preservar gap se comprovado"]
  E -->|Sim| G["Deduplicar só quando comprovado"]
  F --> H["Assembly auditável"]
  G --> H
~~~

## Como trabalhar sem perder dados?

1. Escolha a campanha e a sessão corretas, com permissão adequada.
2. Associe cada fonte separadamente à sessão; evite concatenar ZIPs manualmente.
3. Aguarde/seleccione um run terminal válido por parte; não sobrescreva o output original do modelo.
4. Revise ordem, intervalos, participante e conflitos antes de criar uma assembly.
5. Faça a revisão do resultado composto e **publique apenas se houver aprovação explícita**.

**Atenção:** a fundação multi-recording foi descrita como implementada com gates técnicos; isso **não comprova por si só** que determinado MSI ou instalação tem todos os comportamentos. Confira artefato/versão e estado do ambiente.

### O que não deve acontecer

- Fazer upload obrigatório do áudio bruto para a nuvem.
- Concatenar fontes e apagar a proveniência.
- Associar perfis humanos por coincidência de apelido.
- Inventar tempo de silêncio ou duplicação sem evidência.
- Publicar automaticamente ao terminar o ASR.

## Fontes e continuação

[Contrato multi-recording](https://github.com/Faysk/tda/blob/main/docs/features/multi-recording-sessions.md) · [ADR-0019](https://github.com/Faysk/tda/blob/main/docs/adr/0019-multi-recording-session-assembly.md) · [ADR-0022](https://github.com/Faysk/tda/blob/main/docs/adr/0022-conservative-overlap-resolution.md) · [Revisão e publicação](https://github.com/Faysk/tda/blob/main/docs/features/transcript-review-publication.md).

Próximo: [Edit](https://github.com/Faysk/tda/wiki/Edit-e-revisao) · [Companion](https://github.com/Faysk/tda/wiki/Companion-e-IA) · [Resultados e exclusão](https://github.com/Faysk/tda/wiki/Resultados-locais-e-exclusao)
