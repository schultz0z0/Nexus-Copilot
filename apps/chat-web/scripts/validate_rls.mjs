import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  console.error('Variáveis de ambiente do Supabase ausentes')
  process.exit(1)
}

const supabaseAnon = createClient(url, anon)

const run = async () => {
  const p = await supabaseAnon.from('profiles').select('*').limit(1)
  const g = await supabaseAnon.from('generated_images').select('*').limit(1)

  const profilesBlocked = !!p.error
  const imagesBlocked = !!g.error

  if (!profilesBlocked) throw new Error('profiles permite SELECT sem erro (anon)')
  if (!imagesBlocked) throw new Error('generated_images permite SELECT sem erro (anon)')

  console.log('Validação RLS concluída com sucesso')
}

run().catch((e) => {
  console.error('Falha na validação RLS:', e.message)
  process.exit(1)
})

