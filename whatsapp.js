const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { queryOne, execute } = require('./database');

class WhatsAppBot {
    constructor() {
        this.client = null;
        this.qrCodeData = null;
        this.status = 'desconectado'; // desconectado | aguardando_qr | conectado
        this.info = null;
        this.filaEnvio = [];
        this.enviando = false;
    }

    inicializar() {
        console.log('[BOT] Inicializando WhatsApp client...');

        this.client = new Client({
            authStrategy: new LocalAuth({
                dataPath: './.wwebjs_auth'
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--disable-gpu'
                ]
            }
        });

        // Evento: QR Code gerado
        this.client.on('qr', async (qr) => {
            console.log('[BOT] QR Code recebido! Escaneie com WhatsApp.');
            this.status = 'aguardando_qr';
            try {
                this.qrCodeData = await qrcode.toDataURL(qr, {
                    width: 300,
                    margin: 2,
                    color: { dark: '#1e293b', light: '#ffffff' }
                });
            } catch (err) {
                console.error('[BOT] Erro ao gerar QR:', err);
            }
        });

        // Evento: Cliente pronto
        this.client.on('ready', () => {
            console.log('[BOT] ✅ WhatsApp conectado!');
            this.status = 'conectado';
            this.qrCodeData = null;
            this.info = this.client.info;
            console.log('[BOT] Número:', this.info?.wid?.user || 'desconhecido');
        });

        // Evento: Autenticado
        this.client.on('authenticated', () => {
            console.log('[BOT] ✅ Sessão autenticada!');
        });

        // ============================================
        // O CÉREBRO DA IA ENTRA AQUI EM AÇÃO!
        // ============================================
        const cerebro = require('./cerebro');

        this.client.on('message', async (msg) => {
            // Ignorar mensagens de sistema ou enviadas pelo próprio bot solto
            if (msg.from === 'status@broadcast' || msg.fromMe) return;

            // 1. O GATILHO (Reforçado com colete Anti-Crash para lidar com midias isoladas e falhas nativas)
            if (!msg.body) return; // Se for uma foto sem legenda ou recado vazio do sistema, o bot não quebra tentando ler.
            
            const textoLimpo = msg.body.toLowerCase();
            const marcouArroubaBot = textoLimpo.includes('@bot');
            
            // Tratamento hiper-blindado pra checar se ele foi mencionado sem crashar se as variáveis de sessão não tiverem carregado =
            let marcouOCelular = false;
            if (msg.mentionedIds && this.client && this.client.info && this.client.info.wid) {
                marcouOCelular = msg.mentionedIds.includes(this.client.info.wid._serialized);
            }
            
            if (!marcouArroubaBot && !marcouOCelular) {
                return; // Ignora os papos furados do grupo e fica quieto sem quebrar.
            }

            console.log(`\n======================================================`);
            console.log(`[TESTE V2] 🔔 GATILHO ACIONADO POR ${msg.from}!`);
            console.log(`[TESTE V2] 📩 MENSAGEM LIDA: "${msg.body}"`);
            console.log(`======================================================`);

            try {
                // 2. O SYSTEM PROMPT VERDADEIRO (A LÓGICA DO ARQUITETO)
                const systemPrompt = `Você é o Bot Interno da BitPé calçados, operando no grupo de funcionários. O dono é o ADM / Programador do sistema.
Seu objetivo é ler as solicitações dos funcionários para gerenciar clientes. Você agora recebe o "Contexto Recente" da conversa para lembrar do que estavam falando.

REGRAS:
1. VENDA: Se alguém falar que o cliente COMPROU (ex: "cliente Lucas 629.. comprou babuche n41"), extraia TUDO! Ação: "salvar_compra".
2. FALTA/LEAD: Se pedirem pra salvar pq NÃO TINHA O PRODUTO, a ação é "salvar_lead".
3. APAGAR: Para EXCLUIR um número, ação "apagar_lead".
4. ESTATÍSTICA: Se alguem perguntar "Quantos numeros tem salvos?", responda APENAS que vai verificar. Ação "contar_leads".
5. SEM CONTEXTO: Se o funcionário jogar apenas um número, pergunte sobre o que é. Ação "perguntar_funcionario".
6. LIXO: Mensagens indecifráveis geram ação "bloco_de_notas".

OBSERVAÇÃO DA RESPOSTA: Você deve ser natural e cirúrgico. Sepeare as informações para salvar.
Você é OBRIGADO a responder estritamente um JSON limpo, sem texto extra em volta:
{
  "acao": "salvar_compra" ou "salvar_lead" ou "apagar_lead" ou "contar_leads" ou "perguntar_funcionario" ou "bloco_de_notas" ou "nenhuma_acao",
  "mensagem_para_grupo": "Sua resposta com emojis comunicando pro grupo a decisão.",
  "detalhes": {
    "telefone_extraido": "6299999999 se houver",
    "nome_cliente": "Nome do cliente se foi falado na frase (ex: Lucas)",
    "produto": "Apenas o nome do calçado (ex: Babuche Homem Aranha)",
    "numeracao": "Apenas o número do calçado (ex: 41)",
    "anotacao_stranha": "bizarrice para o bloco de notas"
  }
}`;

                // Adicionando Memória de Curto Prazo (últimas 6 mensagens do grupo)
                if (!this.memoriaConversa) this.memoriaConversa = [];
                this.memoriaConversa.push(msg.body);
                if (this.memoriaConversa.length > 7) this.memoriaConversa.shift();

                const contextoMemoria = this.memoriaConversa.map((txt, i) => `Msg ${i+1}: ${txt}`).join('\n');
                const promptFinal = `[CONTEXTO RECENTE DO GRUPO PARA VC LEMBRAR]\n${contextoMemoria}\n\n[MENSAGEM ATUAL PARA ANALISAR]\n"${msg.body}"`;

                console.log(`[TESTE V2] 🚀 Enviando a mensagem com Histórico para a IA Especialista...`);
                let resposta_ia = await cerebro.pensar(promptFinal, systemPrompt);

                console.log(`\n[V2] 🧠 RETORNO IA (Ação Decidida):`);
                console.log(resposta_ia);

                // 3. O MOTOR EXECUTOR QUE PROCESSA AS ORDENS DA IA
                try {
                    const IA_Decisao = JSON.parse(resposta_ia);
                    
                    const limparNumeroBR = (bruto) => {
                        let n = bruto.replace(/\D/g, '');
                        if (!n.startsWith('55') && n.length >= 10) n = '55' + n;
                        return n;
                    };

                    let infoMsgParaEnviarDepois = null;

                    if (IA_Decisao.acao === 'salvar_compra' && IA_Decisao.detalhes && IA_Decisao.detalhes.telefone_extraido) {
                        const numLimpo = limparNumeroBR(IA_Decisao.detalhes.telefone_extraido);
                        const nomeInfo = IA_Decisao.detalhes.nome_cliente || "";
                        const prodInfo = IA_Decisao.detalhes.produto || "seu calçado";
                        const numInfo = IA_Decisao.detalhes.numeracao || "";
                        
                        const data = new Date().toLocaleDateString('pt-BR');
                        const hora = new Date().toLocaleTimeString('pt-BR');
                        
                        // Salva com todas as gavetas preenchidas perfeitamente
                        execute("INSERT INTO compras (telefone, nome_cliente, produto, numeracao, data_compra, hora_compra) VALUES (?, ?, ?, ?, ?, ?)", [numLimpo, nomeInfo, prodInfo, numInfo, data, hora]);
                        
                        // PV limpo e agradável
                        const wppAgradece = `Oi${nomeInfo ? ' '+nomeInfo : ''}! 👋 Aqui é a equipe *BitPé Calçados*! 🦶✨\n\nMuito obrigado pela sua compra de um maravilhoso ${prodInfo}! 💜 Ficamos imensamente felizes pela sua preferência.\n\n🎁 *QUER 10% DE DESCONTO na próxima compra?*\nÉ só postar uma foto marcando a gente lá no nosso Instagram: https://instagram.com/bitpecalcados\n\nAbraços!`;
                        
                        try {
                            // Validação do Nono dígito: O Whatsapp resolve internamente se esse número existe e qual é o ID correto dele
                            const idOficialWhatsapp = await this.client.getNumberId(numLimpo);
                            
                            if (idOficialWhatsapp) {
                                await this.client.sendMessage(idOficialWhatsapp._serialized, wppAgradece);
                            } else {
                                console.error(`[MOTOR] ⚠️ PV Cancelado: O número ${numLimpo} não foi encontrado nos registros do Whatsapp (Talvez falte ou sobre um dígito).`);
                            }
                        } catch (e) {
                            console.error(`[MOTOR] ❌ PV falhou criticamente:`, e.message);
                        }
                    }
                    else if (IA_Decisao.acao === 'salvar_lead' && IA_Decisao.detalhes && IA_Decisao.detalhes.telefone_extraido) {
                        const numLimpo = limparNumeroBR(IA_Decisao.detalhes.telefone_extraido);
                        const prodInfo = IA_Decisao.detalhes.produto || "";
                        const existe = queryOne("SELECT id FROM leads WHERE telefone = ?", [numLimpo]);
                        if (!existe) {
                            execute("INSERT INTO leads (telefone, observacao_ou_produto) VALUES (?, ?)", [numLimpo, prodInfo]);
                        }
                    } 
                    else if (IA_Decisao.acao === 'apagar_lead' && IA_Decisao.detalhes && IA_Decisao.detalhes.telefone_extraido) {
                        const numLimpo = limparNumeroBR(IA_Decisao.detalhes.telefone_extraido);
                        execute("DELETE FROM leads WHERE telefone = ?", [numLimpo]);
                    }
                    else if (IA_Decisao.acao === 'bloco_de_notas' && IA_Decisao.detalhes && IA_Decisao.detalhes.anotacao_stranha) {
                        execute("INSERT INTO bloco_notas (anotacao) VALUES (?)", [IA_Decisao.detalhes.anotacao_stranha]);
                    }
                    else if (IA_Decisao.acao === 'contar_leads') {
                        const countLeads = queryOne("SELECT COUNT(*) as total FROM leads");
                        const countCompras = queryOne("SELECT COUNT(*) as total FROM compras");
                        
                        // Em vez de mesclar na fala dela, nós engatilhamos para ser disparado numa segunda bolha!
                        infoMsgParaEnviarDepois = `📊 *MÉTRICAS BITPÉ CHECADAS:*\n\n✅ Vendas Concluídas hoje: ${countCompras ? countCompras.total : 0}\n⚠️ Leads de Falta de Estoque: ${countLeads ? countLeads.total : 0}\n\nPainel físico da Amazon 100% online.`;
                    }

                    // 1. O Bot envia a resposta natural no grupo primeiro
                    if (IA_Decisao.mensagem_para_grupo) {
                        await msg.reply(IA_Decisao.mensagem_para_grupo);
                        this.memoriaConversa.push(IA_Decisao.mensagem_para_grupo); // Grava o que ele disse tbm!
                    } else {
                        await msg.reply('Entendido.');
                    }
                    
                    // 2. Se a Ordem for de contar leads, o Node.js envia os dados Puros logo em seguida (Efeito Delay Humano)
                    if (infoMsgParaEnviarDepois) {
                        await new Promise(resolve => setTimeout(resolve, 2500)); // Aguarda 2.5s pra parecer real
                        await this.client.sendMessage(msg.from, infoMsgParaEnviarDepois);
                    }

                } catch (e) {
                    await msg.reply('Ops, tive um pequeno solavanco interno aqui!');
                }
            } catch (erro) {
                console.error("[WHATSAPP] O Cérebro deu tela azul:", erro);
            }
        });
        // ============================================

        // Evento: Falha na autenticação
        this.client.on('auth_failure', (msg) => {
            console.error('[BOT] ❌ Falha na autenticação:', msg);
            this.status = 'desconectado';
            this.qrCodeData = null;
        });

        // Evento: Desconectado
        this.client.on('disconnected', (reason) => {
            console.log('[BOT] ⚠️ Desconectado:', reason);
            this.status = 'desconectado';
            this.qrCodeData = null;
            this.info = null;
        });

        // Inicializa o client
        this.client.initialize().catch(err => {
            console.error('[BOT] Erro ao inicializar:', err);
            this.status = 'desconectado';
        });
    }

