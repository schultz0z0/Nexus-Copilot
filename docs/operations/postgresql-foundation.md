# Runbook — Fundação PostgreSQL

**Marco:** M3  
**Estado:** fluxo local exercitado automaticamente em 2026-09-10; produção não
autorizada  
**Runtime:** PostgreSQL 18.6 em Docker Compose

## Objetivo

Operar a fundação PostgreSQL do ENS sem expor o banco, sem colocar segredos no
Git e sem misturar inicialização do volume com migrations da aplicação. Este
runbook cobre:

- subida e remoção segura no Docker Desktop;
- bootstrap idempotente dos papéis;
- execução e diagnóstico das migrations;
- preparação do procedimento assistido para a VPS;
- parada e rollback sem remover dados de produção.

Backup/restore produtivo, RPO/RTO, migração dos domínios e autenticação ainda são
gates pendentes. Portanto, este documento **não autoriza o banco a receber dados
ou tráfego de produção**.

## Fronteiras obrigatórias

- O navegador nunca conecta ao PostgreSQL.
- Em desenvolvimento, a porta é publicada somente em `127.0.0.1`.
- Na VPS, nenhuma porta do banco é publicada no host.
- Somente a App API e serviços explicitamente autorizados usam `nexus_app`.
- `nexus_bootstrap` e `nexus_migrator` não ficam disponíveis aos containers de
  aplicação.
- O agente não acessa SSH, painel ou Docker da VPS; o operador humano executa os
  comandos e devolve apenas saídas redigidas.
- Nunca cole senhas, URLs com senha, dumps ou arquivos de secrets em chat/log.

## Arquivos operacionais

| Arquivo | Uso |
| --- | --- |
| `infra/postgres/compose.yaml` | serviços, volume, rede e secrets comuns |
| `infra/postgres/compose.development.yaml` | publicação local em loopback |
| `infra/postgres/compose.production.yaml` | rede interna e nenhuma porta publicada |
| `infra/postgres/bootstrap/roles.sql` | papéis e grants iniciais |
| `infra/postgres/migrations/*.sql` | schema versionado e imutável |
| `infra/postgres/secrets/` | secrets locais ignorados pelo Git |

## Desenvolvimento no Docker Desktop

### 1. Pré-checagem

Na raiz do repositório:

```powershell
git status --short
docker version
docker compose version
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  config --quiet
```

**Impacto:** somente leitura.  
**Esperado:** Docker responde e o Compose é válido.  
**Pare se:** Docker Desktop não estiver saudável ou o Compose falhar.  
**Rollback:** nenhum.

### 2. Criar secrets locais

Os comandos abaixo criam somente os três arquivos ignorados pelo Git:

```powershell
$secretDirectory = Join-Path (Get-Location) 'infra/postgres/secrets'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null

function New-NexusSecretFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $bytes = [byte[]]::new(48)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [IO.File]::WriteAllText($Path, [Convert]::ToBase64String($bytes))
}

New-NexusSecretFile (Join-Path $secretDirectory 'postgres_bootstrap_password')
New-NexusSecretFile (Join-Path $secretDirectory 'postgres_migrator_password')
New-NexusSecretFile (Join-Path $secretDirectory 'postgres_app_password')
```

**Impacto:** cria ou substitui credenciais apenas do ambiente local.  
**Esperado:** três arquivos não vazios; `git status --short` não os lista.  
**Pare se:** qualquer arquivo aparecer no Git ou o diretório resolvido não for
`infra/postgres/secrets`.  
**Rollback:** apague somente esses três arquivos; eles podem ser regenerados
antes de criar o banco.

### 3. Subir o banco

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  up -d --wait postgres
```

**Impacto:** cria a rede `ens-postgres-data`, o volume `ens-postgres-data` e o
container do banco; publica `127.0.0.1:55432`.  
**Esperado:** serviço `postgres` em estado `healthy`.  
**Pare se:** a porta estiver ocupada, o serviço reiniciar repetidamente ou o
healthcheck falhar.  
**Rollback:** execute `docker compose ... stop postgres`. Preserve o volume para
diagnóstico.

Para escolher outra porta local sem alterar arquivos:

```powershell
$env:POSTGRES_DEV_PORT = '55439'
```

### 4. Criar ou reconciliar os papéis

```powershell
docker compose --profile tools `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --no-deps postgres-bootstrap
```

**Impacto:** cria/reconcilia `nexus_owner`, `nexus_migrator` e `nexus_app`, aplica
grants e sincroniza as senhas com os secret files.  
**Esperado:** processo termina com código `0`; nenhuma senha aparece.  
**Pare se:** houver falha de conexão, segredo ausente ou saída contendo valor
secreto.  
**Rollback:** não remova o volume. Corrija o secret/Compose e repita; o bootstrap
é idempotente.

