# M7: Aposentadoria de Infraestrutura Legada

Este documento decreta as diretrizes para a remoção completa do Supabase e quaisquer resíduos da arquitetura legada, após a homologação de todas as capacidades nativas auto-hospedadas pela plataforma ENS.

## Escopo de Descomissionamento

Os seguintes componentes e sistemas foram oficialmente superados a partir do Marco M6 e estão livres para serem destruídos fisicamente pelo proprietário do projeto sem prejuízo de operação:

1.  **Projeto Supabase Hosted (`supabase.com`):**
    *   Banco de dados e todos os seus schemas históricos.
    *   Auth, Storage (buckets de anexos) e Edge Functions.
    *   Chaves de API (anon e service role).
2.  **Graph MCP e Neo4j:**
    *   Componentes descontinuados conforme CA-003. Quaisquer servidores ou chaves alocadas unicamente para eles podem ser desligadas.
3.  **Containers Obsoletos na VPS:**
    *   Serviços antigos de Bridge que consumiam o Supabase.

## Procedimento de Retirada

Execute as seguintes ações para higienizar o ambiente de produção e prevenir regressões fantasmas e vazamentos.

1.  **Limpeza de Variáveis de Ambiente:**
    *   Execute o script `scripts/retire-legacy.sh` na VPS para purgar as chaves `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, etc.
2.  **Exclusão na Nuvem:**
    *   Logue no console do Supabase e clique em `Settings > General > Delete project`. Confirme a exclusão do projeto.
3.  **Remoção de Código Legado (Comprovada em 2026-09-18):**
    *   O repositório já não contém chamadas aos SDKs obsoletos. Nenhuma nova pull request deve ser aceita se reintroduzir essas dependências sem justificativa clara.
