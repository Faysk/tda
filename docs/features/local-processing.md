# Processamento local no Edit

> Status: preparado / implementação candidata
> Owner: Processamento UI/adapters (Painelzinho); API/export local: Motorzinho; importação cloud: Carteiro
> Última revisão: 2026-09-07
> Fonte de verdade: `src/features/edit/processing`, `src/app/edit/processamento` e testes associados

Implementação candidata na branch `codex/local-processing-ui`. Este recorte entrega UI/adapters e ensaio sintético integrado. **Não é transcrição ASR completa, instalação Windows, sincronização cloud ou publicação.**

## Contratos e ownership

- [Fluxos de dados](../architecture/data-flows.md), [domínio de processamento](../domains/processing.md) e [companion](../integrations/local-companion.md) preservam site/Edit cloud e áudio/processamento pesado local.
- API negociada com Motorzinho: `/api/v1`, versão wire `"1"`, serviço inicial `0.1.0`. Contrato detalhado e implementação do serviço na [PR #57](https://github.com/Faysk/tda/pull/57); o documento dono é `docs/integrations/local-companion-v1.md` naquela entrega. Esta UI não altera backend/instalador.
- Rota `/edit/processamento`, dentro do mesmo Next/app e Design System. `requireCapability(EDIT_CAPABILITIES.localProcess)` exige action exata `campaign.local.process`, assignment ativo em `campaign/yuhara-main` ou `project/tda`, pelo resolver existente. Chaveiro confirmou a action no catálogo físico; nenhuma grant, migration ou consulta de produção foi executada por esta frente.
- `/conta` oferece entrada quando essa capability é válida, inclusive para operador sem leitura de transcrição; `/edit` também aponta para a rota, que sempre revalida autorização.
- Ler/editar transcrição, gerenciar uploads ou executar jobs técnicos não implica essa permissão. O usuário Windows não concede autorização cloud. O token do serviço é uma autorização local distinta.
- Parafuso confirmou que `/edit/sessoes/[sourceSessionId]` edita segmentos existentes: `edit_transcript_segment_atomic` não é consumidor de importação. O futuro handoff depende de recibo e identidade resolvida server-side.

## Comportamento entregue

O painel começa desconectado e não sonda portas automaticamente. Após ação explícita, consulta health público mínimo, exige versão compatível e só então envia o token manual para capabilities e jobs. Destino do produto é fixo `http://127.0.0.1:8765/api/v1`; sem URL arbitrária, proxy cloud ou descoberta de outros PCs.

Estados distintos: desconectado, conectando, versão incompatível, em preparação, pronto e fila pausada. Falhas de rede eliminam a projeção anterior para não exibir informação antiga como atual. Timeout, credencial revogada, origem recusada, resposta inválida e conflito recebem diagnóstico/ação específicos. `Failed to fetch` não distingue serviço ausente, CORS e permissão do navegador; a UI não inventa essa causa.

Enquanto conectada e visível, a aba consulta a cada três segundos, sem chamadas concorrentes. Ocultar suspende a consulta; voltar consulta novamente. Desconectar aborta requests e ignora respostas tardias, limpa token e dados da tela, mas não cancela jobs persistidos.

Fila mostra status e etapa do serviço; progresso usa somente contadores `completed/total/unit` válidos. `null` significa sem medida, sem porcentagem inventada. Falha recuperável/interrupção permite **Repetir trabalho**, com confirmação identificando o job e sem prometer checkpoint exato. Cancelar pede confirmação e aguarda estado retornado. **Retomar fila** confirma que jobs pendentes voltarão a executar; pausar só impede novos claims. O serviço decide transições e persistência.

O botão de ensaio aparece somente com capability local `synthetic.fixture` e só executa quando pronto. Envia exclusivamente identidades `synthetic-*` e três unidades, sem escolher áudio/modelo/GPU. Reenvio após resposta perdida conserva a mesma Idempotency-Key em memória da aba; após recarregar, consultar a fila antes de iniciar outro ensaio.

Resultados são validados por versão, job ID e identidade do pacote. A UI retém apenas projeção de IDs, não conteúdo do bundle. Mostra **Sincronização não configurada** sempre neste corte, mesmo que uma futura versão anuncie `sync:true`: isso não substitui autorização nem recibo validado.

## Segurança e suporte ao navegador

Token manual URL-safe fica somente na memória, sem cookie, storage, query string, log ou envio cloud. O campo é apagado ao conectar. Desconectar não revoga o token no serviço; revogação exige regeneração no aplicativo local conforme operação do Motorzinho. O operador não deve colar credenciais Supabase nesse campo.

Requests usam CORS, `credentials:omit`, `redirect:error`, `cache:no-store`, `referrerPolicy:no-referrer`; mutations exigem JSON e bearer. Jobs criados carregam Idempotency-Key. Paths e IDs são validados; respostas são limitadas a 1 MiB inclusive streaming sem Content-Length. Bearer não segue redirects. O serviço exige Host loopback, Origin exata e preflight restrito; essas proteções não são substituídas por esconder botões.

Loopback HTTP é uma origem potencialmente confiável, mas o acesso por páginas HTTPS continua sujeito a CORS, políticas e permissões do navegador. O Chrome documenta Local Network Access; sua permissão não autoriza qualquer origem a usar o serviço. Fontes consultadas em 2026-09-07: [Chrome LNA](https://developer.chrome.com/blog/local-network-access), [MDN mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content) e [MDN local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).

Operação em falha:

1. Confirmar que o serviço está aberto no **mesmo computador do navegador** e na versão API v1.
2. Conferir a origem exata permitida no aplicativo local, incluindo scheme/host/porta; Preview não ganha wildcard automaticamente.
3. Se houver prompt de rede local, permitir somente para o site autorizado. Se negado, revisar a permissão desse site nas configurações do navegador.
4. Pareamento recusado: obter token válido no aplicativo local; não enviar token em ticket ou captura.
5. Perda de resposta durante mutation: reconectar e consultar fila; não assumir que o comando falhou. Reenvio sintético na mesma aba conserva a chave.

Não desativar segurança do browser, instalar certificado não confiável ou usar túnel para contornar a política. Se a política do dispositivo/navegador bloquear o bridge, o site permanece utilizável para conteúdo sincronizado; usar operação local aprovada e registrar navegador/versão/origem/código sem token. Firefox/Safari/Edge e uma origem cloud realmente publicada ainda precisam de smoke dedicado; o teste automatizado abaixo usa Chromium e documento HTTPS sintético.

## Validação e reprodução

`pnpm check` verifica tipos, lint, testes unitários, Design System e documentação. `pnpm build` produz o mesmo app Next. `pnpm test:processing` executa testes browser desktop/mobile numa fixture fora de `src/app`; ela nunca cria rota pública nem bypass de Auth. Mocks só existem nesse harness, claramente identificado. O CI executa essa suíte após E2E do app.

`pnpm test:processing:integration` exige `TDA_COMPANION_PYTHON` (Python isolado já preparado) e `TDA_COMPANION_PACKAGE` (diretório `local-companion` da PR #57). Não instala dependências. Cria scratch novo em `test-results`, token exclusivamente sintético e subprocesso próprio na porta **18765**; recusa porta ocupada e encerra somente o processo criado. A fixture traduz o destino apenas nesse ensaio; o endpoint de produto continua 8765.

Evidências em 2026-09-07:

Ensaio integrado reexecutado com a PR #57 no SHA `a5cad8345519b0e82c267b66711577332301d71f`. O CI desta UI valida o commit candidato da própria PR; não aplica nem publica o serviço.

- 27 testes de protocolo/controller/capability passaram: versões, paths, limites de resposta, progresso inválido, erro HTTP/rede, perda de conexão, resposta tardia, concorrência e idempotência de envio incerto.
- Seis testes browser passaram em 1440×1000 e 390×844: pairing, estado, progresso, cancelamento contextual, preparo/pausa, retry, ausência de token em storage/cookie e sem overflow horizontal. Capturas revisadas; sem erro JavaScript nesses fluxos.
- Dois ensaios com o **serviço real em scratch** passaram: UI → pairing → job sintético → resultado → reconexão com fila preservada; contexto HTTPS sintético → fetch loopback real, health 200, sem bearer 401, capabilities autenticada 200, mutation JSON 200 e origem hostil bloqueada por CORS. Permissão LNA foi concedida ao contexto de teste pelo Playwright; nenhuma flag de desativação de segurança foi usada. Isso não comprova o prompt manual do navegador em produção.
- Runtime local: Node 24.19.0 já fornecido no ambiente; CI usa `.node-version` 24.20.0. Next 16.3.4 e React 19.2.8 confirmados como estáveis atuais no registry; lockfile preservado. Nenhuma tecnologia de produto trocada. O harness reutiliza o Vite já transitivo do Vitest apenas para teste.
- `agent-browser` não estava disponível como executável; a operação equivalente foi realizada com Playwright já instalado e inspeção das capturas. Sem instalação no Windows.
- Referência read-only: `D:/Projects/dnd/local-companion` (health/publication/lifecycle). `E:/Project/craig-to-text` contém somente `data` no estado observado; conteúdo não inspecionado. Ausência de fonte/engine executável permanece lacuna.

Esses testes não medem qualidade ASR, GPU, retomada de transcrição pesada ou desempenho real. Não houve áudio pessoal, deployment, DDL, grants, publicação ou gravação cloud.

## Próximo marco: bundle → recibo → revisão

Contrato em alinhamento com Carteiro e Cofrinho; não é endpoint ativo neste PR:

| Fronteira | Requisito antes de habilitar envio |
| --- | --- |
| Exportação local | Motorzinho produz envelope `tda_local_result_v1`; `publication_bundle_v1` é pacote de publicação **sem transcrição completa**. Artefatos de transcript precisam de contrato versionado próprio (incluindo segmentos, offsets, source IDs/hashes e limites), sem áudio, paths privados ou tokens. |
| Identidade | Resolver campanha + sessão interna + source/session externos no servidor; não confiar em campaign/session do browser sem authorization e vínculo. Job ID local não é UUID de sessão cloud. |
| Idempotência | Identidade versionada + hashes canônicos de artefatos imutáveis; retry conserva identidade/payload. Mesmo ID com hash diferente é conflito e não sobrescreve silenciosamente. |
| Autorização | Action de importação e scopes precisam de confirmação explícita com Cofrinho/Chaveiro. `campaign.local.process` ou `campaign.upload.manage` não bastam por inferência. Identidade vem da sessão verificada no servidor; nenhum token local/Supabase administrativo vai no payload. |
| Recepção | Carteiro propõe POST same-origin `/api/transcript-imports` e consulta `/api/transcript-imports/receipt`, ambos ainda dependentes de contrato. Apenas persistência transacional/durável e receipt `committed` com identidade/hash/count correspondentes podem concluir sync. |
| Estados | Pendente → enviando → aguardando confirmação → confirmado. Timeout/accepted sem receipt fica pendente de consulta; falha recuperável reenvia com mesma chave; conflito exige revisão. Nunca promover resposta em memória a recibo durável. |
| Handoff Edit | Somente após receipt validado e resolução de `sourceSessionId`, oferecer `/edit/sessoes/[sourceSessionId]`; leitura segue sua própria capability. Importar evidência não aprova canon/publicação. |

O gate seguinte é um ensaio integrado sintético com export real + consumidor autorizado + persistência durável + receipt consultável + leitura no Edit. Depois disso preparar teste ASR real **explicitamente autorizado**, com fonte/engine disponível e sem carga pesada iniciada por esta entrega.