### 5. Construir e executar migrations

```powershell
docker compose --profile tools `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  build postgres-migrate

docker compose --profile tools `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  run --rm --no-deps postgres-migrate
```

**Impacto:** aplica somente migrations ainda não registradas, uma transação por
arquivo.  
**Esperado na primeira execução:** evento JSON com `0001`, `0002` e `0003` em
`applied`. Repetindo o comando, elas aparecem em `skipped`.  
**Pare se:** checksum divergir, uma migration falhar ou o advisory lock não puder
ser obtido. Não edite um arquivo já aplicado.  
**Rollback:** falha SQL é revertida automaticamente dentro da migration. Para
reverter uma mudança já aplicada, crie uma nova migration; não altere o ledger.

### 6. Executar o gate automatizado

```powershell
npm run test:postgres
npm run test:postgres:integration
```

**Impacto:** a suíte de integração cria seu próprio projeto Compose, secrets e
volume temporários e os remove ao final. Não usa o volume manual de
desenvolvimento.  
**Esperado:** contratos e integração passam; nenhuma entrada com prefixo
`ens-postgres-test-` permanece em containers ou volumes.  
**Pare se:** houver falha de cleanup; preserve a saída sem segredos e identifique
o nome exato antes de remover recursos.  
**Rollback:** a suíte já executa `down --volumes` apenas no projeto temporário que
ela própria criou.

### 7. Parar ou descartar o ambiente local

Parar preservando dados:

```powershell
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  stop postgres
```

Descartar **somente o banco local**, depois de confirmar o alvo:

```powershell
docker volume inspect ens-postgres-data
docker compose `
  -f infra/postgres/compose.yaml `
  -f infra/postgres/compose.development.yaml `
  down --volumes --remove-orphans
```

**Impacto:** `down --volumes` destrói os dados do volume local identificado.  
**Pare se:** o nome não for exatamente `ens-postgres-data` ou houver dúvida sobre
o conteúdo.  
**Recuperação:** não há recuperação sem backup; nunca execute essa operação na
VPS.

## Produção assistida na VPS

### Gate atual

O procedimento abaixo é uma preparação auditável. Antes da primeira execução
produtiva ainda precisam estar aprovados:

1. backup e restore exercitados em destino isolado;
2. RPO/RTO definidos;
3. inventário Supabase com destino por objeto;
4. autenticação/App API e consumidores usando `nexus_app`;
5. observabilidade de disco, conexões, locks, backup e erros;
6. revisão de `pg_hba.conf`, SCRAM e TLS conforme a topologia final;
7. janela de mudança e rollback aprovada pelo operador.

Sem esses itens, a condição de parada é imediata: não colocar dados nem tráfego
real no banco.

### Layout previsto

- repositório: `/opt/nexus-copiloto`;
- secrets fora do Git: `/opt/nexus-copiloto-secrets/postgres`;
- volume Docker: `ens-postgres-data`;
- rede privada: `ens-postgres-data`;
- nenhuma porta publicada no host.

### 1. Pré-checagem pelo operador

```bash
cd /opt/nexus-copiloto
git status --short
git rev-parse --short HEAD
docker version
docker compose version
docker compose \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  config --quiet
```

**Impacto:** somente leitura.  
**Esperado:** checkout limpo no commit aprovado e Compose válido.  
**Pare se:** houver alteração não reconhecida, branch/commit incorreto ou falha do
Docker.  
**Rollback:** nenhum.

### 2. Criar secrets fora do repositório

```bash
sudo install -d -m 700 /opt/nexus-copiloto-secrets/postgres
sudo sh -c 'umask 077; openssl rand -base64 48 > /opt/nexus-copiloto-secrets/postgres/bootstrap'
sudo sh -c 'umask 077; openssl rand -base64 48 > /opt/nexus-copiloto-secrets/postgres/migrator'
sudo sh -c 'umask 077; openssl rand -base64 48 > /opt/nexus-copiloto-secrets/postgres/app'
```

Exporte somente caminhos, nunca valores:

```bash
export POSTGRES_BOOTSTRAP_PASSWORD_FILE=/opt/nexus-copiloto-secrets/postgres/bootstrap
export POSTGRES_MIGRATOR_PASSWORD_FILE=/opt/nexus-copiloto-secrets/postgres/migrator
export POSTGRES_APP_PASSWORD_FILE=/opt/nexus-copiloto-secrets/postgres/app
```

**Impacto:** cria credenciais de produção.  
**Esperado:** diretório modo `700`, arquivos modo `600`, fora do checkout.  
**Pare se:** o caminho estiver dentro do Git, permissões forem mais abertas ou o
comando imprimir o segredo.  
**Rollback:** remova somente os arquivos recém-criados antes de qualquer banco
ser inicializado; depois disso, trate como rotação controlada.

### 3. Pull, subida e bootstrap

Somente depois da liberação do gate:

```bash
docker compose \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  pull postgres

