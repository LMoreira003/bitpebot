const fs = require('fs');
const path = require('path');

class CerebroAI {
    constructor() {
        // Chaves protegidas! Ele vai ler fisicamente o texto do arquivo .env que sua tela da AWS criou.
        let keysString = "";
        try {
            const envPath = path.join(__dirname, '.env');
            if (fs.existsSync(envPath)) {
                const envTexto = fs.readFileSync(envPath, 'utf8');
                const match = envTexto.match(/GEMINI_KEYS="([^"]+)"/);
                if (match) keysString = match[1];
            } else {
                console.log("[CÉREBRO GOOGLE] ⚠️ Arquivo .env não achado, vou tentar usar variável de sistema.");
                keysString = process.env.GEMINI_KEYS || "";
            }
        } catch (e) { }

        this.keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 5);
        
        // Os modelos do futuro que você confia (Deixamos APENAS o rei da velocidade que não restringe cota grátis)
        this.modelos = [
            'gemini-3-flash-preview'
        ];
        
        // SISTEMA DE FILA (MUTEX / FUNIL DOURADO)
        // Isso impede o atropelamento: uma mensagem só entra no funil quando a outra sair!
        this.filaDeProcessamento = Promise.resolve();
    }

    async pensar(prompt, system_prompt = "Você é um bot assistente de uma loja chamada BitPé.") {
        return new Promise((resolve, reject) => {
            // Coloca a requisição no final da fila. 
            // Se houver 3 mensagens ao mesmo tempo, a 2ª só entra quando a 1ª terminar.
            this.filaDeProcessamento = this.filaDeProcessamento.then(async () => {
                try {
                    const resultado = await this._executarNaAcessoLivre(prompt, system_prompt);
                    resolve(resultado);
                } catch (e) {
                    reject(e);
                } finally {
                    // Atrasa a próxima tarefa da fila para dar respiro (Cooldown)
                    await new Promise(r => setTimeout(r, 2000));
                }
            });
        });
    }

    async _executarNaAcessoLivre(prompt, system_prompt) {
        let tentativas = 0;
        
        while (tentativas < 5) { 
            // O balanceamento de Roleta (Roda de Modelos x Chaves)
            const chaveAtual = this.keys[tentativas % this.keys.length];
            const modeloAtual = this.modelos[tentativas % this.modelos.length];

            console.log(`[CÉREBRO GOOGLE] 📡 Construindo nave... (Modelo: ${modeloAtual} | Chave: *${chaveAtual.slice(-5)})`);

            try {
                // Estrutura exigida oficialmente pelo Google Gemini v1beta
                const payload = {
                    systemInstruction: {
                        parts: [{ text: system_prompt }]
                    },
                    contents: [{
                        parts: [{ text: prompt }]
                    }]
                };

                const url = `https://generativelanguage.googleapis.com/v1beta/models/${modeloAtual}:generateContent?key=${chaveAtual}`;

                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                if (response.status === 429 || response.status === 403 || response.status === 401) {
                    console.log(`[CÉREBRO GOOGLE] ❌ Modelo ou Chave *${chaveAtual.slice(-5)} encheu o saco (${response.status})!`);
                    tentativas++;
                    console.log(`[CÉREBRO GOOGLE] ⏳ Aguardando respiro (2s) antes de rodar a roleta da próxima chave/modelo...`);
                    await new Promise(r => setTimeout(r, 2000));
                    continue; 
                }

                if (!response.ok) {
                    const textError = await response.text();
                    throw new Error(`Google Status ${response.status} -> ${textError}`);
                }

                const data = await response.json();
                
                // Validação extrema de corpo do Gemini
                if (!data || !data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
                     console.error(`[CÉREBRO GOOGLE] 🚨 O Google pirou e mandou um pacote vazio/estranho:`, JSON.stringify(data));
                     tentativas++;
                     await new Promise(r => setTimeout(r, 2000));
                     continue; 
                }
                
                let respostaLimpa = data.candidates[0].content.parts[0].text;
                
                // Opcional: limpar bordas sujas The Gemini costuma envolver JSON puro em `json ... ` no markdown.
                respostaLimpa = respostaLimpa.replace(/```json/g, '').replace(/```/g, '').trim();

                return respostaLimpa;

            } catch (err) {
                console.error(`[CÉREBRO GOOGLE] 🚨 Falha grave na conexão: ${err.message}`);
                tentativas++;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        // Se a API torrar todas as 5 chances dele
        return JSON.stringify({ mensagem_para_grupo: "Minha conexão com a Mente-Mestra falhou! Tente daqui a pouco.", acao: "nenhuma_acao" });
    }
}

module.exports = new CerebroAI();
