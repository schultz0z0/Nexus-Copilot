
import pg from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const { Pool } = pg;

// Tenta obter string de conexão
const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;

async function runDiagnosisWithPg() {
  console.log('--- Tentativa 1: Conexão direta via PG ---');
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida.');
  }

  const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000, // Timeout rápido para fallback
  });

  try {
    // 1. Contar documentos
    console.log('1. Contando documentos contendo "2026"...');
    const countQuery = `
      SELECT count(*) as total 
      FROM chatbot_rag_documents 
      WHERE content ILIKE '%2026%'
    `;
    const countRes = await pool.query(countQuery);
    console.log(`   Total encontrado: ${countRes.rows[0].total}`);

    // 2. Listar metadata
    console.log('2. Buscando metadata dos primeiros 5 documentos...');
    const metaQuery = `
      SELECT id, substring(content from 1 for 50) as preview, metadata 
      FROM chatbot_rag_documents 
      WHERE content ILIKE '%2026%' 
      LIMIT 5
    `;
    const metaRes = await pool.query(metaQuery);
    
    if (metaRes.rows.length === 0) {
      console.log('   Nenhum documento encontrado.');
    } else {
      metaRes.rows.forEach((row, index) => {
        console.log(`   [Doc ${index + 1}] ID: ${row.id}`);
        console.log(`   Preview: "${row.preview}..."`);
        console.log(`   Metadata:`, JSON.stringify(row.metadata, null, 2));
      });
    }

    // 3. Testar RPC
    console.log('3. Testando execução da RPC "match_chatbot_rag"...');
    const vectorDim = 768;
    const dummyVector = Array(vectorDim).fill(0.01);
    const vectorString = JSON.stringify(dummyVector);

    const rpcQuery = `
      SELECT * FROM match_chatbot_rag(
        $1::vector, 
        $2::float, 
        $3::int, 
        $4::jsonb
      )
    `;
    
    const rpcParams = [vectorString, 0.0, 1, {}];
    const rpcRes = await pool.query(rpcQuery, rpcParams);
    
    console.log('   RPC executada com sucesso!');
    console.log(`   Resultados retornados: ${rpcRes.rows.length}`);
    if (rpcRes.rows.length > 0) {
      console.log(`   ID: ${rpcRes.rows[0].id}, Similarity: ${rpcRes.rows[0].similarity}`);
    }

    await pool.end();
    return true; // Sucesso

  } catch (err) {
    console.log('   Falha na conexão PG:', err.message);
    await pool.end();
    return false; // Falha, tentar próximo método
  }
}

async function runDiagnosisWithSupabaseJs() {
  console.log('\n--- Tentativa 2: Conexão via Supabase JS (HTTP) ---');
  
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERRO: Credenciais do Supabase (URL/KEY) não encontradas.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Contar documentos
    // Supabase JS não tem count(*) direto com filtro ILIKE complexo facilmente sem select count
    console.log('1. Contando documentos contendo "2026"...');
    const { count, error: countError } = await supabase
      .from('chatbot_rag_documents')
      .select('*', { count: 'exact', head: true }) // head: true não retorna dados, só contagem
      .ilike('content', '%2026%');

    if (countError) throw countError;
    console.log(`   Total encontrado: ${count}`);

    // 2. Listar metadata
    console.log('2. Buscando metadata dos primeiros 5 documentos...');
    const { data: docs, error: docsError } = await supabase
      .from('chatbot_rag_documents')
      .select('id, content, metadata')
      .ilike('content', '%2026%')
      .limit(5);

    if (docsError) throw docsError;

    if (!docs || docs.length === 0) {
      console.log('   Nenhum documento encontrado.');
    } else {
      docs.forEach((doc, index) => {
        console.log(`   [Doc ${index + 1}] ID: ${doc.id}`);
        console.log(`   Preview: "${doc.content.substring(0, 50)}..."`);
        console.log(`   Metadata:`, JSON.stringify(doc.metadata, null, 2));
      });
    }

    // 3. Testar RPC
    console.log('3. Testando execução da RPC "match_chatbot_rag"...');

    const tryRpc = async (vectorDim) => {
      const dummyVector = Array(vectorDim).fill(0.01);
      const { data, error } = await supabase.rpc('match_chatbot_rag', {
        query_embedding: dummyVector,
        match_threshold: 0.0,
        match_count: 1,
        filter: {},
      });
      return { vectorDim, data, error };
    };

    const attempts = [768, 1536];
    for (const dim of attempts) {
      console.log(`   - Tentando com embedding dummy de dimensão ${dim}...`);
      const r = await tryRpc(dim);
      if (r.error) {
        console.log(`     ❌ Falhou (${dim}):`, r.error.code || r.error.message, r.error.message);
      } else {
        console.log(`     ✅ OK (${dim}). Resultados: ${r.data ? r.data.length : 0}`);
        if (r.data && r.data.length > 0) {
          console.log(`     ID: ${r.data[0].id}, Similarity: ${r.data[0].similarity}`);
        }
      }
    }

  } catch (err) {
    console.error('ERRO FATAL NO SUPABASE JS:');
    console.error(err);
  }
}

async function main() {
  console.log('Iniciando diagnóstico...');
  
  // Tenta PG primeiro
  const pgSuccess = await runDiagnosisWithPg();
  
  // Se falhar, tenta Supabase JS
  if (!pgSuccess) {
    console.log('Alternando para Supabase JS devido a erro de conexão direta...');
    await runDiagnosisWithSupabaseJs();
  }
}

main();
