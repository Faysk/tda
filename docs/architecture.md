# Arquitetura
Aplicação Next única em src/app. Domínios em src/features; conexões em src/integrations; composição em src/components. Sem segundo frontend, proxy obrigatório para o legado ou banco novo.

## Supabase
Projeto existente dmrqnbdvbkfqzctcerbx. O servidor consulta somente sessões publicadas da campanha yuhara-main, com seleção explícita de campos. O catálogo não busca transcrições, metadata integral ou dados de usuários. Detalhe retorna resumo completo como texto escapado; renderização Markdown rica fica para a entrega visual.

As tabelas possuem RLS sem políticas de leitura anônima. Nesta fundação usa-se chave secreta exclusivamente server-side; ela tem poderes elevados, embora os métodos implementados sejam só leitura. Não é uma credencial tecnicamente read-only. Restringir por role/view dedicada exige uma mudança de banco revisada futura; nenhuma migration foi aplicada agora. Preview fica sem essa chave e usa estado sem dados, até definir conjunto autorizado/isolado.

## Mídias
R2 armazena conteúdo binário; banco mantém relações e metadados. Buckets separados por visibilidade e teste. Nenhum upload público ou URL assinada é oferecido antes de implementar autorização do Edit. Áudio bruto não integra retenção cloud. SVGs oficiais pequenos ficam versionados com o app.

## Transcrição
O companion local será modernizado preservando o fluxo atual. Esta fundação ainda não implementa upload de transcrição, jobs ou novo Edit. Conteúdo sincronizado deve funcionar com PC desligado.
