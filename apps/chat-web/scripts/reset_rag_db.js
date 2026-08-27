import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

const run = async () => {
  const password = process.env.SUPABASE_DB_PASSWORD;
  const projectRef = process.env.SUPABASE_PROJECT_REF;

  if (!password || !projectRef) {
    console.error('Missing SUPABASE_DB_PASSWORD or SUPABASE_PROJECT_REF in .env');
    process.exit(1);
  }

  // Strategy 1: Direct Connection (often fails if DNS is flaky or blocked)
  const directUrl = `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`;
  
  // Strategy 2: Supavisor Pooler (SA-EAST-1 based on logs)
  const poolerUrl = `postgresql://postgres.${projectRef}:${password}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;

  const tryConnect = async (url, name) => {
    console.log(`Trying connection strategy: ${name}...`);
    
    // Explicitly configure SSL to ignore self-signed cert errors (common in some envs)
    const client = new Client({
      connectionString: url,
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      await client.connect();
      console.log(`✅ Connected via ${name}`);
      return client;
    } catch (e) {
      console.warn(`❌ Failed to connect via ${name}: ${e.message}`);
      await client.end().catch(() => {});
      return null;
    }
  };

  let client = await tryConnect(directUrl, 'Direct DB Host');
  
  if (!client) {
    client = await tryConnect(poolerUrl, 'Supavisor (SA-EAST-1)');
  }

  if (!client) {
    console.error('🔥 All connection strategies failed. Please check your network/VPN or project status.');
    process.exit(1);
  }

  try {
    const sqlPath = path.join(process.cwd(), 'scripts', 'clean_rag_documents.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Cleaning RAG documents table...');
    console.log(`Executing SQL from: ${sqlPath}`);
    
    await client.query(sql);
    
    console.log('✅ Table "chatbot_rag_documents" truncated successfully! The DB is ready for re-ingestion.');
    
  } catch (err) {
    console.error('Error cleaning RAG database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
};

run();
