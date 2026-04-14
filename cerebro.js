const fs = require('fs');
const path = require('path');

class CerebroAI {
    constructor() {
        // Carrega as chaves Groq do .env ou variáveis de ambiente
        let groqKey = "";
        try {
            const envPath = path.join(__dirname, '.env');
            if (fs.existsSync(envPath)) {
                const envTexto = fs.readFileSync(envPath, 'utf8');
                // Suporte a múltiplas chaves Groq (GROQ_KEYS) ou chave única (GROQ_KEY)
                const matchMulti = envTexto.match(/GROQ_KEYS="([^"]+)"/);
                const matchSingle = envTexto.match(/GROQ_KEY="([^"]+)"/);
                if (matchMulti) groqKey = matchMulti[1];
                else if (matchSingle) groqKey = matchSingle[1];
            } else {
                console.log("[CÉREBRO] ⚠️ Arquivo .env não achado, vou tentar usar variável de sistema.");
                groqKey = process.env.GROQ_KEYS || process.env.GROQ_KEY || "";
            }
        } catch (e) { }

        this.keys = groqKey.split(',').map(k => k.trim()).filter(k => k.length > 5);
        this.indiceChaveAtual = 0;
        
        // SISTEMA DE FILA (MUTEX / FUNIL DOURADO)
        // Isso impede o atropelamento: uma mensagem só entra no funil quando a outra sair!
        this.filaDeProcessamento = Promise.resolve();

        if (this.keys.length > 0) {
            console.log(`[CÉREBRO] ✅ Groq carregado com ${this.keys.length} chave(s)!`);
        } else {
            console.error('[CÉREBRO] ❌ NENHUMA CHAVE GROQ ENCONTRADA! O bot não vai conseguir pensar.');
        }
    }

    async pensar(prompt, system_prompt = "Você é um bot assistente de uma loja chamada BitPé.") {
        return new Promise((resolve, reject) => {
            // Coloca a requisição no final da fila. 
            // Se houver 3 mensagens ao mesmo tempo, a 2ª só entra quando a 1ª terminar.
            this.filaDeProcessamento = this.filaDeProcessamento.then(async () => {
                try {
                    const resultado = await this._executar(prompt, system_prompt);
                    resolve(resultado);
                } catch (e) {
                    reject(e);
                } finally {
                    // Gira a catraca para a próxima chave
                    this.indiceChaveAtual = (this.indiceChaveAtual + 1) % this.keys.length;
                    
                    // Cooldown entre requisições
                    await new Promise(r => setTimeout(r, 2000));
                }
            });
        });
    }

    async _executar(prompt, system_prompt) {
        // Tenta todas as chaves em rodízio antes de desistir
        for (let tentativa = 0; tentativa < this.keys.length; tentativa++) {
            const idx = (this.indiceChaveAtual + tentativa) % this.keys.length;
            const chave = this.keys[idx];

            console.log(`[CÉREBRO] 📡 Enviando para Groq... (Chave: *${chave.slice(-5)} | Tentativa ${tentativa + 1}/${this.keys.length})`);

            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${chave}`
                    },
                    body: JSON.stringify({
                        model: 'openai/gpt-oss-120b',
                        messages: [
                            { role: 'system', content: system_prompt },
                            { role: 'user', content: prompt }
                        ],
                        max_tokens: 1024,
                        temperature: 0.3
                    })
                });

                if (response.status === 429 || response.status === 403 || response.status === 401) {
                    console.log(`[CÉREBRO] ❌ Chave *${chave.slice(-5)} bloqueada (${response.status}). Rodando pra próxima...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue;
                }

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Groq Status ${response.status} -> ${errText}`);
                }

                const data = await response.json();
                const msg = data.choices?.[0]?.message;
                if (!msg) throw new Error('Groq retornou resposta vazia');

                // gpt-oss-120b pode colocar a resposta em 'content' ou 'reasoning'
                let respostaLimpa = (msg.content || msg.reasoning || '').trim();
                respostaLimpa = respostaLimpa.replace(/```json/g, '').replace(/```/g, '').trim();

                if (!respostaLimpa) throw new Error('Groq retornou texto vazio');

                console.log('[CÉREBRO] ✅ Resposta recebida com sucesso!');
                return respostaLimpa;

            } catch (err) {
                console.error(`[CÉREBRO] 🚨 Falha na chave *${chave.slice(-5)}: ${err.message}`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Se todas as chaves falharam
        console.error('[CÉREBRO] ❌ TODAS AS CHAVES FALHARAM!');
        return JSON.stringify({ mensagem_para_grupo: "Minha conexão com a Mente-Mestra falhou! Tente daqui a pouco.", acao: "nenhuma_acao", clientes: [] });
    }
}

module.exports = new CerebroAI();
