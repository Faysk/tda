# ADR-0022 — Overlap multi-recording usa preservação automática conservadora antes de boundary manual

> Status: accepted
> Data: 2026-10-05
> Decisores: proprietário / maintainers TDA
> Supersede: ADR-0019 (somente a decisão boundary-first de overlap)
> Superseded por: —

## Contexto

ADR-0019 definiu corretamente que overlaps não podem usar fuzzy dedupe destrutivo, mas a primeira formulação ainda tratava resolução/boundary explícito como caminho inicial.

A evolução de #1508/#1513 e PR #1527 introduziu uma política mais segura e menos interruptiva: quando a geometria temporal é confiável, o sistema usa `preserve_both_exact_v1`, preserva ambas as capturas e só colapsa uma duplicata quando existe prova forte e determinística. O happy path de #1531/#1532 não deve elevar uma decisão humana quando o próprio contrato consegue preservar informação sem risco.

## Drivers

- nunca perder fala real por heurística aproximada;
- automatizar trabalho determinístico;
- interromper o operador somente por ambiguidade editorial real;
- manter provenance das duas sources quando houver collapse exato;
- preservar compatibilidade com boundary/trims manuais;
- manter Assembly determinística e versionada.

## Decisão

Para overlaps entre recording parts:

1. **overlap factual confiável** usa `preserve_both_exact_v1` automaticamente;
2. as duas capturas permanecem disponíveis na composição;
3. collapse só ocorre para duplicata comprovada pela policy `trusted_overlap_exact_text_v1`: identidade forte compatível, texto normalizado idêntico e timing global dentro da tolerância estrita;
4. o segmento colapsado preserva provenance das duas origens;
5. diferença de texto, identidade fraca/local ou timing incerto preserva ambas as falas;
6. similaridade textual aproximada/fuzzy nunca autoriza remoção;
7. boundary/trims manuais permanecem fallback avançado para ambiguidade que ainda represente uma decisão editorial real;
8. mudança de policy/resolução participa do fingerprint/canonicalização e cria nova Assembly em vez de alterar snapshot anterior.

## Consequências

### Positivas

- o caso seguro é automático sem sacrificar conteúdo;
- false negative de dedupe é preferido a false positive destrutivo;
- o happy path multi-ZIP não ganha um gate humano só porque existe overlap;
- a decisão fica alinhada entre timeline, Assembly, Web e documentação.

### Negativas / trade-offs

- overlaps incertos podem produzir fala duplicada para revisão;
- casos editoriais especiais ainda precisam de controles avançados;
- policy e provenance passam a fazer parte da identidade da Assembly.

## Compatibilidade

ADR-0019 continua vigente para o modelo Session/Recording Part/Run/Session Assembly, composição pós-ASR, gaps, participant mapping, imutabilidade e publicação explícita. Este ADR substitui somente a formulação em que boundary explícito era a primeira resolução de overlap.

Workspaces/assemblies históricos continuam imutáveis. `tda_session_timeline_v1` permanece leitura de compatibilidade; a authority corrente é `tda_session_timeline_v2`.

## Validação

- trusted overlap deriva `preserve_both_exact_v1` sem CTA humano;
- duplicata exata comprovada mantém provenance dual;
- fala diferente/incerta permanece;
- fuzzy similarity não remove conteúdo;
- boundary manual continua disponível como fallback;
- #1532 continua provando o happy path sem **Montar transcrição da sessão** ou decisão técnica intermediária.

## Referências

- ADR-0019;
- `docs/features/multi-recording-sessions.md`;
- `local-companion/tda_companion/session_timeline.py`;
- `local-companion/tda_companion/session_assemblies.py`;
- #1508, #1513, #1537;
- PR #1527, PR #1532.
