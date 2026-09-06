# Arquitetura
Aplicação Next única em `src/app`. Domínios em `src/features`; conexões em `src/integrations`; composição em `src/components`. Sem segundo frontend, proxy obrigatório para o legado ou banco novo.

## Supabase
Projeto existente `dmrqnbdvbkfqzctcerbx`. O servidor consulta somente sessões publicadas da campanha `yuhara-main`, com seleção explícita de campos. O catálogo não busca transcrições, metadata integral ou dados de usuários. Para mídia pública, seleciona somente `coverImageUrl` e `heroImageUrl` por caminhos JSON e o model aceita apenas origens HTTPS explicitamente permitidas. Detalhe retorna resumo completo como texto escapado; a apresentação usa renderer Markdown próprio sem HTML bruto.

O modelo de domínio vigente está em [data-model.md](data-model.md) e o estado observado do banco em [database-audit.md](database-audit.md). `tda` é a identidade canônica do projeto; `yuhara-main` continua sendo a identidade da campanha. Proveniência (`craig`, `local_companion`, Discord/Roll20) não é renomeada. Enquanto o legado ainda opera, o scope técnico `dnd-scribe` permanece como compatibilidade ao lado de `tda`.

RLS continua deny-by-default na maior parte do schema. O servidor atual usa chave secreta exclusivamente server-side para a leitura pública estreita; ela tem poderes elevados e não é tecnicamente read-only. Novas superfícies autenticadas devem validar a identidade do usuário e resolver capabilities do RBAC. Não abrir policies genéricas apenas para simplificar o frontend.

## Identidade narrativa
`profiles` representa pessoas/contas. `entities` representa objetos canônicos do mundo (`pc`, `npc`, `location`, `item`, `organization`, `faction`, `arc`, `concept`, `song`, `quest`). `profile_characters` associa um profile a uma entidade `pc`; `participants` representa a ocorrência desse personagem numa sessão. Assim PC e NPC podem compartilhar mentions, canon e relações futuras sem duas identidades narrativas concorrentes.

Transcrição e eventos são evidência, não verdade canônica. O fluxo esperado é fonte → classificação/candidato → revisão → `canon_entries`/publicação. Nada derivado por IA deve virar canon sem fonte e decisão de revisão.

## Relações e conhecimento
O roadmap prevê grafo de entidades/relações e possível React Flow. Relações serão edges first-class entre entities, com audiência/visibilidade e evidência; o schema definitivo ainda não está aprovado. Também permanece futura a modelagem de conhecimento por audiência (jogador, personagem, público, rumor, mentira, segredo do mestre). Não esconder esses conceitos em JSON ad hoc antes do desenho da feature.

## Mídias
R2 armazena conteúdo binário; banco mantém relações e metadados. Buckets separados por visibilidade e teste. Nenhum upload público ou URL assinada é oferecido antes de implementar autorização do Edit. Durante a migração visual da etapa 2, capas e heróis já publicados podem continuar sendo lidos das origens legadas aprovadas registradas na sessão; isso não substitui a migração para o R2 e não libera os buckets novos. Áudio bruto não integra retenção cloud. SVGs oficiais pequenos ficam versionados com o app.

## Compatibilidade de URLs
O site legado usa fragmentos `#/sessao/{sourceSessionId}` e `#/sessao/{sourceSessionId}/resumo`. Fragmentos não chegam ao servidor HTTP, portanto o layout instala uma ponte client-side mínima que reconhece somente esses formatos e substitui a navegação por `/sessoes/{sourceSessionId}`. Hashes desconhecidos são ignorados. Isso permite preservar links antigos quando o domínio migrar para o reboot sem reintroduzir o frontend legado.

## Transcrição
O companion local será modernizado preservando o fluxo atual. O reboot não deve reativar ingestão pesada em cloud nem retenção de áudio bruto. Conteúdo sincronizado deve funcionar com o PC desligado; novas transcrições continuam dependendo do companion local.