    // Retorna o estado atual do bot
    getStatus() {
        return {
            status: this.status,
            qrCode: this.qrCodeData,
            numero: this.info?.wid?.user || null,
            nome: this.info?.pushname || null
        };
    }

    // Limpa o número removendo formatação
    limparNumero(telefone) {
        let num = telefone.replace(/\D/g, '');
        if (num.startsWith('0')) num = num.substring(1);
        if (!num.startsWith('55')) num = '55' + num;
        return num;
    }

    // Descobre o ID correto do número no WhatsApp
    // O WhatsApp no Brasil tem uma inconsistência: alguns DDDs guardam o 9 extra, outros não.
    // Essa função tenta AMBOS os formatos e retorna o que funciona.
    async encontrarNumeroWhatsApp(telefone) {
        const num = this.limparNumero(telefone);
        const ddd = num.substring(2, 4); // Ex: "11", "71", "85"
        const resto = num.substring(4);   // Ex: "999999999" ou "99999999"

        // Monta as duas variantes possíveis
        const variantes = [];

        if (resto.length === 9 && resto.startsWith('9')) {
            // Usuário digitou COM o 9 (ex: 5511999999999)
            // Tenta: com o 9 e sem o 9
            variantes.push(num);                              // 5511999999999 (com 9)
            variantes.push('55' + ddd + resto.substring(1));  // 551199999999  (sem 9)
        } else if (resto.length === 8) {
            // Usuário digitou SEM o 9 (ex: 551199999999)
            // Tenta: sem o 9 e com o 9
            variantes.push(num);                         // 551199999999 (sem 9)
            variantes.push('55' + ddd + '9' + resto);    // 5511999999999 (com 9)
        } else {
            // Outro formato, tenta direto
            variantes.push(num);
        }

        // Tenta cada variante usando getNumberId do WhatsApp
        for (const v of variantes) {
            const chatId = v + '@c.us';
            try {
                const numberId = await this.client.getNumberId(chatId);
                if (numberId) {
                    console.log(`[BOT] Número ${telefone} → encontrado como ${numberId._serialized}`);
                    return numberId._serialized;
                }
            } catch (e) {
                // continua tentando
            }
        }

        // Nenhuma variante funcionou
        return null;
    }

