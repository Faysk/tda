# Arquitetura do Edit Workbench

> Status: accepted / implementação incremental
> Owner: arquitetura + Edit
> Última revisão: 2026-09-07

## Propósito

Definir o boundary técnico da área administrativa do TDA sem transformar o Edit em um segundo frontend, um CRUD do Supabase ou uma cópia estrutural do `dnd-scribe`.

O Edit compartilha o mesmo runtime Next.js, Design System, banco canônico e domínios do restante do TDA.

## Camadas

```text
Route / page composition
        ↓
UI feature components
        ↓
Application actions / queries
        ↓
Domain rules
        ↓
Integration / persistence boundary
        ↓
Supabase / R2 / serviços autorizados
```

### `src/app`

Responsabilidades:

- rotas e layouts;
- composição de página;
- metadata/redirect/not-found;
- loading/error boundaries;
- montagem server-first.

Não deve concentrar regra de negócio de edição.

### `src/features`

Responsabilidades:

- casos de uso;
- regras de domínio;
- validação específica da feature;
- DTOs e projections;
- componentes específicos do Edit;
- testes próximos da regra.

Direção para a expansão:

```text
src/features/edit/
  access/
  shell/
  transcript/
  sessions/
  review/
```

Essa árvore deve crescer por necessidade real, não por simetria artificial.

### `src/components`

Somente composição/primitives reutilizáveis e agnósticos de domínio. Um componente que conhece `transcript_segments`, `session_id` ou `review_status` pertence à feature, não ao kit global.

### `src/integrations`

Fronteiras externas e detalhes de persistência devem ficar separados do comportamento editorial quando possível. O domínio não deve depender de detalhes do SDK Supabase para calcular estado de revisão, métricas ou autorização conceitual.

## Server-first

O Edit é interativo, mas não deve ser convertido inteiro em Client Component.

Padrão preferido:

```text
Server Component
  -> resolve auth/contexto
  -> consulta DTO mínimo autorizado
  -> renderiza shell/contexto
  -> monta pequenas ilhas client-side para edição
```

Mutations podem usar Server Actions ou endpoints server-side quando isso simplificar autorização, testes e integração. A escolha concreta deve preservar um boundary único de mutation por caso de uso.

## Autorização

Toda operação administrativa segue:

```text
auth user
  -> profile
  -> capability
  -> scope
  -> ownership/campaign do recurso
  -> visibility quando aplicável
  -> mutation/query autorizada
```

A UI pode receber uma projection de capabilities para decidir apresentação, mas nunca é a última linha de defesa.

### Regras negativas obrigatórias

- recurso de outra campaign não pode ser acessado por manipulação de ID;
- capability no scope errado não autoriza a operação;
- membership simples não deve ser interpretado automaticamente como acesso administrativo;
- acesso de leitura a transcript não concede write;
- gestão de acesso é separada de edição de conteúdo.

## Transcript mutation boundary

Editar segmento é um caso de uso de domínio.

Entrada mínima conceitual:

```ts
{
  segmentId,
  campaignIdOrSlug,
  expectedRevision,
  text,
  speaker,
  reviewStatus
}
```

O formato físico poderá variar, mas o boundary deve validar:

1. identidade e capability;
2. campaign/scope do segmento;
3. existência do segmento;
4. conteúdo permitido;
5. estado de revisão permitido;
6. concorrência/version quando adotada;
7. cálculo derivado (`text_chars`, `text_words` ou sucessor equivalente);
8. `needs_review` coerente;
9. auditoria old/new para campos editoriais críticos.

O cliente não deve calcular a versão definitiva desses invariantes e enviá-los como fatos confiáveis.

## Concorrência e autosave

### Problema

Requests paralelos podem concluir fora de ordem. Logo, debounce sozinho não protege integridade.

### Estratégia preferida

Quando o schema permitir, usar optimistic concurrency com revision/version:

```text
cliente lê revision 14
cliente envia expectedRevision 14
servidor atualiza somente se revision = 14
servidor grava revision 15
```

Se outra mutation já avançou o recurso, retornar conflito explícito e não sobrescrever silenciosamente.

Enquanto revision física ainda não existir, o cliente pode serializar mutations por recurso, mas isso é mitigação local e não substitui proteção server-side contra dois clientes diferentes.

## Save state

Modelo de UI mínimo:

```text
clean
  -> dirty
  -> saving
  -> saved
  -> dirty ...

saving -> error
saving -> conflict
```

`error` deve oferecer retry sem apagar o valor local. `conflict` deve impedir confirmação enganosa de sucesso.

## Auditoria

Mudanças administrativas relevantes devem produzir informação suficiente para responder:

- quem alterou;
- quando;
- qual recurso;
- qual campo/estado relevante;
- antes/depois quando apropriado;
- campanha/scope;
- origem da ação.

O `audit_log` existente não possui cobertura comprovada e não deve ser assumido como completo. A implementação do Edit deverá definir e testar sua política antes de depender dele para histórico/reversão.

## Dados de transcrição

`transcript_segments` é evidência derivada e pode conter material privado/sensível. Portanto:

- selecionar apenas campos necessários à tarefa;
- não reutilizar payload público;
- não promover texto corrigido automaticamente a canon;
- preservar lineage de source file/chunk/offsets;
- processamento posterior não pode apagar revisão humana silenciosamente.

## Paginação e volume

O schema observado possui mais de 30 mil segmentos. Regras:

- paginação por sessão;
- cursor estável preferível em navegação extensa;
- busca/filtro deve operar server-side quando o volume justificar;
- evitar `select *`;
- inspector secundário deve lazy-load quando custoso;
- virtualização depende de medição, não de antecipação.

## Navegação e estado

O Edit deve preservar estado de trabalho útil quando o usuário alterna entre inspector/segmentos/abas sempre que isso não introduzir estado global frágil.

Preferir URL para estado compartilhável/importante:

- session;
- recurso selecionado;
- filtro principal quando fizer sentido;
- aba/visão significativa.

Estado efêmero de editor pode permanecer local.

## Erros

Erros são classificados conceitualmente:

- `validation`;
- `unauthorized`;
- `forbidden`;
- `not_found`;
- `conflict`;
- `dependency_unavailable`;
- `unexpected`.

A UI deve conseguir apresentar ações diferentes para erro de validação, conflito e falha transitória.

## Testes

Cobertura mínima para mutation crítica:

- happy path;
- input inválido;
- usuário não autenticado;
- profile não resolvido;
- sem capability;
- capability no scope errado;
- resource cross-campaign;
- estado de revisão inválido;
- conflito de versão;
- erro de persistence sem perda do valor local;
- auditoria quando exigida.

## Relação com o legado

O legado comprova comportamento útil, mas não dita implementação.

Exemplos:

- endpoint CommonJS -> caso de uso server-side moderno;
- SQL inline -> repository/integration boundary;
- role hardcoded -> capability + scope;
- mutation simples -> concorrência explícita;
- atualização sem histórico confiável -> audit policy.

A decisão formal está em [ADR-0007](../adr/0007-edit-workbench.md).