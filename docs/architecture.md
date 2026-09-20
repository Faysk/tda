# Arquitetura

> Status: vigente
> Owner: arquitetura
> Última revisão: 2026-09-20
> Fonte de verdade: [ADR-0018](adr/0018-portable-core-github-control-plane.md), invariantes e contratos donos de cada domínio

Aplicação Next única em `src/app`. Domínios em `src/features`; conexões/providers em `src/integrations`; composição em `src/components`. Sem segundo frontend ou proxy obrigatório para o legado.

## Direção estrutural

O TDA segue **portable core, replaceable edges**. O domínio e as experiências do produto não pertencem a Vercel, Supabase ou Cloudflare. Esses serviços são providers atuais e podem ser substituídos independentemente.

`Faysk/tda` é o control plane canônico: código, documentação, ADRs, manifests, migrations, workflows e configuração declarativa ficam versionados no GitHub; GitHub Actions controla operações automatizadas. Credenciais operacionais de CI/CD ficam preferencialmente em GitHub Environments. Um provider de runtime mantém apenas os secrets realmente necessários durante a execução.

A política de infraestrutura é **free-first**: usar opções gratuitas enquanto atenderem segurança, integridade, capacidade e experiência. Tier ou serviço pago só entra após necessidade comprovada e decisão documentada. Isso não autoriza reduzir guardrails para preservar custo zero.

## Dados — provider atual: Supabase

O contrato relacional principal é PostgreSQL com migrations versionadas no Git. O provider atual é o projeto Supabase existente `dmrqnbdvbkfqzctcerbx`; ADR-0002 preserva a decisão operacional de reutilizar essa base enquanto ela atende ao TDA. Supabase não é identidade permanente da arquitetura.

O servidor consulta somente sessões publicadas da campanha `yuhara-main`, com seleção explícita de campos. O catálogo não busca transcrições, metadata integral ou dados de usuários. Para mídia pública, seleciona somente referências necessárias e o model aceita apenas origens HTTPS explicitamente permitidas. Detalhe retorna resumo completo como texto escapado; a apresentação usa renderer Markdown próprio sem HTML bruto.

O modelo de domínio vigente está em [data-model.md](data-model.md) e o estado observado do banco em [database-audit.md](database-audit.md). `tda` é a identidade canônica do projeto; `yuhara-main` continua sendo a identidade da campanha. Proveniência (`craig`, `local_companion`, Discord/Roll20) não é renomeada. Enquanto o legado ainda opera, o scope técnico `dnd-scribe` permanece como compatibilidade ao lado de `tda`.

RLS continua deny-by-default na maior parte do schema. O servidor atual usa chave secreta exclusivamente server-side para a leitura pública estreita; ela tem poderes elevados e não é tecnicamente read-only. Novas superfícies autenticadas devem validar a identidade do usuário e resolver capabilities do RBAC. Não abrir policies genéricas apenas para simplificar o frontend.

Dependências específicas do Supabase podem ser usadas quando agregam valor, mas devem permanecer identificáveis e, quando possível, atrás do boundary de integração correspondente para que o custo de migração seja conhecido.

## Runtime/deploy — provider atual: Vercel

Vercel é o provider atual de runtime e deployment web. GitHub Actions continua sendo o controlador da entrega; configuração necessária apenas para CI/CD não deve depender da Vercel como cofre intermediário. Runtime secrets podem existir na Vercel quando o processo em execução realmente precisa deles.

Trocar Vercel no futuro deve ser uma troca do edge de runtime/deploy, não uma redefinição do domínio do TDA.

## Identidade narrativa

`profiles` representa pessoas/contas. `entities` representa objetos canônicos do mundo (`pc`, `npc`, `location`, `item`, `organization`, `faction`, `arc`, `concept`, `song`, `quest`). `profile_characters` associa um profile a uma entidade `pc`; `participants` representa a ocorrência desse personagem numa sessão. Assim PC e NPC podem compartilhar mentions, canon e relações futuras sem duas identidades narrativas concorrentes.

Transcrição e eventos são evidência, não verdade canônica. O fluxo esperado é fonte → classificação/candidato → revisão → `canon_entries`/publicação. Nada derivado por IA deve virar canon sem fonte e decisão de revisão.

## Relações e conhecimento

O roadmap prevê grafo de entidades/relações e possível React Flow. Relações serão edges first-class entre entities, com audiência/visibilidade e evidência; o schema definitivo ainda não está aprovado. Também permanece futura a modelagem de conhecimento por audiência (jogador, personagem, público, rumor, mentira, segredo do mestre). Não esconder esses conceitos em JSON ad hoc antes do desenho da feature.

## Media Storage — provider atual: Cloudflare R2

**Toda mídia do TDA pertence ao Media Storage, não ao Git.** Isso inclui imagens, backgrounds, portraits, mapas, social cards, áudio, vídeo, assets de marca e demais binários de mídia.

Cloudflare R2 é o provider atual. O contrato permanente é provider-neutral: objetos imutáveis/content-addressed quando aplicável, manifests versionados, hash/MIME/bytes/provenance, separação public/private/preview, read-back e verificação pública antes de promoção. Banco mantém identidades, relações e metadados de domínio; Media Storage mantém os bytes.

Binários de mídia ainda presentes no repositório são compatibilidade/dívida de migração, não precedente para nova mídia. A convergência deve ser deliberada e não destrutiva.

Áudio bruto de transcrição continua fora da retenção cloud por ADR-0003; a regra de Media Storage se aplica à mídia que o produto decide persistir/publicar, não transforma intermediários locais em obrigação de cloud.

## Compatibilidade de URLs

O site legado usa fragmentos `#/sessao/{sourceSessionId}` e `#/sessao/{sourceSessionId}/resumo`. Fragmentos não chegam ao servidor HTTP, portanto o layout instala uma ponte client-side mínima que reconhece somente esses formatos e substitui a navegação por `/sessoes/{sourceSessionId}`. Hashes desconhecidos são ignorados. Isso permite preservar links antigos quando o domínio migrar para o reboot sem reintroduzir o frontend legado.

## Transcrição

O companion local será modernizado preservando o fluxo atual. O reboot não deve reativar ingestão pesada em cloud nem retenção de áudio bruto. Conteúdo sincronizado deve funcionar com o PC desligado; novas transcrições continuam dependendo do companion local.