    // Monta a mensagem a partir do template
    montarMensagem(compra) {
        const templateRow = queryOne('SELECT valor FROM config WHERE chave = ?', ['mensagem_template']);
        let msg = templateRow ? templateRow.valor : 'Obrigado pela sua compra na BitPé!';

        msg = msg.replace(/{produto}/g, compra.produto || '');
        msg = msg.replace(/{numeracao}/g, compra.numeracao || '');
        msg = msg.replace(/{data}/g, compra.data_compra || '');
        msg = msg.replace(/{hora}/g, compra.hora_compra || '');
        msg = msg.replace(/{nome}/g, compra.nome_cliente || '');
        msg = msg.replace(/{valor}/g, compra.valor || '');

        return msg;
    }

    // Envia mensagem para uma compra específica
    async enviarMensagem(compraId) {
        if (this.status !== 'conectado') {
            throw new Error('WhatsApp não está conectado');
        }

        const compra = queryOne('SELECT * FROM compras WHERE id = ?', [compraId]);
        if (!compra) throw new Error('Compra não encontrada');

        const mensagem = this.montarMensagem(compra);

        try {
            // Descobre o ID correto do número (tenta com e sem o 9)
            const numeroId = await this.encontrarNumeroWhatsApp(compra.telefone);

            if (!numeroId) {
                execute('UPDATE compras SET status_mensagem = ?, erro_envio = ? WHERE id = ?',
                    ['falha', 'Número não encontrado no WhatsApp (testou com e sem o 9)', compraId]);
                throw new Error('Número não encontrado no WhatsApp');
            }

            // Envia a mensagem
            await this.client.sendMessage(numeroId, mensagem);

            // Atualiza o status no banco
            execute('UPDATE compras SET status_mensagem = ?, data_envio = datetime("now","localtime"), erro_envio = NULL WHERE id = ?',
                ['enviada', compraId]);

            console.log(`[BOT] ✅ Mensagem enviada para ${compra.telefone} (compra #${compraId})`);
            return { sucesso: true };

        } catch (err) {
            execute('UPDATE compras SET status_mensagem = ?, erro_envio = ? WHERE id = ?',
                ['falha', err.message, compraId]);
            console.error(`[BOT] ❌ Falha ao enviar para ${compra.telefone}:`, err.message);
            throw err;
        }
    }

