# Marca Prometeus — ponto de entrada

Tudo relacionado à identidade visual está nesta pasta. Versão do kit digital: **1.0.0 · 26/09/2026**.

Explorações ainda não aprovadas: [dashboard alternativo gerado pelo Stitch](exploracoes/dashboard-stitch.md). Elas preservam o KV e não substituem os tokens canônicos.

Composição do dashboard revisada em 29/09/2026 e ligada aos dados persistidos em
30/09/2026: visão geral resumida, detalhes sob demanda e páginas por campanha.
O app abre no modo real; a demonstração usa `?mode=demo`. Consultar
`design-system.md`, `compositionRecipes` no JSON e `apps/chat-web/DESIGN.md`.

| Arquivo | Para que serve |
| --- | --- |
| [manual-da-marca.html](manual-da-marca.html) | Manual visual navegável, responsivo, com componentes, estados e exemplos interativos locais. Abrir no navegador. |
| [manual-da-marca.pdf](manual-da-marca.pdf) | Edição estática para leitura e compartilhamento, exportada do HTML com composição de impressão. Interações disponíveis no HTML. |
| [design-system.md](design-system.md) | Regras completas para pessoas e agentes IA: marca, composição, comportamento, acessibilidade e processo. |
| [design-system.json](design-system.json) | 59 tokens do CSS, aliases, cores resolvidas, 17 componentes, assets e regras em formato legível por máquina. |
| [assets/](assets/) | Cópias fiéis das logos e do mascote, tokens do manual e capturas de referência com dados de demonstração. |
| `Manual da Marca Prometeus (1).pdf` | Manual original. **Ignorar a primeira página**, que identifica a agência criadora. |
| PNGs originais desta pasta | Artes fornecidas pelo responsável; preservar sem sobrescrever. |

Para Codex, Claude, Antigravity ou outra IA, fornecer o Markdown e o JSON junto do objetivo. Para uma tarefa visual, disponibilizar também os assets e o HTML. O `AGENTS.md` da raiz aponta para este kit. A leitura automática de arquivos depende do agente e de sua configuração; quando necessário, citar o caminho explicitamente no pedido.

O HTML usa fontes online com fallback local e mantém os exemplos funcionais sem APIs. Para compartilhar a versão navegável, levar o HTML e a pasta `assets/` juntos. Os controles ilustram a marca e não executam ações do produto. É possível usar “Imprimir / salvar PDF” no próprio manual.

**Fonte em execução:** `apps/chat-web/src/index.css`; adapter: `apps/chat-web/tailwind.config.ts`. O JSON e `assets/tokens.css` são snapshots documentais, não um segundo tema ativo. Atualizá-los com o código ao mudar tokens. `apps/chat-web/DESIGN.md` continua sendo o contrato de interação do aplicativo.
