import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const root = process.cwd()

const shouldIgnore = (p) => {
  const normalized = p.split(path.sep).join('/')
  if (normalized.includes('/node_modules/')) return true
  if (normalized.includes('/dist/')) return true
  if (normalized.includes('/.git/')) return true
  if (normalized.includes('/.supabase/')) return true
  if (normalized.endsWith('/package-lock.json')) return true
  if (normalized.endsWith('/pnpm-lock.yaml')) return true
  if (normalized.endsWith('/yarn.lock')) return true
  if (normalized.endsWith('/bun.lockb')) return true
  if (normalized.endsWith('/.env')) return true
  if (normalized.endsWith('/.env.local')) return true
  if (normalized.endsWith('/.env.production')) return true
  if (normalized.endsWith('/.env.development')) return true
  return false
}

const listFiles = (dir) => {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (shouldIgnore(full)) continue
    if (e.isDirectory()) out.push(...listFiles(full))
    else out.push(full)
  }
  return out
}

const secretRules = [
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g, scope: 'any' },
  { name: 'Supabase service role key assignment', re: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"\n]+['"]/g, scope: 'any' },
  { name: 'Service role usage in frontend', re: /SUPABASE_SERVICE_ROLE_KEY|service_role_key|SERVICE_ROLE_KEY/g, scope: 'frontend' },
]

const scan = () => {
  const files = listFiles(root)
  const hits = []

  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    const allow = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.sql', '.md', '.txt', '.yml', '.yaml'])
    if (!allow.has(ext)) continue

    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const rule of secretRules) {
      if (rule.scope === 'frontend') {
        const normalized = file.split(path.sep).join('/')
        const isFrontend = normalized.includes('/src/') || normalized.includes('/public/')
        if (!isFrontend) continue
      }

      const matches = content.match(rule.re)
      if (matches && matches.length) hits.push({ file, rule: rule.name, count: matches.length })
    }
  }

  if (hits.length) {
    console.error('Segredos/indicadores encontrados:')
    for (const h of hits) {
      console.error(`- ${h.rule}: ${h.file} (${h.count})`)
    }
    process.exit(1)
  }
}

const validateApprovalSurface = () => {
  const files = [
    'src/pages/marketing-ops/ApprovalQueuePage.tsx',
    'src/pages/marketing-ops/ApprovalDetailPage.tsx',
    'src/components/marketing-ops/ApprovalDecisionDialog.tsx',
  ]
  for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8')
    if (/chat\/ApprovalModal|executeProvider|provider\.send|externalExecution/i.test(content)) {
      console.error(`Approval surface crossed the Phase 5 execution boundary: ${file}`)
      process.exit(1)
    }
  }
}

const run = (cmd, args) => {
  const npmExecPath = cmd === 'npm' ? process.env.npm_execpath : undefined
  const tryRun = (bin, a, options) => {
    const res = spawnSync(bin, a, { stdio: 'inherit', cwd: root, ...options })
    if (res.error) return { ok: false, error: res.error }
    if (res.status !== 0) process.exit(res.status ?? 1)
    return { ok: true }
  }

  if (npmExecPath) {
    const r = tryRun(process.execPath, [npmExecPath, ...args], {})
    if (r.ok) return
  }

  const bin = process.platform === 'win32' ? `${cmd}.cmd` : cmd
  const r2 = tryRun(bin, args, {})
  if (r2.ok) return

  const r3 = tryRun(cmd, args, { shell: true })
  if (r3.ok) return
  console.error((r3.error || r2.error)?.message || 'Falha ao executar comando')
  process.exit(1)
}

scan()
validateApprovalSurface()
run('npm', ['run', 'validate:rls'])
run('npm', ['run', 'validate:rag-rls'])
run('npm', ['run', 'lint'])
run('npm', ['run', 'build'])
run('npm', ['audit', '--audit-level=high'])

console.log('Security gate OK')
