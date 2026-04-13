const fs = require('fs');
const path = require('path');

class CerebroAI {
    constructor() {
        this.keysPath = path.join(__dirname, 'keys.json');
        this.pool = [];
        this.carregarChaves();
    }

    carregarChaves() {
        try {
            if (fs.existsSync(this.keysPath)) {
                const data = JSON.parse(fs.readFileSync(this.keysPath, 'utf8'));
                this.pool = data.pool || [];
                console.log(`[CÉREBRO] 🧠 ${this.pool.length} chaves da Airforce carregadas no tambor!`);
            } else {
                console.warn('[CÉREBRO] Arquivo keys.json não encontrado. A IA não vai funcionar.');
            }
        } catch (e) {
            console.error('[CÉREBRO] Erro ao ler keys.json:', e);
        }
    }

    salvarChaves() {
        try {
            fs.writeFileSync(this.keysPath, JSON.stringify({ pool: this.pool }, null, 2));
        } catch (e) {
            console.error('[CÉREBRO] Erro ao salvar log de requests nas chaves.', e);
        }
    }

    obterChaveBalanceada() {
        // Pega apenas as chaves ativas
        const ativas = this.pool.filter(k => k.status === 'active');
        if (ativas.length === 0) return null;
        
        // Pega sempre a que tem o MENOR número de requests (Balanceamento de Carga)
        ativas.sort((a, b) => (a.requests || 0) - (b.requests || 0));
        return ativas[0];
    }

    marcarErro(chaveStr) {
        const keyObj = this.pool.find(k => k.key === chaveStr);
        if (keyObj) {
            keyObj.status = 'exhausted'; // Queimou o limite
            this.salvarChaves();
            console.log(`[CÉREBRO] ❌ Chave final ${chaveStr.slice(-5)} banida temporariamente por limites!`);
        }
    }

    async pensar(prompt, system_prompt = "Você é um bot assistente de uma loja chamada BitPé.") {
        let tentativas = 0;
        const MODELO = "claude-4-ch-exp"; // O modelo blindado
        
        // Fila de backup: se uma chave der limite de requisição, ele tenta em outras até 5x sem o cliente perceber!
        while (tentativas < 5) { 
            const keyObj = this.obterChaveBalanceada();
            if (!keyObj) {
                console.error("[CÉREBRO] ERRO CRÍTICO: Todas as suas chaves foram banidas ou acabaram os limites.");
                return "Estou sobrecarregado no momento, chame um humano.";
            }

            const apiKey = keyObj.key;
            console.log(`[CÉREBRO] 📡 Disparando... (Modelo: ${MODELO} | Chave: *${apiKey.slice(-5)})`);

            try {
                // Na versão do Node mais recente, o fetch é nativo. O Render usa o Node v20+.
                const response = await fetch("https://api.airforce/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: MODELO,
                        messages: [
                            { role: "system", content: system_prompt },
                            { role: "user", content: prompt }
                        ]
                    })
                });

                if (response.status === 429 || response.status === 403 || response.status === 401) {
                    this.marcarErro(apiKey);
                    tentativas++;
                    console.log(`[CÉREBRO] ⏳ Aguardando 2s antes de tentar a próxima chave...`);
                    await new Promise(r => setTimeout(r, 2000)); // DELAY ANTI-SPAM
                    continue; 
                }

                if (!response.ok) {
                    const textError = await response.text();
                    throw new Error(`Airforce Status ${response.status} -> ${textError}`);
                }

                const data = await response.json();
                
                // Barreira de segurança (A que derrubou seu log antes)
                if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
                     console.error(`[CÉREBRO] 🚨 A Airforce mandou um pacote bizarro pelo modelo ${MODELO}:`, JSON.stringify(data));
                     tentativas++;
                     console.log(`[CÉREBRO] ⏳ Aguardando 2s antes de pular de chave...`);
                     await new Promise(r => setTimeout(r, 2000));
                     continue; 
                }
                
                // Sucesso! Registra que a chave gastou cota no arquivo físico.
                keyObj.requests = (keyObj.requests || 0) + 1;
                this.salvarChaves();
                
                return data.choices[0].message.content;

            } catch (err) {
                console.error(`[CÉREBRO] Falha grave na conexão: ${err.message}`);
                tentativas++;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        return "Minha mente bugou, tem muitas mensagens chegando! Aguarde um instante...";
    }
}

module.exports = new CerebroAI();
