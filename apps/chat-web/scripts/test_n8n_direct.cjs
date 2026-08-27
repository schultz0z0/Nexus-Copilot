const https = require('https');

// Configurações extraídas do .env e instruções do usuário
const N8N_URL = 'https://ens-automacao.app.n8n.cloud/webhook/chatbot';
const N8N_API_KEY = 'nx_live_9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d';

const payload = JSON.stringify({
  message: 'ola teste de conexao direta',
  userId: 'debug-user-123',
  sessionId: 'debug-session-123'
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${N8N_API_KEY}`,
    'X-API-KEY': N8N_API_KEY,
    'Content-Length': payload.length
  }
};

console.log(`Testando conexão direta com n8n: ${N8N_URL}`);

const req = https.request(N8N_URL, options, (res) => {
  console.log(`Status Code: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response Body:', data);
    if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✅ SUCESSO: N8N aceitou a requisição.');
    } else {
        console.log('❌ FALHA: N8N rejeitou a requisição.');
    }
  });
});

req.on('error', (e) => {
  console.error(`Erro na requisição: ${e.message}`);
});

req.write(payload);
req.end();
