# Relatório de Auditoria Funcional e de UX (Sem Hermes)

**Data da Auditoria:** 18 de Setembro de 2026  
**Ambiente:** Produção VPS (`https://app.solucoes-nexus.tech`)  
**Usuário Auditado:** `raphaeloliveira.atn@ens.edu.br` (Perfil: Gestor / Manager)  
**Escopo:** Módulo Marketing Ops (Campanhas, Produção, Aprovações) e Administração (sem interação com o Chat do Hermes).

---

## 1. Resumo Executivo

A auditoria manual navegou e testou todas as telas do sistema fora do chat do Hermes. As funcionalidades nucleares (criação e carregamento de campanhas, listagem e detalhamento de produção, fila de aprovações e visualização de hashes) estão funcionando no backend e na VPS.

Foram identificados **1 bug de UX/estado** (o problema reportado de "cancelar e salvar"), **1 bug visual de caracteres de escape**, e **4 melhorias de usabilidade e i18n**.

---

## 2. Diagnóstico Detalhado do Erro "Cancelei e Salvei"

### Comportamento Observado
1. O usuário abre o modal de **"Detalhes do item"** na tela de Produção.
2. O usuário clica no botão destrutivo **"Cancelar item"** na seção "Alterar status".
3. A transição para `cancelled` é executada com sucesso imediato no banco de dados.
4. O modal **permanece aberto** com todos os campos do formulário (Título, Canal, Prazo, etc.) ainda editáveis e o botão **"Salvar alterações"** permanece habilitado.
5. Ao clicar em **"Salvar alterações"**, o formulário envia uma requisição `PUT/PATCH` com os campos do item.
6. O backend rejeita a alteração com HTTP 409:
   ```json
   {
     "error": "item_terminal",
     "message": "Terminal production item is read-only"
   }
   ```
7. O frontend captura o erro 409 e exibe um alerta vermelho genérico:
   > **O item foi atualizado em outra sessão**  
   > *Terminal production item is read-only*  
   > *Correlação: 4c2f2c42-84c7-46f3-afe3-48c93085a656*  
   > `[ Recarregar dados ]`
8. Quando o usuário fecha o modal, ele percebe que o item já havia sido cancelado no primeiro clique.

### Causa Raiz no Código
1. **Frontend (`ProductionItemDialog.tsx`):**
   * O botão "Cancelar item" dispara `transitionMutation.mutate('cancelled')`, que altera o status do item imediatamente no banco.
   * Quando o item passa para `cancelled` (ou `completed`), ele se torna um **item terminal**.
   * Porém, a propriedade `disabled` dos inputs e a visibilidade do botão `"Salvar alterações"` não verificam se o status é terminal (`isTerminal = status === 'completed' || status === 'cancelled'`).
   * Como o botão `"Salvar alterações"` continua visível, o usuário clica achando que precisa salvar a tela.
2. **Mensagem Enganosa de 409 (`ProductionItemDialog.tsx`):**
   * Qualquer HTTP 409 está associado ao título fixo *"O item foi atualizado em outra sessão"*. No entanto, o erro 409 pode ser tanto `version_conflict` (conflito de versão real) quanto `item_terminal` (item somente-leitura). O texto gera a falsa impressão de concorrência com outro usuário.

### Proposta de Correção Recomendada
1. No `ProductionItemDialog.tsx`, calcular `const isTerminal = itemQuery.data?.status === 'completed' || itemQuery.data?.status === 'cancelled'`.
2. Se `isTerminal === true`:
   * Desabilitar todos os campos de edição do formulário (`disabled={isTerminal}`).
   * Ocultar o botão `"Salvar alterações"` ou exibi-lo como desabilitado, mantendo apenas o botão `"Fechar"`.
3. Ao clicar em "Cancelar item" ou "Concluir item", fechar automaticamente o modal ou recarregar os dados já em modo leitura (`readOnly`).
4. Diferenciar a mensagem de erro 409: exibir *"O item foi atualizado em outra sessão"* apenas quando o erro for `version_conflict`.

