# Desenho — Ledger DDL do legado Supabase

**Data:** 2026-09-10  
**Estado:** Aceito  
**Marcos:** M3 — Fundação PostgreSQL; preparação de M4–M6  
**Requisitos:** RF-007, RF-009, RF-015, RNF-005, RNF-011, CA-010

## Contexto

O inventário inicial identificou 51 tabelas, quatro Edge Functions e grupos de
RPCs, policies, triggers, extensões, buckets e jobs. A fonte histórica, porém,
possui 24 migrations ativas e centenas de operações SQL. Uma lista escrita à
mão não prova que cada objeto foi considerado, não detecta drift e não pode ser
regenerada com segurança.

Este lote cria um ledger automatizado e portátil. Ele não copia migrations
Supabase para `infra/postgres/migrations`, não executa SQL legado e não exige um
Supabase local. O resultado é metadado sanitizado, versionado e verificável que
orientará as migrations novas por domínio.

Também é obrigatório preservar as decisões de remoção já tomadas. Graph MCP,
Neo4j, RAG MCP histórico, o fork Hermes e componentes internos do Supabase não
podem reaparecer por terem objetos encontrados no legado.

## Objetivos

1. Classificar todo statement relevante das migrations ativas sem silêncio.
2. Identificar objetos lógicos e seu histórico de criação, alteração e remoção.
3. Registrar destino, ação, marco e estado de revisão para cada objeto.
4. Detectar mudanças na fonte por SHA-256.
5. Gerar um relatório Markdown determinístico para revisão humana.
6. Permitir validação em qualquer checkout mesmo sem o repositório histórico.
7. Manter SQL bruto, dados, credenciais e caminhos absolutos fora do Git.

## Fora de escopo

- executar ou validar semanticamente as migrations em Supabase;
- gerar automaticamente a baseline PostgreSQL nova;
- transportar dados;
- decidir detalhes ainda pendentes de Auth, RAG, object storage ou jobs;
- inventariar como ativos todos os arquivos de `legacy_migrations` e
  `ignored_migrations`;
- instalar o ledger ou suas dependências em imagens de produção;
- acessar ou alterar a VPS.

## Abordagens consideradas

### A. Parser AST PostgreSQL offline com exceções explícitas — escolhida

Usa `pglast` fixado em versão e hash para obter a AST real de cada statement. Um
classificador próprio converte nós relevantes em operações e objetos canônicos.
DML que representa recursos externos — por exemplo, inserts em
`storage.buckets` — recebe detectores pequenos e testados. Qualquer statement não
classificado entra como erro de cobertura, nunca como sucesso parcial.

Vantagens: boa fidelidade sintática, sem banco, sem credenciais, executável em
Windows/Linux e capaz de distinguir SQL dentro de strings ou corpos
dollar-quoted. A dependência é exclusivamente de desenvolvimento e não entra no
runtime ENS.

### B. Regex pura

Reduz dependências, porém é frágil com identificadores quoted, funções
sobrecarregadas, corpos PL/pgSQL, comandos multilinha e alterações encadeadas.
Foi rejeitada como fonte de verdade. Regex pode existir apenas em detectores
restritos após a AST separar corretamente os statements.

### C. Aplicar o legado em um Supabase descartável e introspectar catálogos

Poderia aproximar o estado final, mas exigiria reconstruir roles, schemas,
extensões e serviços que a arquitetura decidiu retirar. Também perderia a
proveniência de objetos posteriormente removidos. Foi rejeitada para este lote.

## Arquitetura do utilitário

O utilitário ficará em `tools/supabase-ledger` e terá três comandos:

```text
scan    fonte histórica -> manifesto de origem + candidatos de decisão
verify  manifesto + política de fontes + decisões -> gate de cobertura
render  manifesto + decisões -> relatório Markdown
```

Python 3.11 será usado com dependências fixadas por versão e hashes. Um container
de desenvolvimento com imagem fixada permitirá execução idêntica onde só houver
Docker. O scanner não terá acesso de rede em runtime e receberá o diretório de
origem por argumento/mount read-only.

O pipeline é:

```text
política de fontes
        |
        v
descoberta + SHA-256 -----> registro de fontes incluídas/excluídas
        |
        v
separação/AST PostgreSQL -> operações classificadas -> objetos canônicos
        |                                               |
        +--> detectores de bucket/job/Edge Function ----+
                                                        |
                                                        v
                                  manifesto sanitizado + decisões revisáveis
                                                        |
                                        verify ----------+----> Markdown
```

## Política de fontes

Um arquivo versionado declara globs, tipo e tratamento. O scanner não decide
implicitamente o que é ativo.

### Incluídas e analisadas por objeto

- `apps/chat-web/supabase/migrations/*.sql`: 24 migrations ativas;
- `apps/chat-web/supabase/functions/*`: quatro Edge Functions históricas;
- referências de bucket/job presentes nas migrations ativas.

