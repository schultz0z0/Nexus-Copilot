# Segredos locais do PostgreSQL

Este diretório é ignorado por padrão. Para testes manuais locais, o operador cria
fora do Git estes três arquivos, cada um com uma senha diferente e uma única linha:

- `postgres_bootstrap_password`;
- `postgres_migrator_password`;
- `postgres_app_password`.

Não reutilize esses valores na VPS e não copie seu conteúdo para documentação,
logs, commits ou conversas. O runbook do M3 fornecerá comandos que geram os
arquivos sem imprimir a senha.

