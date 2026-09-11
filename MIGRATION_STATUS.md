# Estado da migração

Data da baseline: 2026-08-27

## Verificações executadas

- Instalação por lockfile concluída nos quatro pacotes.
- Typecheck do frontend e Marketing Ops: aprovado.
- Frontend: 39 arquivos de teste e 145 testes aprovados.
- Chat Bridge: 124 testes aprovados.
- Artifact Server: 13 testes aprovados.
- Build de produção do frontend e build TypeScript do Marketing Ops: aprovados.
- Profile Distribution ENS: YAML e JSON carregados e estrutura mínima validada.

## Gate ainda vermelho

O comando agregado `npm test` não está verde porque o Marketing Ops ainda depende da infraestrutura que este corte deliberadamente não trouxe:

- testes de contrato procuram migrations Supabase antigas;
- testes de integração procuram PostgreSQL em `127.0.0.1:55322`;
- alguns testes de delegação carregam premissas temporais/runtime do fork anterior.

Isso será resolvido quando `db/migrations` receber a baseline PostgreSQL vanilla e Marketing Ops for adaptado ao novo contrato de identidade/delegação. A falha não foi mascarada nem removida dos scripts.

## Hermes oficial — M1 concluído na VPS (2026-09-11)

Em 2026-09-08, o primeiro lote do runtime oficial foi implementado na branch
`codex/hermes-m1`:

- contrato automatizado da Profile Distribution ENS aprovado;
- requisito mínimo fixado em Hermes `0.20.6`;
- inicializador idempotente `install/update/use` implementado sem
  `--force-config`;
- Compose base renderizado com a imagem oficial fixada por tag e digest;
- volume `/opt/data` compartilhado sequencialmente entre init e runtime;
- API `8642` mantida sem publicação de porta e nenhum Docker socket montado;
- provider e credenciais continuam ausentes do repositório.

O teste comportamental POSIX do inicializador está escrito. Seus cenários
continuam skipped pelo runner Node do Windows por falta de shell POSIX no host,
mas o próprio inicializador foi executado repetidamente com sucesso dentro da
imagem Linux oficial no ensaio de 2026-09-09.

Compatibilidade conhecida do pin: o Hermes `0.20.6` distribui `mcp.json`, mas seu
runtime ainda carrega MCPs de `config.yaml#mcp_servers`. O ENS mantém somente a
definição funcional em `config.yaml` e valida que não exista duplicação.

O segundo lote M1, também em 2026-09-08, acrescentou:

- override de produção com um único router Traefik para o dashboard `9119`;
- OAuth Nous obrigatório para o dashboard público;
- smoke autenticado para liveness, readiness e capabilities do Runs API;
- falha fechada para provider ausente, salvo tolerância explícita no primeiro
  deploy;
- runbooks de desenvolvimento Windows e primeiro deploy na VPS.

Resultado focado em 2026-09-09: 16 testes Hermes aprovados, 5 cenários POSIX
skipped pelo runner Windows e zero falhas. O init real dentro do container Linux
cobriu o caminho operacional. Também passaram: corte `3/3`, verificação do corte
`397/397`, Chat Bridge `90/90`, Artifact Server `13/13` e renderizações base,
paridade e produção. M1 continua em execução porque VPS, HTTPS/OAuth,
provider manual e rollback do core ainda não foram exercitados; recuperação e
rollback do profile foram comprovados localmente no lote seguinte.

O terceiro lote documentou atualização/rollback e backup/restore, registrou o
bloqueio do ensaio Docker Desktop e executou a auditoria final permitida. A
verificação fresca aprovou:

- Profile Distribution: válida;
- contratos Hermes: 15 aprovados, 4 POSIX skipped, 0 falhas;
- Compose base e produção: renderização aprovada, sem iniciar containers;
- corte inicial: 397 arquivos, 0 divergências e 0 caminhos proibidos;
- Chat Bridge: 90 testes aprovados;
- Artifact Server: 13 testes aprovados;
- verificador do corte: 3 testes aprovados para fim de linha, diferença real e
  binários.

Durante essa auditoria, `verify:cut` inicialmente falhou porque comparava bytes
da árvore histórica em CRLF/CRCRLF com o checkout LF do monorepo. A correção
normaliza apenas fim de linha em texto UTF-8 e mantém igualdade byte a byte para
binários; diferenças substantivas continuam reprovadas.

### Gate Docker Desktop

**Comprovado em 2026-09-09 dentro do escopo autorizado.** O projeto isolado
`ens-hermes-m1` baixou a imagem oficial fixada, criou apenas o volume
`ens-hermes-m1-data` e executou init, runtime, smoke, restart, segundo init e
recriação completa. A API ficou restrita a `127.0.0.1:18642` e o dashboard
permaneceu desabilitado.

O ensaio encontrou e corrigiu quatro incompatibilidades reais: comando inicial
abria a TUI, gateway `default` disputava a porta com `ens`, a capability oficial
usa `run_approval_response`, e o migrador Docker exige um piso de schema para
configs não versionados. O resultado final possui:

- um único processo de gateway `hermes -p ens`;
- `default` parado e `/v1/models` anunciando `ens`;
- Profile Distribution `ens@0.1.1`;
- configs raiz/profile migrados ao schema `39` pelo migrador oficial;
- liveness e capabilities aprovadas;
- única degradação de readiness em `model`, esperada sem provider;
- persistência comprovada em restart e `down`/`up`;
- nenhum container ao final e volume de evidência preservado.

