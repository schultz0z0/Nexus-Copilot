# Recuperação PostgreSQL, observabilidade e revisão IAM/Chat

**Data:** 2026-09-10

**Status:** aprovado para implementação

**Marcos:** fechamento operacional de M3 e preparação controlada de M4
**Decisões do responsável:** RPO inicial de 1 hora; RTO inicial de 2 horas;
aprovação seletiva do ledger por grupos seguros.

## 1. Objetivo

Entregar a primeira camada operacional recuperável do PostgreSQL próprio da ENS
e transformar as propostas de IAM/Chat do ledger Supabase em decisões humanas,
explícitas e auditáveis. O lote não implementa ainda autenticação, sessões nem o
Chat Store definitivo: ele cria a segurança operacional e o contrato de revisão
necessários para essas implementações.

## 2. Contexto e princípios

- PostgreSQL é a autoridade dos dados do produto.
- Navegadores acessam somente a App API/BFF; nunca acessam PostgreSQL ou Hermes
  diretamente.
- Identidade, tenant e autorização de negócio são resolvidos pela aplicação.
- RLS é defesa em profundidade e não substitui autorização da App API.
- Não serão reproduzidos papéis internos do Supabase (`anon`, `authenticated`,
  `service_role`) no PostgreSQL ENS.
- Produção é operada exclusivamente pelo responsável humano. O repositório
  fornece comandos, validações, condições de parada e rollback; o agente não
  executa ações administrativas na VPS.
- Nenhuma credencial, dump, manifesto operacional, sessão ou banco será
  versionado.

O formato customizado de `pg_dump` é portátil e permite inspeção e restauração
seletiva com `pg_restore`. Ele é adequado para a escala inicial e não deve ser
confundido com backup físico/PITR, que depende de base backup e arquivamento
contínuo de WAL:

- <https://www.postgresql.org/docs/18/app-pgdump.html>
- <https://www.postgresql.org/docs/current/app-pgrestore.html>
- <https://www.postgresql.org/docs/17/continuous-archiving.html>

O Restic fornece criptografia do repositório, snapshots, retenção e verificações
de integridade:

- <https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html>
- <https://restic.readthedocs.io/en/stable/045_working_with_repos.html>

## 3. Alternativas consideradas

### A. Lote equilibrado — escolhido

Combina backup/restore, observabilidade e revisão seletiva de IAM/Chat. Fecha o
risco operacional mais imediato sem declarar que M4 já foi implementado.

### B. PITR desde o primeiro lote

Base backup e WAL permitem recuperação para um instante preciso, mas aumentam a
complexidade de retenção, recuperação e validação antes de existir carga ou
volume que justifique essa operação. Fica como evolução obrigatoriamente
avaliada quando o volume, a criticidade ou o RPO exigirem.

### C. Implementar IAM e Chat Store antes da recuperação

Anteciparia funcionalidade, porém aumentaria o conjunto de dados sem um restore
ensaiado. Foi rejeitada pela ordem de risco.

## 4. Fronteiras do lote

### Incluído

- imagem/container operacional reproduzível para backup e restore;
- papel PostgreSQL dedicado a backup;
- dump lógico customizado, checksum SHA-256 e snapshot Restic criptografado;
- política de retenção;
- relatório operacional sanitizado e verificável por máquina;
- restore em PostgreSQL isolado no Docker Desktop;
- testes de sucesso e falha do ciclo de recuperação;
- runbook de desenvolvimento e runbook de produção para o operador;
- overlay de revisão reproduzível para o ledger;
- aprovação seletiva e relatório de IAM/Chat;
- atualização de PRD, roadmap, critérios e registro de evolução.

### Não incluído

- deploy ou alteração direta na VPS;
- autenticação, emissão de cookies ou gerenciamento de sessões;
- schema definitivo do Chat Store;
- migração de dados reais do Supabase;
- PITR, réplica ou alta disponibilidade;
- backup de artefatos, que terá exercício conjunto em marco posterior;
- contratação ou dependência obrigatória de armazenamento externo.

## 5. Arquitetura de backup

### 5.1 Componentes

O Compose PostgreSQL ganha serviços operacionais que compartilham apenas a rede
interna necessária:

- `postgres-backup`: executa um backup único e termina;
- `postgres-restore-drill`: restaura o snapshot escolhido em uma instância
  isolada e termina;
- `postgres-observe`: emite um documento JSON sanitizado e termina;
- um PostgreSQL temporário, exclusivo do teste/drill local, nunca apontado para
  o volume de origem.

