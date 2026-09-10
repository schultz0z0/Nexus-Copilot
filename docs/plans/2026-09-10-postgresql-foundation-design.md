# Desenho — Fundação PostgreSQL própria

**Data:** 2026-09-10  
**Estado:** Aceito  
**Marco:** M3 — Fundação PostgreSQL  
**ADR relacionado:** [ADR-0002](../decisions/ADR-0002-postgresql-runtime-roles-and-rls.md)

## Contexto

O ENS precisa substituir a camada de dados do Supabase por PostgreSQL operado
localmente no Docker Desktop e, em produção, por Docker Compose na VPS. O código
copiado ainda contém migrations, claims e papéis específicos do Supabase. Esses
artefatos são fonte para inventário e testes de paridade, não a baseline do banco
novo.

Por decisão de produto, toda capacidade Supabase realmente usada será
internalizada em componentes operados pelo ENS. Não haverá dependência do
Supabase gerenciado nem implantação self-hosted da plataforma completa. O
[inventário de capacidades](../migration/supabase-capability-inventory.md)
registra os destinos e gates por fatia.

A mudança precisa preservar as fronteiras já aprovadas:

- o navegador conversa apenas com a App API/BFF;
- a aplicação resolve identidade, tenant e autorização de negócio;
- PostgreSQL é a autoridade dos dados estruturados e reforça o isolamento com
  RLS;
- arquivos continuam no Artifact Server/object storage;
- Hermes permanece interno e não recebe autoridade sobre identidade ou dados;
- nenhuma credencial, dump ou arquivo de segredo é versionado.

## Objetivos deste lote

1. Executar PostgreSQL oficial e reproduzível em container.
2. Criar uma trilha de migrations imutável e verificável em banco vazio.
3. Separar ownership, migração e acesso da aplicação por menor privilégio.
4. Provar isolamento de tenant com RLS e testes negativos reais.
5. Estabelecer a base mínima para IAM, RunStore e Marketing Ops migrarem em
   fatias posteriores.
6. Registrar os gates necessários para que o banco final seja seguro e operável
   antes do corte de produção.

## Fora de escopo deste lote

- implementar login, logout, refresh, recuperação de senha ou sessões;
- transportar dados reais do Supabase;
- migrar de uma vez todo o schema do Marketing Ops;
- adicionar PgBouncer antes de medir conexões e validar o modelo transacional;
- operar ou alterar a VPS diretamente;
- oferecer PostgreSQL na internet.

## Abordagens consideradas

### A. Kernel primeiro e sentinela vertical

Cria runtime, roles, migrations, contexto transacional e uma fatia mínima de
tenancy/RLS. Só depois os domínios são migrados. É a opção escolhida porque torna
os invariantes de segurança testáveis antes de carregar a complexidade legada.

### B. Migrar Marketing Ops inteiro no primeiro corte

Anteciparia mais funcionalidade, porém juntaria runtime, centenas de objetos SQL,
remoção de claims Supabase e adaptação da aplicação em um único risco. Foi
rejeitada para este lote.

### C. Reexecutar as migrations Supabase ou auto-hospedar Supabase

Seria o caminho mais rápido para reproduzir o legado, mas manteria dependências de
`auth.uid()`, claims, papéis e extensões do Supabase. Viola a arquitetura-alvo e
foi rejeitada.

## Runtime em container

### Imagem e versão

- imagem oficial `postgres:18.6-bookworm`;
- Compose registra a tag e o digest completo da plataforma efetivamente testada;
- atualização é uma mudança deliberada, acompanhada de release notes, backup,
  restore ensaiado e teste das migrations;
- PostgreSQL 18 usa o volume da imagem em `/var/lib/postgresql`; o layout interno
  versionado não deve ser substituído por montagem em um subdiretório antigo.

O digest será resolvido e gravado durante a implementação, nunca inventado na
documentação.

### Desenvolvimento

- Docker Desktop executa o mesmo major/minor de produção;
- override de desenvolvimento publica somente
  `127.0.0.1:55432:5432`;
- dados ficam em volume nomeado descartável de desenvolvimento;
- credenciais de teste não são reutilizadas em produção;
- testes de integração recebem URLs explicitamente, sem fallback silencioso para
  o banco legado na porta `55322`.

### Produção

- PostgreSQL fica em rede Docker privada e não publica portas no host;
- apenas serviços autorizados entram na rede de dados;
- segredo é entregue como arquivo montado em runtime, usando a variante `_FILE`
  suportada pela imagem, e nunca em Git ou saída de diagnóstico;
- volume é persistente e tratado como dado de produção;
- o operador humano executa deploy, migração, backup e rollback na VPS a partir
  de runbook com impacto, resultado esperado e condição de parada.

## Papéis e privilégios

