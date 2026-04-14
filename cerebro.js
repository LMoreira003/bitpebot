const fs = require('fs');
const path = require('path');

class CerebroAI {
    constructor() {
        // Chaves protegidas! Ele vai ler fisicamente o texto do arquivo .env que sua tela da AWS criou.
        let keysString = "";
        let groqKey = "";
        try {
            const envPath = path.join(__dirname, '.env');
            if (fs.existsSync(envPath)) {
                const envTexto = fs.readFileSync(envPath, 'utf8');
                const match = envTexto.match(/GEMINI_KEYS="([^"]+)"/);
                if (match) keysString = match[1];
                // Suporte a múltiplas chaves Groq (GROQ_KEYS) ou chave única (GROQ_KEY)
                const matchGroqMulti = envTexto.match(/GROQ_KEYS="([^"]+)"/);
                const matchGroqSingle = envTexto.match(/GROQ_KEY="([^"]+)"/);
                if (matchGroqMulti) groqKey = matchGroqMulti[1];
                else if (matchGroqSingle) groqKey = matchGroqSingle[1];
            } else {
                console.log("[CÉREBRO GOOGLE] ⚠️ Arquivo .env não achado, vou tentar usar variável de sistema.");
                keysString = process.env.GEMINI_KEYS || "";
                groqKey = process.env.GROQ_KEYS || process.env.GROQ_KEY || "";
            }
        } catch (e) { }

        this.keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 5);
        this.groqKeys = groqKey.split(',').map(k => k.trim()).filter(k => k.length > 5);
        this.indiceGroqAtual = 0;
        
        // Os modelos do futuro que você confia (Deixamos APENAS o rei da velocidade que não restringe cota grátis)
        this.modelos = [
            'gemini-2.0-flash'
        ];
        
        // SISTEMA DE FILA (MUTEX / FUNIL DOURADO)
        // Isso impede o atropelamento: uma mensagem só entra no funil quando a outra sair!
        this.filaDeProcessamento = Promise.resolve();
        
        // CATRACA DE CHAVES (Desgaste uniforme)
        this.indiceChaveAtual = 0;

        if (this.groqKeys.length > 0) console.log(`[CÉREBRO] 🛡️ Fallback Groq carregado com ${this.groqKeys.length} chave(s)!`);
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
                    // Após a requisição terminar (sucesso ou falha total), giramos a catraca para o próximo cliente
                    this.indiceChaveAtual = (this.indiceChaveAtual + 1) % this.keys.length;
                    
                    // Atrasa a próxima tarefa da fila para dar respiro (Cooldown)
                    await new Promise(r => setTimeout(r, 2000));
                }
            });
        });
    }

    async _executarNaAcessoLivre(prompt, system_prompt) {
        let tentativas = 0;
        
        while (tentativas < 5) { 
            // O balanceamento de Roleta somado com a Catraca Cíclica
            const startIndex = (this.indiceChaveAtual + tentativas) % this.keys.length;
            const chaveAtual = this.keys[startIndex];
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
        
        // Se a API torrar todas as 5 chances dele, ativa o FALLBACK GROQ
        if (this.groqKeys.length > 0) {
            console.log('[CÉREBRO] 🛡️ Gemini esgotado! Ativando fallback Groq...');
            // Tenta todas as chaves Groq em rodízio
            for (let g = 0; g < this.groqKeys.length; g++) {
                const groqIdx = (this.indiceGroqAtual + g) % this.groqKeys.length;
                const groqChave = this.groqKeys[groqIdx];
                try {
                    const resultado = await this._fallbackGroq(prompt, system_prompt, groqChave);
                    if (resultado) {
                        this.indiceGroqAtual = (groqIdx + 1) % this.groqKeys.length;
                        return resultado;
                    }
                } catch (groqErr) {
                    console.error(`[CÉREBRO GROQ] ❌ Chave *${groqChave.slice(-5)} falhou:`, groqErr.message);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        // Se tudo falhou (Gemini + Groq)
        return JSON.stringify({ mensagem_para_grupo: "Minha conexão com a Mente-Mestra falhou! Tente daqui a pouco.", acao: "nenhuma_acao", clientes: [] });
    }

    // MOTOR DE FALLBACK: Groq (gpt-oss-120b)
    async _fallbackGroq(prompt, system_prompt, chave) {
        console.log(`[CÉREBRO GROQ] 📡 Tentando chave *${chave.slice(-5)}...`);
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

        console.log('[CÉREBRO GROQ] ✅ Fallback respondeu com sucesso!');
        return respostaLimpa;
    }
}

module.exports = new CerebroAI();