A imagem operacional será construída com versões fixadas de cliente PostgreSQL
e Restic. Ela executará como usuário não-root, com filesystem raiz somente
leitura onde praticável, sem capacidades Linux adicionais e com
`no-new-privileges`.

### 5.2 Credenciais e privilégios

Será criado `nexus_backup`, papel de login sem permissão de escrita. Ele terá:

- `CONNECT` no banco ENS;
- leitura de todos os dados necessários ao dump;
- `BYPASSRLS`, pois um backup completo não pode omitir silenciosamente dados de
  tenants;
- nenhuma permissão de criação, alteração ou execução de funções de negócio.

Essa credencial será exclusiva do job de backup. O restore usará a cadeia já
existente de bootstrap/owner em um destino vazio e isolado. Senhas serão lidas
de Docker secrets/arquivos montados e nunca serão argumentos de linha de
comando, conteúdo de imagem ou saída de log.

### 5.3 Fluxo do backup

1. Validar configuração, segredos, diretório e espaço mínimo.
2. Executar `pg_dump -Fc` para uma área temporária privada.
3. Falhar se o dump estiver vazio, incompleto ou se `pg_dump` emitir erro.
4. Calcular SHA-256 e criar manifesto sanitizado.
5. Inicializar o repositório Restic somente quando explicitamente solicitado;
   backups normais falham se o repositório não estiver preparado.
6. Criar snapshot Restic com tags estáveis do produto e tipo de backup.
7. Aplicar retenção: 48 horários, 14 diários e 8 semanais.
8. Executar verificação estrutural e amostra de dados configurável.
9. Publicar status sanitizado por substituição atômica.
10. Remover o dump temporário tanto em sucesso quanto em falha.

Agendamento de produção será horário. A automação poderá permanecer dentro do
Compose ou ser acionada por timer do host, mas o comando unitário será o mesmo e
idempotente. A escolha operacional não altera o formato do backup.

### 5.4 Armazenamento e ameaça coberta

O repositório Restic será um bind mount configurável, fora do volume de dados do
PostgreSQL e fora do checkout Git. Em desenvolvimento, testes usam diretório
temporário. Em produção, o padrão documental será um caminho dedicado sob a
árvore operacional da aplicação, preferencialmente em disco/mount separado.

Um backup no mesmo host protege contra corrupção lógica, erro de aplicação e
perda do volume do banco quando o repositório sobrevive. Ele não protege contra
perda completa da VPS. Uma cópia off-host controlada pelo operador será evolução
de resiliência, não dependência deste lote.

### 5.5 Retenção e integridade

- 48 snapshots horários;
- 14 snapshots diários;
- 8 snapshots semanais;
- `restic check` após backup;
- leitura amostral após backup, com percentual configurável;
- `restic check --read-data` integral semanal;
- restore drill mensal em produção;
- senha/chave do repositório guardada separadamente do repositório; sua perda
  torna os dados irrecuperáveis.

## 6. Restore drill e objetivos de recuperação

O restore nunca sobrescreve o volume de origem. O fluxo cria um destino vazio a
partir de `template0`, executa bootstrap, recupera o dump selecionado, valida e
somente então declara sucesso.

Validações mínimas:

- checksum do artefato restaurado;
- `pg_restore --list` legível;
- bootstrap e migrations coerentes;
- relações críticas presentes;
- contagens esperadas do conjunto sentinela;
- isolamento por tenant preservado;
- papel da aplicação continua não-owner;
- duração total registrada.

O RPO de 1 hora é atendido operacionalmente apenas quando o último job horário
terminou com sucesso e seu repositório permanece acessível. O RTO de 2 horas é
um objetivo mensurável, não uma promessa abstrata: o drill registra duração e
falha se ultrapassar o limite configurado.

Em produção, o operador deve parar se houver segredo ausente, snapshot sem
integridade, espaço insuficiente, destino não vazio ou qualquer indício de que o
volume original seria alterado.

## 7. Observabilidade

O comando de observação retorna JSON em stdout e código de saída não zero quando
uma condição crítica é encontrada. O contrato conterá somente dados
operacionais agregados:

- timestamp UTC do relatório;
- disponibilidade e versão principal do PostgreSQL;
- tamanho agregado do banco;
- conexões utilizadas e limite;
- quantidade de locks em espera;
- quantidade de transações acima do limiar;
- versão mais recente do ledger de migrations;
- status e idade do último backup;
- status, idade e duração do último restore drill;
- avaliação de conformidade com RPO/RTO.

São proibidos no relatório: DSN, usuário/senha, SQL executado, texto de queries,
conteúdo de tabelas, IDs de usuários/tenants, nomes de hosts públicos e valores
de variáveis secretas.

