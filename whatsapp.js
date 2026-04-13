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
            // Ignorar mensagens de sistema, grupos inúteis ou Status
            if (msg.from === 'status@broadcast' || msg.fromMe) return;

            console.log(`\n[WHATSAPP] 💬 Mensagem de ${msg.from}: ${msg.body}`);

            try {
                // Prompt instrutivo de exemplo para o que ele deve fazer
                const prompt_de_comandos = `
Você é a inteligência artificial do grupo de WhatsApp, controlando o bot da BitPé.
Você deve ler as mensagens e responder humanamente de forma rápida e sucinta.
Se tentarem pedir para salvar número, você ajuda. Se for dúvida de sapato, ajude.
Não seja um robô chato, digite como um brasileiro normal de WhatsApp usando gírias leves.`;

                // Chama a nossa rotação de chaves gratuitas do json!
                const resposta_ia = await cerebro.pensar(msg.body, prompt_de_comandos);

                // Envia a resposta final para o chat (marcando a pessoa)
                await msg.reply(resposta_ia);
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