### Registradas como históricas, sem promover objetos a ativos

- `apps/chat-web/supabase/legacy_migrations/**`;
- `apps/chat-web/supabase/ignored_migrations/**`.

Esses arquivos recebem contagem e checksum de conjunto para detectar troca de
fonte, mas não geram automaticamente objetos a migrar. Um objeto necessário deve
estar na baseline ativa ou receber uma exceção de fonte revisada.

### Registradas como componentes retirados

- `services/rag-mcp/supabase/migrations/**`;
- migration Neo4j em `services/hermes-runtime/migrations/**`;
- qualquer diretório histórico de Graph MCP ou fork Hermes descoberto pela
  política.

Essas fontes recebem decisão explícita `removed_component`. Responsabilidades de
negócio ainda úteis podem ser transformadas para PostgreSQL/serviço próprio, mas
o serviço retirado não é restaurado.

O caminho local do repositório histórico nunca entra no manifesto. Somente
caminhos relativos à raiz fornecida são persistidos.

## Artefatos versionados

### `source-policy.json`

Define versão do formato, globs incluídos, globs históricos, componentes
retirados e quantidade esperada de fontes críticas. Alteração exige revisão.

### `source-manifest.json`

Gerado deterministicamente. Contém:

- versão do formato e versão do parser;
- SHA-256 e tamanho de cada fonte;
- operações com arquivo, posição, tipo e identidade do alvo;
- objetos lógicos consolidados e suas operações de proveniência;
- statements não classificados, se existirem;
- Edge Functions, buckets, jobs e componentes retirados;
- resumo por tipo/schema/fonte.

Não contém SQL bruto, corpos de função, dados de inserts, comentários livres,
credenciais ou caminhos absolutos.

### `object-decisions.json`

É o overlay revisável. Cada objeto possui:

- `object_id` canônico;
- `action`: `migrate`, `transform`, `remove` ou `pending`;
- `target_component` e `target_name`, quando conhecidos;
- `milestone`: M3, M4, M5 ou M6;
- `review_status`: `proposed` ou `approved`;
- justificativa curta escolhida de códigos controlados;
- exceção documentada quando a resolução veio de regra de grupo.

O gerador pode sugerir uma decisão, mas nunca marca `approved` sozinho.

### `supabase-object-ledger.md`

Relatório gerado com totais, cobertura, drift, objetos pendentes e tabelas por
domínio. Ele é uma visualização; JSON é a fonte verificável.

## Identidade dos objetos

O `object_id` é estável, minúsculo onde PostgreSQL faria folding e preserva
identificadores quoted. Formatos principais:

```text
schema:<schema>
extension:<name>
type:<schema>.<name>
table:<schema>.<name>
column:<schema>.<table>.<column>
constraint:<schema>.<table>.<name>
index:<schema>.<name>
function:<schema>.<name>(<tipos-de-argumento>)
trigger:<schema>.<table>.<name>
policy:<schema>.<table>.<name>
grant:<objeto>:<papel>:<privilégios>
bucket:<id>
edge_function:<name>
job:<mecanismo>:<nome>
```

Funções usam assinatura para não colidir overloads. Policies e triggers incluem
a tabela porque seus nomes não são globais. `ALTER`, `DROP`, ownership, RLS e
grants viram operações ligadas ao objeto; não criam falsos objetos duplicados.

## Classificação e cobertura

O scanner reconhece ao menos:

- schemas, extensions, types/enums, sequences, tables e views;
- colunas, constraints e índices;
- functions/procedures e suas assinaturas;
- triggers e policies;
- `ENABLE/FORCE/DISABLE ROW LEVEL SECURITY`;
- grants, revokes, ownership e default privileges;
- create/alter/drop/comment relevantes;
- buckets de Storage, Edge Functions e jobs/schedulers encontrados.

Cada statement recebe uma destas classes:

- `object_operation`: contribui para um objeto;
- `data_operation`: DML relevante para recurso, seed ou migração de dados;
- `control_operation`: transação/configuração sem objeto migrável;
- `historical_only`: fonte excluída por política;
- `unclassified`: falha do gate.

O gate exige `unclassified = 0`. Operações de dados que não possam ser
sanitizadas guardam apenas tipo, alvo, posição e hash do statement.

## Regras iniciais de destino

As regras geram propostas explícitas por objeto, sem aprovação automática:

