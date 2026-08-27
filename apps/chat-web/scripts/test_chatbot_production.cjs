const axios = require('axios');
const crypto = require('crypto');

const WEBHOOK_URL = 'https://ens-automacao.app.n8n.cloud/webhook/chatbot';
const HMAC_SECRET = 'nx_hmac_3h2j1k4l5m6n7o8p9q0r1s2t3u4v5w6x';
const API_KEY = 'nx_live_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d';

// Função auxiliar para gerar assinatura
function generateSignature(body) {
    const content = JSON.stringify(body);
    const hmac = crypto.createHmac('sha256', HMAC_SECRET);
    hmac.update(content);
    return hmac.digest('hex');
}

// Função auxiliar para enviar requisição
async function sendRequest(testName, body, customHeaders = {}) {
    console.log(`\n--- Teste: ${testName} ---`);
    const signature = generateSignature(body);
    
    // Headers padrão
    const headers = {
        'Content-Type': 'application/json',
        'x-signature': signature,
        'x-api-key': API_KEY, // Tentativa 1: Header comum para API Key
        ...customHeaders
    };

    try {
        const response = await axios.post(WEBHOOK_URL, body, { headers });
        console.log(`Status: ${response.status}`);
        console.log('Resposta:', JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        if (error.response) {
            console.log(`Status Erro: ${error.response.status}`);
            console.log('Dados Erro:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.log('Erro de Conexão:', error.message);
        }
    }
}

async function runTests() {
    // 1. Teste de Autenticação (Assinatura Inválida)
    console.log('\n=== INICIANDO TESTES DE QA ===');
    
    await sendRequest('1. Falha de Auth (Assinatura Inválida)', 
        { message: 'teste' }, 
        { 'x-signature': 'assinatura_falsa_123' }
    );

    // 2. Teste de Validação de Input
    await sendRequest('2. Validação de Input (Mensagem Vazia)', 
        { userId: 'qa-tester', sessionId: 'session-001', message: '' }
    );

    // 3. Teste RAG Técnico (ENS)
    await sendRequest('3. RAG Técnico (ENS)', 
        { userId: 'qa-tester', sessionId: 'session-001', message: 'Quais são as certificações disponíveis na ENS?' }
    );

    // 4. Teste RAG Marketing
    await sendRequest('4. RAG Marketing (Estratégia)', 
        { userId: 'qa-tester', sessionId: 'session-001', message: 'Qual a melhor abordagem para vender seguros para a Geração Z?' }
    );

    // 5. Teste Fusão (Técnico + MKT)
    await sendRequest('5. Fusão (Técnico + MKT)', 
        { userId: 'qa-tester', sessionId: 'session-001', message: 'Crie um pitch de vendas curto para o curso de Vida e Previdência focado em jovens profissionais.' }
    );
}

runTests();
