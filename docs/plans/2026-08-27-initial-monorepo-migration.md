# Initial ENS Monorepo Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar a baseline do novo monorepo ENS com quatro componentes preservados e uma Profile Distribution compatível com o Hermes oficial.

**Architecture:** Copiar uma lista explícita de código e configuração a partir do repositório histórico, omitindo plataformas e runtimes descartados. Manter o core Hermes externo e concentrar extensões ENS em `agents/ens`, com estado mutável separado por ambiente.

**Tech Stack:** React/Vite/TypeScript, Node.js 22, Express, MCP SDK, PostgreSQL client, Hermes Agent Profile Distributions, Git.

---

### Task 1: Criar a estrutura e registrar as decisões

**Files:**
- Create: `README.md`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `AGENTS.md`
- Create: `docs/plans/2026-08-27-initial-monorepo-migration-design.md`

**Step 1:** Inicializar o repositório Git com branch `main`.

**Step 2:** Criar diretórios para apps, serviços, agente, banco, infraestrutura e documentação.

**Step 3:** Registrar inclusões, exclusões e fronteiras obrigatórias.

**Step 4:** Executar `git status --short` e confirmar que apenas a baseline nova aparece.

### Task 2: Copiar o frontend por allowlist

**Files:**
- Create: `apps/chat-web/src/**`
- Create: `apps/chat-web/public/**`
- Create: `apps/chat-web/e2e/**`
- Create: manifests e configurações de build/teste do frontend

**Step 1:** Copiar somente arquivos rastreados dos diretórios de código e teste aprovados.

**Step 2:** Copiar manifests, lockfile, Dockerfile e configurações necessárias.

**Step 3:** Confirmar que `apps/chat-web/supabase` não existe no destino.

**Step 4:** Confirmar que `node_modules`, `dist` e `*.tsbuildinfo` não foram copiados.

### Task 3: Copiar os três serviços

**Files:**
- Create: `services/marketing-ops/**`
- Create: `services/chat-bridge/**`
- Create: `services/artifact-server/**`

**Step 1:** Copiar apenas arquivos rastreados de cada serviço.

**Step 2:** Excluir builds, dependências instaladas, caches e arquivos de ambiente.

**Step 3:** Comparar a quantidade e os hashes dos arquivos copiados com a origem selecionada.

### Task 4: Construir a Profile Distribution ENS

**Files:**
- Create: `agents/ens/distribution.yaml`
- Create: `agents/ens/SOUL.md`
- Create: `agents/ens/config.yaml`
- Create: `agents/ens/mcp.json`
- Create: `agents/ens/skills/**`

**Step 1:** Copiar o SOUL atual após procurar padrões de credenciais.

**Step 2:** Copiar as skills `marketing-ops-operator`, `picture-hermes` e as quatro skills Nexus selecionadas.

**Step 3:** Configurar somente o MCP Marketing Ops como ativo e usar variável de ambiente para a URL.

**Step 4:** Validar o YAML e o JSON da distribuição.

### Task 5: Instalar e verificar

**Files:**
- Create: dependências locais ignoradas pelo Git

**Step 1:** Executar `npm ci` nos quatro pacotes.

**Step 2:** Executar `npm run typecheck` na raiz.

**Step 3:** Executar `npm test` na raiz.

**Step 4:** Executar `npm run build` na raiz.

**Step 5:** Buscar arquivos proibidos e possíveis segredos com `rg` e `git status`.

**Step 6:** Registrar quaisquer falhas herdadas sem mascará-las.

**Step 7:** Criar o commit inicial somente após a verificação.
