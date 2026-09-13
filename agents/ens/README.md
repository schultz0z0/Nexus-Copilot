# Profile Distribution ENS

Esta pasta contém apenas comportamento distribuível do agente. Ela não contém o core Hermes nem estado de runtime.

Durante o desenvolvimento, a distribuição pode ser instalada a partir deste diretório local. Na VPS, o checkout do monorepo fornece a mesma distribuição. Credenciais devem ser configuradas no `.env` do profile instalado, nunca nesta pasta.

O arquivo `config.yaml` habilita o MCP Marketing Ops pela variável
`NEXUS_MARKETING_OPS_MCP_URL`. No stack Docker, o valor canônico é
`http://marketing-ops:8091/mcp`, acessível somente na rede interna compartilhada.
No Hermes v0.20.6, `config.yaml` é a fonte efetivamente lida pelo runtime;
`mcp.json` permanece vazio e versionado somente como parte do formato oficial
da distribuição. A URL não carrega credenciais: cada chamada usa a delegação
curta, vinculada ao run, emitida pelo Chat Bridge.
