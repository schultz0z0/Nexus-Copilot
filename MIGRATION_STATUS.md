# Estado da migração

Data da baseline: 2026-08-27

## Verificações executadas

- Instalação por lockfile concluída nos quatro pacotes.
- Typecheck do frontend e Marketing Ops: aprovado.
- Frontend: 39 arquivos de teste e 145 testes aprovados.
- Chat Bridge: 90 testes aprovados.
- Artifact Server: 13 testes aprovados.
- Build de produção do frontend e build TypeScript do Marketing Ops: aprovados.
- Profile Distribution ENS: YAML e JSON carregados e estrutura mínima validada.

## Gate ainda vermelho

O comando agregado `npm test` não está verde porque o Marketing Ops ainda depende da infraestrutura que este corte deliberadamente não trouxe:

- testes de contrato procuram migrations Supabase antigas;
- testes de integração procuram PostgreSQL em `127.0.0.1:55322`;
- alguns testes de delegação carregam premissas temporais/runtime do fork anterior.

Isso será resolvido quando `db/migrations` receber a baseline PostgreSQL vanilla e Marketing Ops for adaptado ao novo contrato de identidade/delegação. A falha não foi mascarada nem removida dos scripts.

## Hermes oficial — M1 em execução

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

O teste comportamental POSIX do inicializador está escrito, mas seus quatro
cenários ficaram skipped neste computador: não há shell POSIX instalado. Por
segurança, nada foi instalado e nenhum container/imagem foi iniciado. Esse gate
deve rodar no container Linux ou na VPS antes da aceitação do M1.

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

Resultado focado atual: 15 testes Hermes aprovados, 4 cenários POSIX skipped e
zero falhas. Os runbooks ainda não foram exercitados; portanto, M1 continua em
execução e nenhum deploy é declarado aceito.

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

**Bloqueado para ensaio em 2026-09-08.** Por se tratar de computador
corporativo, não houve autorização específica para pull da imagem, criação de
container ou volume de teste. A implementação não simulou esse resultado.

Já comprovado sem runtime: Compose v5.4.0 renderiza, pin/digest e isolamento
estrutural passam nos testes. Pendente: execução POSIX do init, runtime real,
health/capabilities, persistência, backup/restore e rollback.

Situação de aceite: **implementação pronta para ensaio, não pronta para deploy**.
Runs API no Bridge e retirada do contrato Hermes legado do navegador continuam
fora do M1, respectivamente em M2 e M4.

O próximo lote foi preparado para continuidade em outro computador com Docker
Desktop. O handoff usa projeto `ens-hermes-m1`, volume isolado
`ens-hermes-m1-data` e override que publica somente a API em
`127.0.0.1:18642`, com dashboard desabilitado. A autorização não inclui apagar o
volume, tocar o Hermes local, configurar provider ou acessar a VPS. Nenhuma
dessas ações foi executada neste computador.

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
