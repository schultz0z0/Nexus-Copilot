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

Resultado focado atual: 13 testes Hermes aprovados, 4 cenários POSIX skipped e
zero falhas. Os runbooks ainda não foram exercitados; portanto, M1 continua em
execução e nenhum deploy é declarado aceito.

### Gate Docker Desktop

**Bloqueado para ensaio em 2026-09-08.** Por se tratar de computador
corporativo, não houve autorização específica para pull da imagem, criação de
container ou volume de teste. A implementação não simulou esse resultado.

Já comprovado sem runtime: Compose v5.4.0 renderiza, pin/digest e isolamento
estrutural passam nos testes. Pendente: execução POSIX do init, runtime real,
health/capabilities, persistência, backup/restore e rollback.

## Dívida de dependências herdada

- Frontend: 2 vulnerabilidades moderadas e 2 altas reportadas por `npm ci`.
- Marketing Ops: 1 vulnerabilidade alta reportada por `npm ci`.

Nenhum `npm audit fix` automático foi aplicado para evitar mudanças sem revisão no corte inicial.

## Avisos de build herdados

- bundle principal do frontend acima de 500 kB;
- importação estática e dinâmica simultânea do cliente Supabase legado;
- base Browserslist desatualizada.