| Origem | Proposta |
| --- | --- |
| `auth.*`, roles/claims internos Supabase | `remove` ou `transform` para IAM/App API em M4 |
| `storage.*` e buckets | `transform` para Artifact Server/object storage próprio em M5 |
| `realtime.*` | `remove`; criar SSE/WebSocket somente para fluxo aprovado em M5 |
| `vault.*`/`supabase_vault` | `remove`; secrets de runtime |
| `public.profiles` e integrações de usuário | `transform` para IAM/configuração em M4 |
| chat/sessões | `transform` para App API/RunStore em M4 |
| `marketing_ops*` | `transform` para schemas próprios, sem `auth.uid()`, em M3–M5 |
| imagem/Picture | `transform` para jobs próprios + Artifact Server em M5 |
| `graph_*`, Graph MCP e Neo4j | `remove` como tecnologia; relação útil exige modelo relacional aprovado |
| RAG MCP/tabelas RAG | `pending` até ADR; o serviço removido não retorna |
| extensões PostgreSQL genéricas | `pending` ou `migrate` somente com necessidade e imagem restaurável |

Uma regra pode preencher milhares de linhas, mas o relatório continua mostrando
a decisão resultante de cada objeto. Aprovar uma regra significa aprovar todos os
objetos listados sob ela; overrides permanecem individuais e auditáveis.

## Falhas e comportamento seguro

`scan` falha quando:

- um arquivo esperado desaparece ou um caminho escapa da raiz;
- a migration não pode ser parseada integralmente;
- um statement não recebe classificação;
- há identidade ambígua ou colisão de objetos;
- qualquer campo sanitizado contém caminho absoluto ou indício de segredo.

`verify` falha quando:

- manifest/policy/decisions usam versão incompatível;
- hashes ou contagens críticas divergem;
- uma operação referencia objeto inexistente;
- uma decisão está duplicada ou órfã;
- há objeto sem decisão explícita;
- componente retirado aparece com ação `migrate`;
- objeto `approved` continua com ação `pending`;
- o Markdown gerado diverge do arquivo versionado.

O scanner não sobrescreve uma decisão humana. Drift gera arquivo candidato e
erro; a atualização só ocorre após revisão do diff.

## Segurança e licenciamento

- fonte histórica é montada read-only;
- nenhuma URL de banco, chave Supabase ou `.env` é necessária;
- SQL e corpos PL/pgSQL são processados em memória e descartados;
- mensagens de erro mostram caminho relativo e posição, não o statement;
- o container do scanner roda sem privilégios e sem acesso à rede no comando de
  análise;
- `pglast` é dependência GPL de ferramenta de desenvolvimento isolada e não é
  linkado, copiado ou distribuído nas imagens/runtime do produto;
- lockfile e hashes de pacotes são versionados e passam por revisão de licença.

## Estratégia de testes

O desenvolvimento seguirá RED–GREEN–REFACTOR.

### Testes unitários

- normalização de identificadores quoted/unquoted;
- assinaturas de funções sobrecarregadas;
- consolidação de create/alter/drop;
- policies/triggers com mesmo nome em tabelas diferentes;
- grants, ownership e estados de RLS;
- sanitização e detecção de caminho absoluto/segredo;
- regras de componentes retirados e overrides.

### Fixtures SQL

- corpos dollar-quoted contendo texto parecido com DDL;
- statements multilinha e identificadores com espaços;
- enums, constraints, indexes e views;
- `SECURITY DEFINER`, grants/revokes e RLS;
- inserts em `storage.buckets` sem persistir dados livres;
- statement propositalmente desconhecido para provar falha fechada.

### Testes de integração

- varrer uma árvore histórica sintética e comparar golden JSON;
- repetir scan e provar bytes idênticos;
- alterar uma fonte e provar drift por SHA-256;
- executar `verify` sem a árvore histórica usando apenas artefatos versionados;
- varrer as 24 migrations reais neste computador e exigir zero statement
  silenciosamente ignorado;
- renderizar Markdown e exigir árvore Git limpa.

### Regressão do monorepo

- `npm run test:postgres`;
- testes do ledger em Python e no container;
- `git diff --check` e revisão de secrets;
- nenhum teste ou Compose novo deve depender de Supabase em runtime.

## Critérios de aceite do lote

1. O scanner processa as 24 migrations ativas e quatro Edge Functions.
2. Todo statement recebe classificação; `unclassified` é zero.
3. Todo objeto possui linha de decisão, ainda que `pending` e não aprovada.
4. Componentes retirados aparecem no manifesto e não podem receber `migrate`.
5. Manifesto não contém SQL bruto, dados, segredos ou caminhos absolutos.
6. Scan repetido é byte a byte determinístico.
7. Drift de fonte, decisão órfã e objeto novo fazem o gate falhar.
8. Verificação funciona em outro checkout sem o repositório histórico.
9. Relatório Markdown coincide com os JSON versionados.
10. Testes locais e em Docker passam sem acessar a VPS.

## Estado após este lote

Este lote conclui a cobertura automática do inventário, não a aprovação de todas
as decisões de migração. Objetos `pending` continuam bloqueando o critério final
de M3 e serão resolvidos nos ADRs/fatias de Auth, domínios, RAG, storage e jobs.
O ledger passa a ser o gate que impede regressão ou reintrodução silenciosa de
serviços retirados.