docker compose \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  up -d --wait postgres

docker compose --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-bootstrap
```

**Impacto:** baixa a imagem fixada, cria/reutiliza rede e volume e reconcilia
papéis.  
**Esperado:** apenas `postgres` permanece; estado `healthy`; nenhuma porta em
`docker compose ps`; bootstrap código `0`.  
**Pare se:** o volume existente não for o esperado, surgir porta publicada,
imagem/digest divergir ou health falhar.  
**Rollback:** `docker compose ... stop postgres`; preserve volume e secrets. Não
use `down --volumes`.

### 4. Aplicar migrations

```bash
docker compose --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  build --pull postgres-migrate

docker compose --profile tools \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  run --rm --no-deps postgres-migrate
```

**Impacto:** altera o schema do volume de produção.  
**Esperado:** apenas versões aprovadas em `applied` ou `skipped`; código `0`.  
**Pare se:** checksum divergir, SQL falhar, versão não reconhecida aparecer ou
backup pré-mudança não estiver comprovado.  
**Rollback:** uma falha transacional se reverte sozinha. Após commit, pare a
release e siga a migration corretiva ou restauração ensaiada; nunca edite SQL já
aplicado nem o ledger manualmente.

### 5. Conectar consumidores privados

Outro Compose autorizado declara a rede existente:

```yaml
networks:
  postgres-data:
    external: true
    name: ens-postgres-data
```

O consumidor usa host `postgres`, porta `5432`, banco `nexus`, usuário
`nexus_app` e lê a senha de um arquivo montado. Somente App API/serviços aprovados
recebem essa rede e esse secret.

**Impacto:** libera conectividade interna ao consumidor.  
**Esperado:** readiness funciona, mas acesso sem contexto retorna zero linhas em
tabelas RLS.  
**Pare se:** o consumidor pedir `nexus_bootstrap`/`nexus_migrator`, publicar a
porta ou aceitar `tenant_id` do navegador como autoridade.  
**Rollback:** desconecte o consumidor da rede e restaure sua release anterior;
preserve PostgreSQL.

## Diagnóstico e logs redigidos

Comandos permitidos ao operador:

```bash
docker compose \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  ps

docker compose \
  -f infra/postgres/compose.yaml \
  -f infra/postgres/compose.production.yaml \
  logs --tail 100 postgres
```

Antes de compartilhar saída, remova IPs públicos, nomes pessoais, e-mails,
tokens, URLs de conexão, SQL com dados e qualquer valor de secret. Preserve
timestamps, estado de health, SQLSTATE e nomes de migrations.

## Rollback de produção

1. Pare os consumidores/escritas da release nova.
2. Pare o container PostgreSQL somente se houver risco de novas escritas.
3. Preserve volume, secrets e logs redigidos.
4. Se a migration falhou antes do commit, corrija a causa e repita.
5. Se a migration já comitou, use migration corretiva ou restaure o backup em
   instância isolada conforme o futuro runbook de backup/restore.
6. Valide reconciliação antes de apontar consumidores para qualquer instância
   restaurada.

Proibido em produção:

```text
docker compose down --volumes
docker volume rm ens-postgres-data
```

## Evidência mínima a registrar

- data, operador e commit do Git;
- versão/digest das imagens;
- resultado redigido de `docker compose config` e `ps`;
- migrations aplicadas/puladas e duração;
- resultado do teste de menor privilégio/RLS;
- referência do backup e do restore drill, sem caminhos secretos;
- decisão de avançar ou rollback.

## Último exercício

Em 2026-09-10, a suíte `npm run test:postgres:integration` criou um volume vazio,
executou bootstrap, aplicou `0001`–`0003`, repetiu as migrations, consultou roles,
owners, policies, índices e grants, tentou operações cross-tenant, confirmou a
limpeza de contexto após commit/rollback e rejeitou checksum alterado. A suíte
removeu seus containers, rede, secrets temporários e volume ao final. Nenhuma VPS
foi acessada.

No gate final do mesmo dia, passaram 12 contratos Compose/SQL, 9 testes do
runner e 5 integrações reais do PostgreSQL. Também passaram 147 testes do
frontend, 124 do Chat Bridge, 13 do Artifact Server, 85 testes selecionados do
Marketing Ops sem banco legado, typecheck e builds. A suíte completa do Marketing
Ops permaneceu vermelha somente nos contratos que procuram migrations Supabase
não copiadas, no `docker-compose.yml` histórico e nas integrações configuradas
para `127.0.0.1:55322`. Esse baseline deve ser substituído por fatia de domínio;
não se deve restaurar as migrations antigas dentro da baseline nova para obter
um falso sucesso.