### Gate local de recuperação

Em 2026-09-09, o volume isolado `ens-hermes-m1-data` foi arquivado em repouso,
o checksum SHA-256 foi validado e o conteúdo foi restaurado primeiro no volume
novo `ens-hermes-restore-20260909T170349Z`. O profile `ens@0.1.1` e o runtime
restaurados passaram em liveness, capabilities e smoke autenticado, tolerando
somente o provider deliberadamente ausente.

No volume restaurado, um candidato descartável e validado `ens@0.1.2` comprovou
o update manual da distribuição; a reaplicação da distribuição rastreada
`ens@0.1.1` comprovou o rollback. O container temporário foi removido e os dois
volumes e o arquivo de backup ficaram preservados. Nenhum estado do Hermes local
do Windows ou da VPS foi acessado.

Situação de aceite: **M1 100% concluído e validado na VPS em 2026-09-11**.
O deploy foi realizado pelo operador humano assistido pelo copiloto do agente
([runbook de primeiro deploy](docs/operations/hermes-first-deploy.md)).
O container oficial `ens-hermes-hermes-1` está ativo e saudável (`Up healthy`)
sob o supervisor `s6-overlay`. O Profile Distribution `ens@0.1.1` foi instalado
e migrado no volume `ens-hermes-data`. A API interna (`8642`) foi aprovada em
liveness e capabilities via smoke test. O Dashboard oficial (`9119`) está
autenticado com Basic Auth e publicado com segurança via Traefik em
`https://hermes.solucoes-nexus.tech` com HTTPS/TLSv1.3 válido. A API `8642`
permanece inacessível publicamente.

## Hermes Runs Bridge — M2 em execução; checkpoint C local aprovado

Em 2026-09-09, os checkpoints A e B foram aprovados localmente. Texto e arquivos
com conteúdo extraído seguem pelo Runs API oficial; Picture, imagens e binários
sem extração permanecem no Session API. O Bridge agora:

- verifica capabilities obrigatórias de forma fail-closed;
- cria Runs com idempotência e persiste o ID Hermes antes do consumidor SSE;
- normaliza approvals, stopping, cancellation e provider ausente;
- mantém um consumidor upstream por Run e replay por cursor somente no Bridge;
- responde approvals e stop pelos endpoints oficiais com autorização cross-user;
- preserva o contrato do frontend sem expor Hermes ao navegador.

O checkpoint C comprovou o contrato do pin oficial num projeto Docker Desktop
isolado. A primeira tentativa em volume vazio encontrou uma premissa incorreta:
`profile install` criava o config do profile ENS, mas não o `config.yaml` raiz.
O inicializador passou a criar essa configuração pelo CLI oficial antes do
migrador e um segundo ensaio, novamente em volume totalmente vazio, passou.

Evidência fresca do lote:

- Chat Bridge: 124/124;
- frontend: 147/147 e typecheck aprovado;
- contratos Hermes: 16 aprovados, 6 cenários POSIX skipped no runner Windows;
- Artifact Server: 13/13;
- contrato Python ao vivo: 1/1 no pin `v2026.8.27` pelo digest aprovado;
- smoke Node: liveness e capabilities aprovadas, readiness degradada somente por
  `provider_unconfigured`;
- chamadas sem Bearer token para capabilities e criação de Run rejeitadas;
- containers e rede `ens-hermes-m2-fresh` removidos; volume
  `ens-hermes-m2-fresh-data` preservado como evidência.

M2 ainda não possui aceite externo completo. Run com resposta de modelo,
approval, rejeição e cancelamento reais aguardam provider configurado manualmente
pelo operador. O exercício na VPS também permanece pendente. Nenhuma operação de
produção foi realizada neste lote.

O OAuth do Hostinger Connector foi validado em modo somente leitura em
2026-09-09. Essa validação não constituiu deploy, não alterou a VPS e não muda a
regra de que produção é operada pelo responsável humano.

Na verificação final deste checkpoint, `npm test` passou o frontend 147/147 e
então manteve o gate agregado vermelho no Marketing Ops pelas mesmas premissas
herdadas: migrations Supabase deliberadamente ausentes, PostgreSQL indisponível
em `127.0.0.1:55322`, `docker-compose.yml` legado não copiado e testes de
delegação presos a premissas temporais antigas. O agregador interrompe antes do
Bridge e Artifact Server; ambos foram executados separadamente e passaram
124/124 e 13/13. Nenhuma dessas falhas foi mascarada ou corrigida com a
reintrodução de infraestrutura proibida.

Uma nova execução de `npm test` em 2026-09-08 manteve o gate agregado vermelho:
frontend passou 145/145, mas Marketing Ops ainda procura migrations Supabase não
copiadas e PostgreSQL em `127.0.0.1:55322`. O comando interrompe antes de Bridge
e Artifact Server, que seguem aprovados quando executados separadamente. Essa
falha herdada não foi removida nem atribuída ao lote Hermes.

## Dívida de dependências herdada

- Frontend: 2 vulnerabilidades moderadas e 2 altas reportadas por `npm ci`.
- Marketing Ops: 1 vulnerabilidade alta reportada por `npm ci`.

Nenhum `npm audit fix` automático foi aplicado para evitar mudanças sem revisão no corte inicial.

## Avisos de build herdados

- bundle principal do frontend acima de 500 kB;
- importação estática e dinâmica simultânea do cliente Supabase legado;
- base Browserslist desatualizada.
