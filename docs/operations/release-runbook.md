# Release, deploy e rollback

> Status: vigente
> Owner: operations / release
> Última revisão: 2026-10-09
> Fonte de verdade: CI/CD, environments e providers atuais

Este runbook é genérico. Checklists de uma feature específica pertencem ao documento da feature ou ao histórico da release, não aqui.

## 1. Antes da PR

Confirmar:

- escopo fechado;
- risco e rollback conhecidos;
- documentação do contrato atualizada;
- migration identificada quando existir;
- manifests de mídia identificados quando existirem;
- nenhum secret em código/docs;
- testes locais relevantes passam.

Deploy não é ferramenta de desenvolvimento.

## 2. Pull request

Fluxo:

```text
branch temporária -> PR main
```

Exigir o SHA exato da PR nos checks.

A CI decide quais domínios pesados participam, mas `required-ci` continua sendo o contrato estável para merge.

## 3. Preview

Preview é deployment Vercel, não branch. O TDA tem **dois níveis**:
1. `deploy-preview.yml` cria Preview imutável da PR após CI verde, para revisão antes do merge;
2. `deploy-main-preview.yml` cria outro Preview imutável do **SHA exato da main** após CI push verde, sem publicar no domínio de Production. O deployment bem-sucedido fica em [GitHub → Deployments → preview](https://github.com/Faysk/tda/deployments/preview).

A Vercel mantém configurações Preview próprias. **Nunca copiar credenciais de Production nem usar Preview para gravar dados de Production.** O preview é um espelho de código/rotas públicas, não um clone de banco, credenciais ou mídia privada.

Validar:

- health/version;
- rota/superfície alterada;
- desktop/mobile quando visual;
- auth/permissões quando relevantes;
- nenhuma dependência acidental de Production;
- canonical/share URL não aponta para `*.vercel.app`.

Preview aprovado não significa Production publicada. O Preview de PR não substitui o Preview obrigatório da `main`; o commit pós-merge tem identidade distinta. Só o deployment da `main` pode autorizar o Production CD. Se a `main` avançar, novo SHA exige nova CI + novo Preview.

## 4. Merge

Com `required-ci` verde, mergear em `main`.

`main` é código candidato a Production, mas mutações remotas ainda precisam concluir. Após o merge: CI da `main` → Deploy Main Preview → smoke → revisão humana → Production CD manual.

## 5. Production CD

Production exige execução deliberada de `production-cd.yml` por
`workflow_dispatch`, informando o SHA exato de `main` já validado e preenchendo
`confirm=APPROVE_PREVIEW_FOR_PRODUCTION` após inspeção do URL imutável.
**É obrigatório** existir um `Deploy Main Preview` bem-sucedido para esse SHA,
com deployment GitHub `preview` em estado success e health/version concordando.
Push, merge e conclusão da CI não disparam publicação. O workflow continua recusando SHA
arbitrário/antigo, exige origem numa PR mergeada e usa o Environment `production`.
No GitHub, em **Settings → Environments → production**, configurar **Required reviewers**
(o responsável humano pelo aceite) e restringir deploys à `main`. Essa configuração
é feita no GitHub, não é aplicada pelo arquivo YAML. O texto de confirmação
no dispatch não substitui a regra de Required reviewers.
Só disparar após fechar o escopo e validar build, testes e visual. O pipeline
preserva staged deploy, smoke, promote do mesmo artefato e verificação canônica.
Em rollback, usar o artefato anterior aceito conforme o receipt; não reativar o
gatilho automático para recuperar uma entrega.

Acompanhar o lifecycle completo:

1. prova de HEAD + PR mergeada e CI verde;
2. confirmação humana + Preview exato da main aprovado e healthy;
3. baseline realmente publicado;
3. migration pendente;
4. Media Storage pendente;
5. build;
6. staged deploy sem tráfego;
7. smoke;
8. promote do mesmo artifact;
9. canonical verification;
10. receipt.

Falha antes do promote não deve mover o domínio oficial.


### Version skew de Server Actions e abas antigas — #1339

Deploys web podem ocorrer enquanto uma aba do Edit continua aberta. Uma Server Action
referenciada pelo JavaScript antigo pode deixar de existir no deployment novo. Esse caso
é diferente de timeout ou resposta perdida depois de um commit.

Contrato do TDA:

1. somente erros reconhecíveis de lookup da Server Action
   (`UnrecognizedActionError`, `Server Action was not found`,
   `Failed to find Server Action` ou a indicação explícita de deployment antigo/novo)
   entram no caminho de **stale deployment**;
2. nesse caminho a ação antiga é tratada como **não executada**: a UI preserva somente
   os campos editáveis/working copy, nunca restaura hidden IDs, revisions ou CAS tokens
   antigos, e oferece atualização explícita da página;
3. a recuperação usa `sessionStorage` da própria aba, expira em até 24 horas e nunca
   publica/grava automaticamente depois do reload;
4. a página nova fornece novamente os IDs/revisions autoritativos. O operador revisa o
   rascunho recuperado e decide se salva;
5. timeout, falha de rede ou resposta ambígua **não** são classificados como stale
   deployment. Esses casos continuam usando receipt/idempotency/CAS quando o domínio
   possui esse contrato, ou ficam sem replay automático até read-back humano;
6. o fallback global pode orientar hard reload, mas somente superfícies que registram
   working copy antes do reload prometem recuperação de campos.

Vercel possui Skew Protection para prender clientes ao deployment que os originou, mas
essa feature/configuração de provider não é requisito de correção do TDA e não foi
ativada nem alterada por #1339. A aplicação mantém recuperação própria sem adicionar
serviço pago. Se Skew Protection estiver disponível e habilitada no projeto, ela reduz a
incidência; não substitui CAS, receipts nem compatibilidade de serviços externos.

Rollback: se uma release introduzir falhas amplas de Server Actions, usar o rollback
normal para o deployment saudável anterior e confirmar `/api/version`. Abas que já
receberam o aviso de versão antiga devem fazer hard reload; nunca reutilizar IDs de
Server Actions antigos nem manter endpoints mortos só para aceitar mutações de uma aba
obsoleta.

### Identidade imutável de Runtime RC

A descoberta automática de Runtime RC é fail-closed por versão semântica exata:

1. para a família e versão esperadas, **zero** prereleases publicadas compatíveis significa candidato ainda não publicado;
2. **exatamente uma** prerelease publicada compatível pode seguir para validação de tag, source, manifesto, assets e SHA-256;
3. **mais de uma** prerelease publicada para a mesma família e versão é ambígua e deve abortar; publicação/ID mais recente nunca desempata identidade;
4. drafts, releases que não são prerelease e versões diferentes são ignoradas;
5. tag/candidate tag, family, version, source SHA, conjunto de assets, tamanhos e digests continuam exatos e fail-closed;
6. qualquer mudança de source ou bytes do runtime exige **nova versão semântica**. Não reutilizar uma versão já publicada para um RC materialmente diferente.

Isso preserva a identidade imutável do runtime entre descoberta, aceite físico, promoção e rollback. Se houver colisão de versão, corrigir a publicação/versionamento; não introduzir regra de “latest wins”.

### Exceção versionada de validação em Production — #628

Para a recuperação do Qwen em #628, o proprietário autorizou explicitamente usar
Production como ambiente do teste físico final porque o caminho Qwen Stable vigente
já falha no Craig longo observado. A exceção é limitada a **Companion 0.3.16** e
**Qwen Runtime 1.0.12**.

O fluxo continua fail-closed:

1. CI/package do source SHA exato;
2. RC imutável e verificação dos assets;
3. promoção do **mesmo objeto/mesmos bytes**, sem rebuild;
4. receipt machine-readable registrando que o aceite físico pré-promoção foi
   deliberadamente substituído por validação em Production;
5. rollback preservado em Companion 0.3.15 / Qwen 1.0.11;
6. #628 permanece aberta até o Craig longo na RTX 4070 concluir com os bytes exatos.

Os bridges são one-shot/version-locked e ignoram versões futuras. Se `main` avançar,
a promoção só continua quando não houver drift nos inputs que alteram os bytes ou o
contrato do componente. Esta exceção não muda a política normal RC → aceite físico →
Stable das demais releases.

### Rollback operacional explícito do Whisper Runtime — #1279

Rollback local de Whisper é uma operação de recuperação **explícita**, separada da descoberta normal de Stable. O fluxo normal de update continua monotônico e nunca instala uma Stable abaixo da versão ativa.

Caminho suportado no produto: **TDA Companion → Configurações → Runtimes de transcrição → Whisper → Reverter…**. O operador informa a versão semântica exata `X.Y.Z` e confirma a ação.

Gate obrigatório:

1. não pode haver job queued/running, preparação de perfil nem manutenção de outro runtime;
2. a versão alvo precisa ser anterior e compatível com o Companion;
3. se `Runtime\whisper\<versão>` existir, marker, identidade, SHA-256 do worker e metadata seal são verificados **sem reescrever o artefato**;
4. se os bytes não estiverem preservados, somente a release Stable version-locked `companion-whisper-runtime-vX.Y.Z` pode ser baixada, com tag, URL, tamanho e SHA-256 exatos;
5. `current.json` é trocado atomicamente e a versão selecionada é verificada novamente; falha restaura o seletor anterior ou bloqueia com erro explícito;
6. `Models`, `Data`, runs e demais versões de Runtime permanecem intactos;
7. reinício do Agent/Companion deve reler o mesmo `current.json` e anunciar a versão revertida como `ready`.

Não “corrigir” rollback mudando o comparador do update Stable de `>` para `!=`: isso reintroduziria downgrade automático quando o canal Stable estivesse abaixo de um RC/candidato instalado.

### Whisper Runtime 1.1.7 / Benchmark — #1233

Para o reparo do contrato de benchmark do Whisper:

1. `1.1.5` é histórico imutável. Não sobrescrever tag, release ou archive, mesmo que exista build posterior com o mesmo número.
2. O candidato corrigido deve usar versão nova (`1.1.7` neste ciclo), source SHA e archive SHA exatos.
3. O workflow de build precisa passar o smoke do comando de benchmark empacotado; rejeição de protocolo/exit 64 é bloqueante.
4. Publicar RC não implica Stable. Executar aceite físico do **mesmo archive** no Windows/GPU suportado.
5. O aceite final deve executar a mesma amostra local de 5 minutos nos quatro perfis e preservar receipts/lineage com runtime worker hash, runtime version e GPU observada, sem publicar áudio/transcrição privada.
6. Só depois do receipt físico correspondente o workflow governado de promoção pode reutilizar os mesmos bytes como Stable.
7. Migration deve preservar modelos, caches, jobs/runs e dados locais. O runtime `1.1.5` pode continuar servindo transcrição normal enquanto benchmark permanece bloqueado.
8. Rollback volta deliberadamente ao último artefato aceito; benchmark fica fail-closed se o runtime anterior não satisfizer o contrato. Uma correção posterior recebe nova versão, nunca rebuild do `1.1.5`.

### Whisper Runtime 1.1.8 / contenção palavra-segmento — #1235

A correção de contenção altera o adapter/worker empacotado e portanto exige uma identidade de runtime nova. O Runtime 1.1.6 de #1234 e o Runtime 1.1.7 de #1233 já foram materializados oficialmente e permanecem imutáveis; o candidato que contém #1235 é **Whisper Runtime 1.1.8**.

1. Não rebuildar, retaggear nem sobrescrever 1.1.6 ou 1.1.7 com os bytes da #1235.
2. O archive 1.1.8 precisa incorporar a fronteira de decode compatível de #1234 e os smokes sintéticos vigentes.
3. Antes de promoção, executar `local-companion/packaging/run-whisper-craig-containment-acceptance.ps1` contra o Craig staged autorizado e o `TDARuntime-candidate.json` do **mesmo RC 1.1.8**.
4. O gate físico executa `whisper-turbo` e `whisper-detailed`, cada um com sample Craig de exatamente 300 s e transcrição integral.
5. O full precisa produzir `run.json` e `transcript.json`; o SHA do transcript deve corresponder ao manifesto e ambos os arquivos são re-hashados ao final para provar imutabilidade.
6. O receipt compartilhável usa o nome `<candidate-tag>.whisper-1235.json` e registra somente identidade/hashes do runtime, GPU/driver e métricas agregadas. Não registrar áudio, transcript, speaker, source id ou caminhos locais.
7. Depois da revisão do receipt sanitizado, copiar esse arquivo para `docs/companion/runtime-acceptance/<candidate-tag>.whisper-1235.json`. O workflow `Runtime Promote Stable` recusa o Whisper 1.1.8 se esse sidecar não corresponder ao mesmo candidate tag, source SHA/tree, workflow run e archive SHA-256; o sidecar é anexado à própria release antes da troca de canal.
8. Qualquer falha de contenção, duração, ordering, dedup, turns ou integridade aborta a promoção. O contrato `tda_transcript_v1` continua estrito; não clipar/remover palavras nem reescrever run concluído para fazê-lo passar.
9. Rollback seleciona um runtime Whisper anterior já publicado e compatível, preservando Models/Data/runs. Correção posterior recebe nova versão imutável.


### Whisper Runtime 1.1.9 / cold-start do decode smoke — #1277

O Runtime 1.1.8 de #1234/#1235 permanece imutável. O endurecimento do orçamento de cold-start do decoder começa somente na nova identidade **Whisper Runtime 1.1.9**.

1. O smoke empacotado continua obrigatório e executa WAV e FLAC reais por `faster_whisper.audio.decode_audio`; não substituir por probe sintético.
2. Faster-Whisper 1.2.1, CTranslate2 4.8.2 e PyAV 18.1.0 permanecem fixados neste corte; schema, sample rate e sample count continuam fail-closed.
3. Apenas o subprocesso congelado de `--decode-smoke` recebe orçamento explícito e limitado de **90 s** para absorver variância de loader/AV/scheduler no Windows. O `--probe` continua com seu orçamento anterior.
4. Exceder 90 s continua falhando de forma estável com `WHISPER_RUNTIME_DECODE_SMOKE_TIMEOUT`; o aumento não transforma hang em sucesso.
5. A mudança exige nova versão semântica e novo source/archive SHA. Não retaggear, sobrescrever ou republicar qualquer asset 1.1.8.
6. Publicação de RC continua distinta de promoção Stable; aceite físico e receipts seguem os gates governados aplicáveis ao runtime candidato.


## 6. Secrets e providers

Antes de operação remota, confirmar o boundary correto:

### Runtime/deploy atual — Vercel

- team/project canônicos;
- `VERCEL_TOKEN` no GitHub Environment apropriado;
- runtime envs presentes quando necessários.

### Banco atual — PostgreSQL/Supabase

Quando migration pendente:

- `SUPABASE_ACCESS_TOKEN`;
- `SUPABASE_DB_PASSWORD`;
- project ref correto;
- migration history compatível.

### Media Storage atual — R2

Quando publicação pendente:

- `R2_ACCOUNT_ID`;
- `R2_ACCESS_KEY_ID`;
- `R2_SECRET_ACCESS_KEY`;
- bucket/origin esperados.

Secrets operacionais do GitHub Actions pertencem ao GitHub Environment. Não usar Vercel como cofre indireto de R2.

## 7. Mídia

Toda mídia persistida/publicada pertence ao Media Storage.

Antes de marcar mídia como publicada:

- manifest/identidade corretos;
- SHA-256/MIME/bytes verificados;
- objeto publicado ou reutilizado sem overwrite silencioso;
- read-back;
- GET público quando audience pública;
- consumer real testado;
- receipt com quantidade real de assets.

`step success` com zero assets não prova publicação.

Manifest em `main` também não prova publicação.

## 8. Banco

Migration:

- versionada no Git;
- validada;
- aplicada pelo lifecycle autorizado;
- verificada remotamente;
- compatível com rollback do app quando necessário.

Não usar `supabase db push` manual para destravar Production.

## 9. Smoke de Production

O smoke público funcional roda primeiro no deployment staged e é repetido no
domínio canônico depois do promote.

Validar:

- `/api/health` e `/api/version` para liveness/identidade;
- source SHA e release esperados;
- `/`, `/campanhas`, `/sessoes` e `/campanhas/sessoes` por conteúdo semântico, não só status HTTP;
- redirect de `/sessoes` seguido até o destino final exato `/campanhas/sessoes`;
- nenhum estado conhecido de indisponibilidade disfarçado de HTTP 200;
- estado vazio somente quando a página declara o vazio público esperado; erro de dependência não conta como vazio;
- registry de campanhas em modo `canonical` ou no fallback conhecido `legacy` antes do promote. Estado ausente/desconhecido/unavailable é bloqueante; `legacy` preserva a compatibilidade estreita de #1225, mas não conta como readiness nem autoriza consumidores que exijam o schema first-class;
- quando houver sessão pública, descobrir um link no arquivo e validar a página pública final pelos marcadores do reader, sem registrar texto de resumo/transcrição;
- auth quando alterada;
- imagens/media URLs consumidas pela superfície;
- canonical e metadata quando aplicáveis.

O smoke só registra metadados sanitizados de evidência: SHA, fase, rota, resultado,
horário UTC e, quando necessário, um código/estado sem corpo da resposta.

Navegação normal deve permanecer em `dnd.faysk.dev`; aliases de provider são diagnóstico.

## 10. Receipt

Registrar:

- PR;
- source SHA;
- baseline anterior;
- release id;
- deployment;
- migrations: executadas/skipped;
- Media Storage: assets/reused/published/verified ou skipped;
- smoke;
- canonical verification;
- rollback conhecido.

Histórico detalhado: [deployments](deployments.md).

## 11. Rollback

### Continuação após áudio sem reconhecimento — #1570

O teste físico de 0.3.23 passou nos quatro perfis e a instalação passou após
a correção de `Content-Length` em Production. No benchmark Craig real, os quatro
perfis concluíram, mas o aceite de evidência detectou uma falha independente:
o escopo da credencial temporária recusava `export.zip` por escape duplicado
na expressão regular. Companion 0.3.24 corrige somente esse endereço literal,
com regressão para variantes inválidas e métodos não autorizados. O pacote também
fixa FastAPI 0.142.4 no pyproject e no lock exato: a auditoria encontrou a versão
estável nova durante a validação, sem alterar as dependências de inferência.
Não promover
0.3.23 como entrega final: validar o novo MSI e a exportação preservada antes
de promover 0.3.24. Os recibos anteriores continuam evidência dos bytes anteriores;
não substituir nem reatribuir esses recibos ao novo pacote. Nenhum dado é resetado.

Companion 0.3.23, Qwen 1.0.20 e Whisper 1.1.12 são novos candidatos imutáveis:
o contrato compartilhado de evento/checkpoint muda o closure empacotado. Não
substituir assets de 0.3.22/1.0.19/1.1.11 nem promover sem gates físicos dos bytes
novos. Validar trecho ignorado seguido de fala preservada, aviso após retomada,
erros de inferência propagados e benchmark real dos quatro perfis. Distinguir
conclusão com avisos de qualidade medida. Rollback restaura a política anterior
que podia falhar a gravação inteira; não reinterpretar checkpoints novos com a
assinatura antiga.

Os recibos oficiais em `docs/companion/runtime-acceptance/` aceitam os candidatos
Whisper 1.1.12 e Qwen 1.0.20 de source `9306c710f41f` nos quatro perfis CUDA,
em RTX 4070 Laptop. A verificação oficial de promoção conferiu manifestos,
archives e hashes dos workers contra esses recibos. Isso autoriza a promoção
governada dos mesmos bytes de runtime; não comprova RTX 2080 nem qualidade
linguística medida. Também não substitui o aceite próprio do MSI 0.3.24.
Recibo aceito e canal Stable publicado permanecem estados distintos.

O MSI 0.3.24 de source `9dd86f0a7873` passou pelo aceite instalado oficial
e pelo teste físico dos quatro perfis em RTX 4070 Laptop. Os recibos sanitizados
em `docs/companion/acceptance/` vinculam MSI, payload e runtimes aos hashes
verificados; incluem recuperação, conflito de porta, retomada BITS e preservação
do Craig após perda do Agent. A verificação oficial de promoção dos assets passou.
O benchmark Craig e a exportação continuam sendo conferências independentes;
não substituir o recibo anterior que registrou a rejeição do ZIP no 0.3.23.

O benchmark real do 0.3.24 concluiu os quatro perfis, mas revelou outro caso:
o contrato canônico permite segmentos pontuais (`start == end`), enquanto o
exportador SRT/VTT recusava o ZIP inteiro. Companion 0.3.25 mantém JSON, hashes,
texto e timestamps originais; somente cues derivados com duração arredondada
zero recebem 1 ms de exibição. Cada perfil exporta `subtitle-timing.json` com
política `positive_millisecond_cues_v1` e quantidade de ajustes. Esse intervalo
é formatação de legenda, não duração de fala medida. Negativos, inversões e
valores não finitos continuam inválidos. Validar o ZIP real preservado e o novo
MSI antes de tratar o 0.3.25 como aceito; nenhum runtime de inferência muda.

Em 2026-10-08, o MSI imutável `companion-rc-v0.3.25-7b1b8d5a130f`
passou pelo aceite instalado v3 e físico v2 na RTX 4070 Laptop / SM 8.9.
Os recibos próprios estão em `docs/companion/acceptance/` e a verificação
oficial de promoção confere os mesmos bytes do candidato. O benchmark real
preservado foi executado no 0.3.24; sua exportação foi aceita pela API instalada
do 0.3.25, com os quatro hashes canônicos, diagnósticos e contagens conferidos.
Os SRT/VTT mantêm todas as 125/126/72/76 falas e ajustam somente 0/0/2/3 cues
pontuais. Os recibos `benchmark-0324-exporter-0325.json` e
`benchmark-0324-subtitles-0325.json` distinguem essas duas versões; a execução
anterior que falhou permanece como histórico. A promoção Stable continua uma
ação separada, autorizada somente depois de integrar e revisar estes recibos;
o workflow deve terminar também o postflight do download same-origin.

A promoção imutável de 0.3.25 concluiu em 2026-10-08 pelo workflow
`37707144843`, incluindo read-back dos assets e downloads padrão/tag fixada.
A Web `03e11233cf5f1cb1f081ea7dd8204e6b66143745` foi publicada deliberadamente
pelo CD `37707986144` após CI exata verde. O postflight autenticado identificou
que ZIP de benchmark usa `StreamingResponse` sem `Content-Length`; tratar esse
caso na Web com prefixo limitado e preservar o stream quando ultrapassa o limite.
Não reconstruir um MSI já aceito apenas para acrescentar esse header. O aceite
do clique e do arquivo baixado permanece separado dos gates de release do MSI.

### Download do Companion pelo domínio do TDA (#1567)

O postflight de promoção verifica HTTP 200 direto, `Content-Length`, disposition
de download e SHA-256 completo do MSI tanto na rota padrão quanto na tag fixada.
Não exigir o antigo redirecionamento 307: isso contradiz a entrega pelo domínio
do TDA. Se a promoção já trocou o canal e apenas o postflight falhou, preservar
esse workflow como evidência e executar `Companion Stable Postflight` em `main`
para a Stable existente. Esse fluxo tem somente permissão de leitura, não
reconstrói assets nem repete a troca de canal.

Os testes de smoke importam o verificador compartilhado de
`tools/ci/companion_download_verify.py`, sem extrair Python inline do YAML.
O manifest também exige resposta 200 direta, URL canônica e shape de objeto;
redirects, outro origin/path e MSI truncado ou com hash divergente falham fechados.
Preservar esses testes ao alterar a distribuição, em vez de relaxar o contrato
para acomodar um workflow antigo.

O endpoint `/api/downloads/companion/windows` entrega o MSI por streaming Node.js,
com `Content-Disposition: attachment`, sem redirecionar o navegador para o CDN do
GitHub. O GitHub continua sendo a origem canônica do artefato imutável; somente o
servidor segue o download da release validada. Não há cópia persistida nem URL
arbitrária aceita do cliente. A transferência aplica backpressure e confere tamanho
e SHA-256 incrementalmente; bytes truncados ou divergentes interrompem o stream.
Cancelamento do cliente cancela a leitura da origem. O download completo deve ser
validado no deployment staged e no domínio canônico: status 200, ausência de
`Location`, filename MSI e hash idêntico ao manifest oficial. Não fechar a issue
somente com um download por CLI quando o clique do usuário ainda falha.

Rollback da aplicação restaura o redirect anterior e pode restaurar o bloqueio
`ERR_BLOCKED_BY_CLIENT`; registrar essa limitação ao decidir rollback. Streaming
evita o limite de resposta buffered do hosting, mas a transferência permanece
sujeita à duração da função (300 segundos) e à disponibilidade da origem.

### Aplicação

Se o smoke staged falhar antes do promote, abortar: o alias/domínio oficial continua
no deployment anterior. Não promover manualmente para contornar o gate.

Se o promote concluir e uma verificação canônica posterior falhar, o workflow
registra `Production recovery required` no step summary com source SHA, deployment
promovido e horário UTC. Nesse caso:

1. identificar o deployment anterior comprovadamente saudável;
2. promover/rollback da aplicação para esse deployment;
3. confirmar `/api/health`, `/api/version`, SHA/release e o smoke semântico público canônico;
4. abrir correção em branch/PR e publicar novamente pelo lifecycle normal.

### Banco

Não existe rollback automático destrutivo. Avaliar compatibilidade e migration corretiva/reversão explicitamente desenhada.

### Media Storage

Restaurar referência anterior quando necessário. Objetos imutáveis podem permanecer para cache/auditoria/rollback. Não apagar objeto como primeira resposta.

## 12. Abortar quando

- CI do SHA exato está vermelha;
- provider/contexto é incerto;
- secret/config necessária não está confirmada;
- migration drift não está explicado;
- mídia pública não passou integridade/read-back/entrega;
- conteúdo privado aparece em payload público;
- staged smoke diverge da identidade esperada;
- documentação vigente contradiz o comportamento que está sendo promovido.

## Drift atual de Media Storage

Em 2026-09-20 a publicação automática de mídia ainda precisa convergir para ADR-0018: secrets R2 devem vir do GitHub Environment e publicação pendente deve ser acumulativa desde o baseline.

Enquanto esse drift existir, não usar bypass manual para concluir release com mídia nova.

### Dispatch Qwen com Runtime RC ativo — #1576

A verificação de workflow ativo precede a restauração excepcional de #1413. Um pacote posterior (por exemplo 1.0.19) segue para dispatch quando Runtime RC já está ativo, sem exigir a antiga versão 1.0.18. Se o workflow estiver desabilitado, a restauração continua restrita a 1.0.18, sem Stable existente e com estados permitidos; outras versões não reativam automação. Identidade/source/digests e aceite físico continuam obrigatórios. Rollback: reverter apenas a ordenação; nenhum asset ou versão existente é substituído.
### Handoff acima do limite de body do provider — #1578

Functions impõe 4,5 MB ao request HTTP (https://vercel.com/docs/functions/limitations), independente do limite de domínio. Revisões grandes usam transporte gzip limitado a 4 MiB no fio / 34 MiB após descompressão; pequenas permanecem JSON. Validar round-trip exato, rejeição de bombas/corrupção, auth antes de inflar e replay antes do CD. O aceite exige receipt e read-back privado no Edit, não apenas compressão local. Não aumentar tier/bundle/memória como solução para limite de body.