---

## 3. Matriz de Achados da Auditoria

| ID | Tela / Módulo | Severidade | Tipo | Descrição |
|---|---|---|---|---|
| **ACH-01** | Produção (`/items/[id]`) | 🟡 Média | Bug de UX | Modal permite tentar salvar alterações em itens já cancelados/concluídos, gerando erro 409 enganoso. |
| **ACH-02** | Produção (Tabela) | 🟢 Baixa | Bug Visual | Títulos com acentos exibem códigos de escape brutos (ex: `Valida\u00e7\u00e3o` em vez de `Validação`). |
| **ACH-03** | Produção (Tabela) | 🔵 Usabilidade | Melhoria | Coluna **Responsável** exibe o UUID do usuário (`3fbbd214-...`) em vez do nome da pessoa. |
| **ACH-04** | Filtros (Geral) | 🔵 Usabilidade | Melhoria | Campos de filtro por Responsável e Solicitante exigem digitar o UUID em vez de oferecer um Select/Combobox com os nomes dos usuários. |
| **ACH-05** | Detalhes de Aprovação | 🟢 Baixa | i18n | Badges no cabeçalho aparecem em inglês (`approved`, `operational`, `Risco low`), divergindo da listagem que está em português. |
| **ACH-06** | Gestão de Usuários | ⚪ Informativo | Controle de Acesso | Acesso a `/admin/users` redireciona para `/` porque a conta logada tem perfil `manager`. Apenas `admin` tem acesso à tela, o que está conforme o desenho de segurança. |

---

## 4. Detalhamento por Tela

### 4.1. Tela de Campanhas (`/marketing-ops/campaigns`)
* **Status:** ✅ Operacional.
* **Comportamento:**
  * Listagem carrega campanhas existentes com status, canal, briefing e datas.
  * O botão **"Nova campanha"** abre modal responsivo com validações de título obrigatório.
  * O fechamento e cancelamento do modal limpa o estado sem erros.
* **Pontos de Atenção:**
  * O filtro de busca por responsável solicita "ID do usuário" (UUID). Seria mais amigável listar os membros do tenant em um menu suspenso.

### 4.2. Tela de Produção (`/marketing-ops/production`)
* **Status:** ⚠️ Operacional com fricção de UX (ACH-01 e ACH-02).
* **Comportamento:**
  * Alternância entre abas Lista, Semana e Mês carrega as datas corretamente no fuso `America/Sao_Paulo`.
  * Criação de novo item valida obrigatoriedade de título e vínculo à campanha.
  * Itens em rascunho mostram alertas inteligentes de campos faltantes antes de avançar para "Pronto".
* **Pontos de Atenção:**
  * Resolver a desativação do botão "Salvar alterações" após cancelar o item (ACH-01).
  * Corrigir a decodificação de escape unicode nos títulos da listagem (ACH-02).
  * Exibir o nome do usuário na coluna "Responsável" (ACH-03).

### 4.3. Fila e Detalhe de Aprovações (`/marketing-ops/approvals`)
* **Status:** ✅ Operacional.
* **Comportamento:**
  * Fila exibe as solicitações operacionais pendentes, aprovadas e rejeitadas.
  * Ao abrir uma aprovação, a tela exibe o hash SHA-256 do pacote congelado, nível de risco e justificativa.
  * Separação de funções funciona perfeitamente: o solicitante não pode autoaprovar suas próprias requisições.
* **Pontos de Atenção:**
  * Harmonizar os badges para português (`Aprovada`, `Risco baixo`, etc.) na tela interna de detalhe (ACH-05).

---

## 5. Próximos Passos Sugeridos

Conforme solicitado, **nenhum código foi alterado nesta etapa de auditoria**. 

Se você aprovar, podemos abrir uma rodada pontual de melhorias focada especificamente nos pontos de usabilidade catalogados acima, começando pela trava de edição em itens terminais (ACH-01) e pela limpeza de exibição dos nomes e caracteres (ACH-02 e ACH-03).
