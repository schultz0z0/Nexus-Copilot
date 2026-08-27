import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

// Configuração para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Client } = pg;

async function applyMigration() {
  console.log('🚀 Iniciando script de migração...');

  // 1. Obter URL de conexão
  const dbUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error('❌ ERRO: Nenhuma string de conexão encontrada (SUPABASE_DATABASE_URL ou DATABASE_URL).');
    console.log('💡 Dica: Verifique seu arquivo .env');
    process.exit(1);
  }

  // 2. Configurar cliente Postgres
  const client = new Client({
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false // Necessário para Supabase em alguns ambientes
    }
  });

  try {
    // 3. Conectar ao banco
    console.log('YT Conectando ao banco de dados Supabase...');
    await client.connect();
    console.log('✅ Conexão estabelecida com sucesso.');

    // 4. Ler arquivo SQL
    const migrationPath = path.resolve(__dirname, '../supabase_campaigns_migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Arquivo de migração não encontrado: ${migrationPath}`);
    }

    console.log(`📖 Lendo arquivo de migração: ${path.basename(migrationPath)}...`);
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');

    if (!sqlContent.trim()) {
      console.warn('⚠️ O arquivo de migração está vazio. Nada a executar.');
      return;
    }

    // 5. Executar SQL
    console.log('⚡ Executando migração SQL...');
    
    // Iniciar transação para garantir integridade
    await client.query('BEGIN');
    
    try {
      await client.query(sqlContent);
      await client.query('COMMIT');
      console.log('✅ Migração aplicada com sucesso!');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

  } catch (error) {
    console.error('\n❌ FALHA NA MIGRAÇÃO:');
    console.error('---------------------------------------------------');
    if (error.code === 'ENOTFOUND') {
      console.error('⚠️  Erro de DNS: Não foi possível encontrar o servidor do banco de dados.');
      console.error(`   Host tentado: ${process.env.SUPABASE_DATABASE_URL?.split('@')[1]?.split(':')[0]}`);
      console.error('   Dica: Verifique se o projeto Supabase está ativo e se a URL no .env está correta.');
    } else if (error.code === '28P01') {
      console.error('⚠️  Erro de Autenticação: Senha incorreta ou usuário inexistente.');
      console.error('   Dica: Verifique SUPABASE_DB_PASSWORD no arquivo .env');
    } else {
      console.error(error.message);
    }
    
    if (error.position) {
      console.error(`Posição do erro SQL: ${error.position}`);
    }
    console.error('---------------------------------------------------');
    
    console.log('\n🛠️  SOLUÇÃO ALTERNATIVA MANUAL:');
    console.log('1. Copie o conteúdo do arquivo: supabase_campaigns_migration.sql');
    console.log('2. Vá para o Supabase Dashboard > SQL Editor');
    console.log('3. Cole e execute o script.');
    
    process.exit(1);
  } finally {
    // 6. Fechar conexão
    await client.end();
    console.log('👋 Conexão encerrada.');
  }
}

applyMigration();
