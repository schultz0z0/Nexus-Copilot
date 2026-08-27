import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

const run = async () => {
  const password = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const dbUrl = process.env.SUPABASE_DATABASE_URL;

  if (!password || !projectRef) {
    console.error('Missing SUPABASE_DB_PASSWORD or SUPABASE_PROJECT_REF in .env');
    process.exit(1);
  }

  const sqlPath = path.join(process.cwd(), 'supabase', 'migrations', '20251229_update_rag_function_filters.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Helper to test connection
  const tryConnect = async (config, name) => {
    console.log(`\n🔌 Trying connection strategy: ${name}...`);
    // Mask password in logs
    const logConfig = { ...config, password: '****' };
    if (logConfig.connectionString) {
        logConfig.connectionString = logConfig.connectionString.replace(/:([^:@]+)@/, ':****@');
    }
    console.log(`   Config: ${JSON.stringify(logConfig)}`);
    
    const client = new Client(config);

    try {
      await client.connect();
      console.log(`   ✅ Connected via ${name}`);
      return client;
    } catch (e) {
      console.warn(`   ❌ Failed to connect via ${name}: ${e.message}`);
      await client.end().catch(() => {});
      return null;
    }
  };

  let client = null;

  // Strategy 0: Env Var Connection String (Direct)
  if (dbUrl) {
      client = await tryConnect({
          connectionString: dbUrl,
          ssl: { rejectUnauthorized: false }
      }, 'Env Variable (SUPABASE_DATABASE_URL)');
  }

  // Strategy 1: Supavisor Pooler (Try multiple regions)
  const regions = [
      'aws-0-sa-east-1.pooler.supabase.com', // Brazil
      'aws-0-us-east-1.pooler.supabase.com', // US East
      'aws-0-eu-central-1.pooler.supabase.com', // Europe
      'aws-0-us-west-1.pooler.supabase.com'  // US West
  ];

  if (!client) {
      for (const host of regions) {
          if (client) break;
          client = await tryConnect({
            host: host,
            port: 6543,
            database: 'postgres',
            user: `postgres.${projectRef}`,
            password: password,
            ssl: { rejectUnauthorized: false }
          }, `Supavisor (${host})`);
      }
  }

  // Strategy 2: Direct Connection constructed manually
  if (!client) {
    client = await tryConnect({
      connectionString: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`,
      ssl: { rejectUnauthorized: false }
    }, 'Direct DB Host (Manual Construction)');
  }

  if (!client) {
    console.error('\n🔥 All connection strategies failed.');
    console.error('👉 Ensure your IP is allowed in Supabase Network settings if "Enforce Network Ban" is on.');
    console.error('👉 Try running the SQL manually in Supabase Dashboard SQL Editor.');
    process.exit(1);
  }

  try {
    console.log('\n📜 Applying migration...');
    console.log('   SQL File Path:', sqlPath);
    console.log('   SQL Preview:', sql.substring(0, 100).replace(/\n/g, ' '));

    await client.query(sql);
    
    console.log('✅ Migration applied successfully! 🚀');
    
    // Validation
    console.log('\n🕵️ Validating match_chatbot_rag function...');
    const res = await client.query(`
      SELECT proargnames 
      FROM pg_proc 
      WHERE proname = 'match_chatbot_rag';
    `);
    
    if (res.rows.length > 0) {
        const args = res.rows[0].proargnames;
        if (args && args.includes('filter')) {
             console.log('✅ Function match_chatbot_rag updated with "filter" parameter.');
        } else {
             console.warn('⚠️ Function found but "filter" parameter might be missing. Args:', args);
        }
    } else {
        console.error('❌ Function match_chatbot_rag NOT found.');
    }

  } catch (err) {
    console.error('Error applying migration:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
};

run();
