# App API: checkout restritivo e leitura pelo usuário do container

Em 2026-10-02, a publicação da release `197d694` na VPS passou pelas migrações
até `0023`, mas App API reiniciou com `EACCES` ao abrir `/app/src/server.js`.
Marketing Ops, Bridge e Artifact estavam saudáveis; Chat Web aguardava App API.

O roteiro havia definido `umask 077` na sessão administrativa antes do avanço
Git. Arquivos novos/atualizados podem chegar ao build com diretórios `0700` e
arquivos `0600`, pertencentes ao root. O Dockerfile copiava esses modos e
mudava para `USER node` sem normalizá-los. A validação do Compose e o build
não demonstravam a legibilidade do código por esse usuário.

## Correção e evidência local

O Dockerfile agora normaliza somente `package.json` e `src`: arquivos `0644`,
diretórios `0755`, mantendo proprietário root e execução como `node`.
Não altera secrets, mounts, banco, tokens, volumes ou permissões do host.

Teste de regressão com Docker, independente do modo de arquivos do Windows:

```text
python services/app-api/test/docker-permissions.py
```

O teste gera um contexto tar em memória com código root `0700/0600`, constrói
uma imagem isolada e carrega o servidor como UID 1000. Faz uma consulta real
ao health via Fastify inject, sem rede ou banco e com filesystem somente leitura.
A tag de teste é removida ao terminar, sem limpar imagens de outros projetos.

- Antes: reproduziu exatamente `EACCES ... /app/src/server.js`.
- Depois: usuário node, servidor inicializado e health 200.
- Suíte App API: 114 testes aprovados, zero falhas.

## Continuação da operação

O operador humano obtém o commit corretivo, reconstrói apenas App API e recria
App API/Chat Web com o Compose e env produtivos existentes. Migrações já estão
aplicadas; não devem ser revertidas nem reaplicadas para corrigir este problema.
Health dos cinco serviços, proxy, login e uso funcional precisam ser conferidos
na VPS antes de declarar a publicação concluída.

Para comandos de Git no host, use `umask 022` dentro do bloco específico.
Use `umask 077` somente em blocos que geram cópias privadas. Envolva comandos
com `set -euo pipefail` em um subshell para não encerrar o terminal interativo.
Cada etapa deve conter os comandos Compose completos ou definir suas funções
novamente; variáveis de uma sessão anterior não são precondições implícitas.

Em falha, preservar logs redigidos, imagens anteriores e banco; rollback de
aplicação é operado pelo humano com as tags registradas. Não tornar o container
root, remover volumes, abrir permissões de secrets ou executar chmod no repo
inteiro como contorno.
