# Profile Distribution ENS

Esta pasta contém apenas comportamento distribuível do agente. Ela não contém o core Hermes nem estado de runtime.

Durante o desenvolvimento, a distribuição pode ser instalada a partir deste diretório local. Na VPS, o checkout do monorepo fornece a mesma distribuição. Credenciais devem ser configuradas no `.env` do profile instalado, nunca nesta pasta.

O arquivo `config.yaml` habilita apenas o MCP Marketing Ops neste primeiro corte. RAG e Picture serão adicionados quando seus serviços forem migrados e testados contra o Hermes oficial.