    // Adiciona à fila de envio e processa
    adicionarNaFila(compraId) {
        this.filaEnvio.push(compraId);
        if (!this.enviando) {
            this.processarFila();
        }
    }

    // Processa a fila de envio com delay entre mensagens
    async processarFila() {
        if (this.enviando || this.filaEnvio.length === 0) return;
        this.enviando = true;

        const delayRow = queryOne('SELECT valor FROM config WHERE chave = ?', ['delay_entre_msgs']);
        const delay = parseInt(delayRow?.valor || '8000');

        while (this.filaEnvio.length > 0) {
            const compraId = this.filaEnvio.shift();
            try {
                await this.enviarMensagem(compraId);
            } catch (err) {
                console.error(`[BOT] Erro na fila (compra #${compraId}):`, err.message);
            }

            // Delay entre mensagens para evitar ban
            if (this.filaEnvio.length > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        this.enviando = false;
    }

    // Desconecta o bot
    async desconectar() {
        if (this.client) {
            await this.client.logout();
            this.status = 'desconectado';
            this.qrCodeData = null;
            this.info = null;
        }
    }

    // Reinicializa o bot (para reconectar)
    async reiniciar() {
        if (this.client) {
            try { await this.client.destroy(); } catch (e) { }
        }
        this.status = 'desconectado';
        this.qrCodeData = null;
        this.info = null;
        this.inicializar();
    }
}

module.exports = new WhatsAppBot();
