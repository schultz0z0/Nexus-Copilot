
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error('Missing env vars');
  process.exit(1);
}

// Client Admin para criar usuário
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
// Client Anon para logar
const supabaseAnon = createClient(supabaseUrl, anonKey);

async function getAuthToken() {
  const email = 'qa_tester@nexus.ai';
  const password = 'password123';

  console.log('Tentando login...');
  const { data: loginData, error: loginError } = await supabaseAnon.auth.signInWithPassword({
    email,
    password
  });

  if (!loginError && loginData.session) {
    console.log('LOGIN SUCESSO!');
    console.log('SESSION_JSON:', JSON.stringify(loginData.session));
    return;
  }

  console.log('Login falhou:', loginError?.message);
  console.log('Tentando criar usuário...');

  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'QA Tester' }
  });

  if (createError) {
    console.error('Erro ao criar usuário:', createError);
  } else {
    console.log('Usuário criado. Tentando login novamente...');
    const { data: retryLogin, error: retryError } = await supabaseAnon.auth.signInWithPassword({
      email,
      password
    });
    if (retryLogin.session) {
      console.log('LOGIN SUCESSO APÓS CRIAÇÃO!');
      console.log('ACCESS_TOKEN:', retryLogin.session.access_token);
    } else {
      console.error('Falha no login após criação:', retryError);
    }
  }
}

getAuthToken();
