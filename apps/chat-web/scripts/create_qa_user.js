
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function createTestUser() {
  const email = 'qa_tester@nexus.ai';
  const password = 'password123';

  console.log(`Creating user ${email}...`);

  // Check if user exists
  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing users:', listError);
    return;
  }

  const existingUser = users.users.find(u => u.email === email);

  if (existingUser) {
    console.log('User already exists. Updating password...');
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      { password: password }
    );
    if (updateError) {
      console.error('Error updating password:', updateError);
    } else {
      console.log('Password updated successfully.');
    }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'QA Tester' }
    });

    if (error) {
      console.error('Error creating user:', error);
    } else {
      console.log('User created successfully:', data.user.id);
    }
  }
}

createTestUser();