O lote não instala Prometheus/Grafana nem envia telemetria a terceiros. O JSON é
um contrato local que poderá ser coletado por uma solução posterior.

## 8. Revisão seletiva do ledger IAM/Chat

O inventário atual contém 199 decisões propostas:

- IAM: 48 objetos ligados a `profiles` e `user_chat_integrations`;
- Chat: 151 objetos em cinco relações de persistência e índices associados.

### 8.1 Semântica de revisão

`review_status=approved` significa que a decisão de destino foi aprovada por um
humano. Não significa que o schema, código ou migração de dados já estejam
implementados. O relatório mostrará separadamente decisão e estado de entrega.

### 8.2 Overlay reproduzível

As decisões humanas serão mantidas em arquivo pequeno, revisável e separado do
inventário gerado. A ferramenta aplicará o overlay por `object_id` e validará:

- o objeto existe no manifesto;
- não há entradas duplicadas;
- ação, destino, motivo e status pertencem aos vocabulários permitidos;
- toda aprovação tem destino concreto ou justificativa explícita de remoção;
- nenhuma regra curinga aprova objetos novos silenciosamente;
- o relatório gerado corresponde exatamente ao overlay versionado.

### 8.3 Classes de decisão

1. **Estruturas com destino claro:** podem ser aprovadas para transformação,
   com destino canônico IAM ou Chat Store.
2. **Grants Supabase:** passam para `remove`; `anon`, `authenticated` e
   `service_role` não existem na arquitetura nova.
3. **Policies:** permanecem `transform` somente quando seu substituto é descrito
   como autorização da App API e/ou RLS defensiva; ausência de mapeamento mantém
   `proposed`.
4. **Triggers entre domínios:** permanecem `proposed` até existir contrato de
   evento ou caso de uso na aplicação.
5. **Integrações do usuário:** configuração não secreta pode ser aprovada;
   credenciais, tokens, endpoints privados e material equivalente permanecem
   pendentes para o desenho de secrets/configuração de M4.

O lote não aprovará automaticamente todos os 199 itens nem usará regras por
prefixo que possam alcançar objetos futuros.

## 9. Estratégia de testes

O desenvolvimento seguirá TDD:

1. escrever um teste de comportamento;
2. executá-lo e confirmar a falha esperada;
3. implementar o mínimo necessário;
4. executar novamente e confirmar sucesso;
5. refatorar mantendo os testes verdes.

Camadas de teste:

- contratos estáticos de Compose, Dockerfiles, secrets e ausência de exposição;
- testes unitários de manifesto, status, retenção e sanitização;
- integração Docker com dados sentinela, backup, mutação e restore isolado;
- falhas controladas: senha incorreta, repositório ausente/corrompido, banco
  indisponível e destino não vazio;
- invariantes do ledger: sem aprovação global, grants removidos, decisões
  sensíveis pendentes e relatório determinístico;
- regressão completa dos testes PostgreSQL e do ledger existentes.

## 10. Critérios de aceite

- [ ] backup horário possui comando único, reproduzível e não interativo;
- [ ] dump customizado recebe checksum antes do snapshot criptografado;
- [ ] credenciais são secrets e não aparecem em Git ou logs;
- [ ] retenção é 48 horários, 14 diários e 8 semanais;
- [ ] restore local isolado recupera e valida dados sentinela;
- [ ] restore não possui caminho que aponte para o volume de origem;
- [ ] falhas produzem código não zero e status sanitizado;
- [ ] observabilidade calcula conformidade de RPO 1h e RTO 2h;
- [ ] relatório não contém SQL, DSN, credenciais ou dados pessoais;
- [ ] decisões IAM/Chat são explícitas e aprovadas seletivamente;
- [ ] grants Supabase não são reproduzidos;
- [ ] triggers e segredos sem destino continuam pendentes;
- [ ] runbooks de dev e produção contêm impacto, resultado esperado, condição de
      parada e rollback;
- [ ] roadmap e registro de evolução refletem resultado verificado;
- [ ] nenhum deploy ou acesso administrativo à VPS é executado pelo agente.

## 11. Evoluções posteriores

- schema e implementação de Auth/sessões e App API/BFF em M4;
- schema do Chat Store e migração de dados aprovados;
- backup conjunto PostgreSQL + Artifact Server;
- cópia off-host operada pelo responsável;
- adoção de pgBackRest/base backup + WAL quando escala/RPO justificarem;
- dashboards e alertas sobre o contrato JSON local.