| Papel | Login | Finalidade | Restrições principais |
| --- | --- | --- | --- |
| bootstrap | sim, operação restrita | criar banco e papéis na primeira instalação | não é usado pela aplicação |
| `nexus_owner` | não | possuir schemas, tabelas, funções e policies | não recebe tráfego |
| `nexus_migrator` | sim em job controlado | aplicar migrations aprovadas | não é credencial de runtime da aplicação |
| `nexus_app` | sim | consultas e comandos da App API/serviços autorizados | `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, nunca owner |

Privilégios em `PUBLIC` são revogados onde não forem necessários. `search_path`
é explícito e schemas não concedem `CREATE` a papéis de runtime. Papéis adicionais
de leitura, worker ou backup só serão criados quando houver um consumidor e uma
matriz de privilégios testada.

## Schemas iniciais

- `infra`: ledger de migrations e metadados exclusivamente operacionais;
- `iam`: tenants, sujeitos internos e memberships mínimos; M4 estenderá este
  contrato com autenticação e sessões;
- `app_private`: helpers internos de banco sem criação pública;
- `audit`: reservado para trilhas imutáveis de negócio em lotes posteriores;
- schemas de domínio, como `marketing_ops`, entram apenas na fatia que os migra.

IDs do legado serão preservados durante o transporte. A estratégia de geração de
novos IDs será uniforme e definida antes de domínios produtivos dependerem dela.

## Contexto transacional da aplicação

A App API valida sessão e membership e, dentro da mesma transação da operação,
define valores locais:

- `app.user_id`;
- `app.tenant_id`;
- `app.session_id`;
- `app.role`;
- `app.correlation_id`.

Os valores são definidos por `set_config(..., true)`, portanto expiram ao final
da transação. A operação obedece à sequência:

1. obter conexão do pool;
2. `BEGIN`;
3. validar o ator na aplicação;
4. instalar contexto local;
5. executar consultas e comandos;
6. `COMMIT` ou `ROLLBACK`;
7. devolver a conexão ao pool.

Nenhuma consulta tenant-scoped ocorre fora dessa transação. O banco reforça uma
decisão já autenticada pela aplicação; receber um UUID em uma GUC não equivale a
autenticar um usuário.

## Modelo inicial de RLS

Todas as tabelas tenant-scoped terão coluna `tenant_id NOT NULL`, chave
estrangeira, índice iniciado por `tenant_id` quando compatível com a consulta e:

```sql
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
ALTER TABLE ... FORCE ROW LEVEL SECURITY;
```

Policies usam predicados simples e indexáveis, com `USING` para visibilidade e
`WITH CHECK` para impedir inserção ou mudança para outro tenant. Contexto ausente
ou inválido resulta em negação, não em modo administrativo implícito.

O primeiro canário usará `iam.memberships` e uma tabela sentinela de produto. Ele
provará:

- ator sem contexto não enxerga linhas;
- tenant A não lê, altera ou remove dados do tenant B;
- `INSERT` e mudança de `tenant_id` cross-tenant falham;
- owner e aplicação são papéis distintos;
- o contexto desaparece após `COMMIT` e `ROLLBACK`, inclusive quando a conexão é
  reutilizada pelo pool.

Funções `SECURITY DEFINER` serão exceções. Quando indispensáveis, terão
`search_path` seguro, objetos qualificados, `EXECUTE` revogado de `PUBLIC`, grant
seletivo e teste específico. Policies que consultam outras tabelas serão
avaliadas também quanto a concorrência e consistência de snapshot.

## Sistema de migrations

O monorepo terá um runner Node.js pequeno e testado, reutilizando a plataforma já
adotada pelo projeto. Ele executará SQL numerado em ordem e manterá em `infra`:

- versão única;
- checksum SHA-256 do arquivo;
- instante de aplicação;
- identificação não secreta da migration.

Regras:

- uma migration aplicada é imutável;
- checksum diferente interrompe o processo;
- apenas um runner executa por vez, protegido por advisory lock;
- cada migration transacional roda em `BEGIN/COMMIT` e falha inteira;
- arquivos fora da convenção ou versões duplicadas falham antes de conectar;
- o runner é um job explícito, não conteúdo de
  `/docker-entrypoint-initdb.d`, pois esse diretório só é processado quando o
  volume nasce vazio;
- migração e inicialização do container são operações diferentes e repetíveis.

## Pool de conexões

O primeiro lote usa o pool do driver Node.js. PgBouncer permanece planejado, mas
só entra após medição de orçamento de conexões e teste de compatibilidade. Se for
usado em modo transacional:

- todo contexto continuará transaction-local;
- não haverá dependência de estado de sessão;
- prepared statements nomeados serão proibidos ou configurados de forma
  explicitamente compatível;
- testes de vazamento entre tenants serão repetidos atravessando o pooler.

## Observabilidade sem vazamento

Serão registrados apenas resultados limitados e sem PII:

- estado do healthcheck/readiness;
- versão de schema e duração de migration;
- contagem de conexões, saturação e espera;
- tamanho/crescimento do banco e das tabelas;
- duração de backup e resultado do restore drill;
- falhas de policy agregadas, sem SQL, tokens, IDs pessoais ou credenciais.

Logs não imprimem URLs com senha, conteúdo de linha, claims ou dumps.

## Caminho até segurança e operação completas

M3 só poderá ser marcado **Concluído** quando todos os itens abaixo tiverem
evidência:

### Identidade e autorização

- App API/BFF é a única fronteira pública de dados;
- login/sessão de M4 usa cookies seguros, expiração, rotação e revogação testadas;
- membership ativo é verificado antes de instalar contexto;
- matriz de papéis e autorização de cada domínio possui testes positivos e
  negativos;
- nenhum serviço aceita `tenant_id` do navegador como autoridade.

### Banco e rede

- PostgreSQL e eventual pooler permanecem em redes privadas;
- TLS é habilitado quando houver tráfego fora do mesmo host/rede confiável;
- `pg_hba.conf`, SCRAM, timeouts e limites de conexão são revisados;
- papéis efetivos são auditados contra superuser, ownership e `BYPASSRLS`;
- grants, default privileges, schemas e `search_path` passam por teste automático;
- versão suportada e processo de atualização têm calendário e rollback.

### RLS e integridade

- toda tabela tenant-scoped aparece em inventário automático;
- `ENABLE` e `FORCE RLS`, policies e índices correspondentes são verificados;
- chaves estrangeiras possuem índices quando necessários;
- constraints protegem invariantes que não podem depender somente do código;
- policies complexas passam por revisão de concorrência;
- testes cross-tenant cobrem leitura e todas as mutações.

### Segredos e auditoria

- segredos são externos ao Git, rotacionáveis e diferentes por ambiente;
- credenciais de bootstrap/migration não ficam disponíveis a containers de
  runtime;
- operações administrativas relevantes geram trilha de auditoria protegida;
- logs e métricas são testados contra vazamento de PII e segredo.

### Continuidade

- backup lógico e/ou físico tem retenção, criptografia e cópia fora do volume;
- restauração é exercitada em banco isolado e reconciliada;
- RPO/RTO são definidos pelo responsável do produto;
- migrations possuem instruções de parada e rollback por release;
- monitoramento cobre disco, conexões, locks, replication/backup e erros.

### Migração de dados

- cada objeto Supabase tem destino, transformação ou remoção aprovada;
- o ledger automatizado cobre tabelas, colunas, constraints, índices, policies,
  funções, triggers, buckets e jobs ativos;
- extração e carga são idempotentes;
- contagens, checksums e invariantes são reconciliados;
- ensaio de cutover e rollback ocorre antes do tráfego real;
- Supabase só é removido após comprovação de paridade e janela de retorno.

### Gates deliberadamente abertos em 2026-09-10

- autenticação e sessões self-hosted de M4;
- ledger DDL automatizado e migração dos schemas de domínio;
- object storage, jobs/outbox e decisão dos fluxos RAG em M5;
- backup/restore conjunto de banco e artefatos exercitado;
- observabilidade de produção, TLS, `pg_hba.conf` e orçamento de conexões;
- RPO/RTO aprovados pelo responsável do produto;
- ensaio de extração, carga, reconciliação, cutover e rollback de M6.

Esses itens não invalidam a fundação entregue neste lote, mas impedem marcar M3
ou a retirada do Supabase como concluídos.

## Critérios de aceite do primeiro lote

1. Compose sobe PostgreSQL 18.6 saudável em Docker Desktop e só publica em
   loopback.
2. Um banco vazio recebe todas as migrations e uma segunda execução é idempotente.
3. Alterar uma migration aplicada faz o runner falhar por checksum.
4. Atributos e grants provam que `nexus_app` não é owner nem possui
   `BYPASSRLS`.
5. Testes reais provam negação sem contexto, isolamento cross-tenant e
   `WITH CHECK` em mutações.
6. Reuso da conexão após commit/rollback não herda contexto.
7. O Compose de produção não publica a porta do banco e referencia segredo por
   arquivo.
8. Runbook documenta subida, migração, diagnóstico, parada e rollback sem
   executar a VPS.

## Rollback deste lote

Enquanto não houver dados produtivos, o rollback local é parar o Compose e
remover exclusivamente o volume de desenvolvimento identificado no runbook. Em
produção, nenhuma remoção de volume é um rollback aceitável. O operador para a
release, preserva o volume e restaura em instância isolada a partir do backup
validado antes de decidir a troca.

## Referências normativas

- PostgreSQL: Row Security Policies;
- PostgreSQL: CREATE ROLE;
- PostgreSQL: Configuration Settings Functions (`set_config`);
- PostgreSQL: CREATE FUNCTION e segurança de `SECURITY DEFINER`;
- Docker Official Image: postgres.
