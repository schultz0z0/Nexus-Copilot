import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Carregar variáveis de ambiente
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function testRagRetrieval() {
  console.log("🔍 Iniciando teste de recuperação RAG...");

  // 1. Validar Variáveis de Ambiente
  const googleKey = process.env.GOOGLE_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!googleKey) {
    console.error("❌ Erro: GOOGLE_API_KEY não encontrada no .env");
    process.exit(1);
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Erro: Credenciais do Supabase não encontradas no .env");
    process.exit(1);
  }

  // 2. Configurar Clientes
  const genAI = new GoogleGenerativeAI(googleKey);
  const model = genAI.getGenerativeModel({ model: "models/text-embedding-004" });
  const supabase = createClient(supabaseUrl, supabaseKey);

  const query = "cursos de pós-graduação ENS 2026";
  console.log(`🤖 Gerando embedding para: "${query}" usando models/text-embedding-004...`);

  try {
    // 3. Gerar Embedding
    const result = await model.embedContent(query);
    const embedding = result.embedding.values;
    
    console.log(`✅ Embedding gerado com sucesso! Dimensão: ${embedding.length}`);

    // 4. Buscar no Supabase
    console.log("📡 Consultando Supabase RPC 'match_chatbot_rag'...");
    
    const { data, error } = await supabase.rpc("match_chatbot_rag", {
      query_embedding: embedding,
      match_threshold: 0.1, // Threshold baixo para garantir retorno se houver algo próximo
      match_count: 5
    });

    if (error) {
      console.error("❌ Erro ao chamar RPC:", error);
      return;
    }

    // 5. Exibir Resultados
    if (!data || data.length === 0) {
      console.warn("⚠️ Nenhum documento retornado. Verifique se:");
      console.warn("   1. O banco possui dados.");
      console.warn("   2. Os embeddings do banco foram gerados com o mesmo modelo (text-embedding-004).");
      console.warn("   3. O threshold (0.1) não está muito alto (pouco provável).");
    } else {
      console.log(`\n📚 Encontrados ${data.length} documentos relevantes:\n`);
      data.forEach((doc, index) => {
        console.log(`[${index + 1}] Similaridade: ${doc.similarity?.toFixed(4)}`);
        console.log(`    Título: ${doc.title || "Sem título"}`);
        console.log(`    Conteúdo (trecho): ${doc.content ? doc.content.substring(0, 150).replace(/\n/g, " ") + "..." : "Sem conteúdo"}`);
        console.log("---");
      });
      console.log("\n✅ Teste concluído: Os embeddings parecem compatíveis.");
    }

  } catch (err) {
    console.error("❌ Erro fatal durante a execução:", err);
  }
}

testRagRetrieval();
