const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { queryOne, execute, queryAll } = require('./database');

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
                protocolTimeout: 120000,
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
        this.client.on('ready', async () => {
            console.log('[BOT] ✅ WhatsApp conectado!');
            this.status = 'conectado';
            this.qrCodeData = null;
            this.info = this.client.info;
            console.log('[BOT] Número:', this.info?.wid?.user || 'desconhecido');
            
            // Aguarda 5s pro Chrome estabilizar antes de tentar enviar qualquer coisa
            await new Promise(r => setTimeout(r, 5000));
            try {
                const grupoSalvo = queryOne("SELECT valor FROM config WHERE chave = 'grupo_oficial'");
                if (grupoSalvo && grupoSalvo.valor) {
                    await this.client.sendMessage(grupoSalvo.valor, "🤖 *SISTEMA REINICIADO*\nFui atualizado e estou 100% online novamente! ✅");
                    console.log('[BOT] ✅ Mensagem de reinicialização enviada ao grupo.');
                } else {
                    console.log('[BOT] Nenhum grupo oficial salvo ainda.');
                }
            } catch (e) {
                console.log('[BOT] ⚠️ Não conseguiu enviar aviso de reinicialização:', e.message);
            }
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
            
            // Tratamento hiper-blindado pra checar se ele foi MENCIONADO com o @oficial do whatsapp
            let marcouOCelular = false;
            if (msg.mentionedIds && msg.mentionedIds.length > 0 && this.client && this.client.info && this.client.info.wid) {
                const meuNumeroBase = this.client.info.wid.user; // Pega só os números: Ex '556291234567'
                // Se algum dos IDs mencionados conter o número base do bot, foi marcado!
                marcouOCelular = msg.mentionedIds.some(id => id.includes(meuNumeroBase));
            }
            
            if (!marcouArroubaBot && !marcouOCelular) {
                return; // Ignora os papos furados do grupo e fica quieto sem quebrar.
            }
            
            // GRAVADOR DO GRUPO OFICIAL: Se ele foi marcado num grupo, guarda o ID desse grupo pra poder avisar depois!
            if (msg.from.endsWith('@g.us')) {
                 try {
                     execute("INSERT OR REPLACE INTO config (chave, valor) VALUES ('grupo_oficial', ?)", [msg.from]);
                 } catch(e){}
            }

            // ============================================
            // COMANDOS ESPECIAIS (antes da IA processar)
            // ============================================
            const textoComando = msg.body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            // FIXAR GRUPO DE ANÁPOLIS
            if (textoComando.includes('fixar anapolis')) {
                if (msg.from.endsWith('@g.us')) {
                    execute("INSERT OR REPLACE INTO config (chave, valor) VALUES ('grupo_anapolis', ?)", [msg.from]);
                    try {
                        await this.client.sendMessage(msg.from, '✅ *Grupo de Anápolis fixado com sucesso!*\n\nA partir de agora, todas as vendas registradas neste grupo serão vinculadas automaticamente ao Instagram de Anápolis! 📍\n\n📷 *Instagram configurado:* https://www.instagram.com/bitpeanapolis/\n🎵 *TikTok (igual pra todos):* https://www.tiktok.com/@bitpeoficial');
                    } catch(e) {}
                } else {
                    try {
                        await this.client.sendMessage(msg.from, '⚠️ Esse comando só funciona dentro de um grupo!');
                    } catch(e) {}
                }
                return;
            }
            
            // DESFIXAR GRUPO DE ANÁPOLIS
            if (textoComando.includes('desfixar anapolis')) {
                execute("DELETE FROM config WHERE chave = 'grupo_anapolis'");
                try {
                    await this.client.sendMessage(msg.from, '🔓 *Grupo de Anápolis desvinculado!*\nAgora nenhum grupo está marcado como Anápolis.');
                } catch(e) {}
                return;
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
1. VENDA: Se falarem que um ou MAIS clientes COMPRARAM (ex: "bot Lucas 629.. comprou babuche 41 e Maria 62... comprou salto"), extraia os dados de TODOS! Ação: "salvar_compra".
2. FALTA/LEAD: Se pedirem pra salvar um ou VÁRIOS contatos pq NÃO TINHA, a ação: "salvar_lead".
3. APAGAR: Para EXCLUIR um cliente ou número, ache o número no seu [CONTEXTO RECENTE] e retorne a ação "apagar_lead".
4. ESTATÍSTICA: Se perguntarem "Quantos numeros tem salvos?", responda que vai olhar as métricas. Ação "contar_leads".
5. LISTAR DADOS: Se falarem "mostre os dados", "mostre quem vc salvou" ou "liste os numeros", responda que vai gerar o arquivo. Ação "listar_dados".
6. ENSINAR USO: Se perguntarem "o que vc faz", ou "como te usar": diga à equipe que gerará um manual. Ação "explicar_uso".
7. LIXO: Mensagens indecifráveis geram ação "bloco_de_notas".

OBSERVAÇÃO DA RESPOSTA: Você deve ser natural e cirúrgico. Separe as informações para salvar. Se houver vários clientes, adicione TODOS na lista JSON.
Você é OBRIGADO a responder estritamente um JSON limpo e estruturado com a array 'clientes':
{
  "acao": "salvar_compra" ou "salvar_lead" ou "apagar_lead" ou "contar_leads" ou "listar_dados" ou "explicar_uso" ou "bloco_de_notas" ou "nenhuma_acao",
  "mensagem_para_grupo": "Sua resposta curta com emojis comunicando pro grupo a decisão.",
  "clientes": [
    {
      "telefone_extraido": "6299999999 se houver",
      "nome_cliente": "Nome do cliente se foi falado na frase (ex: Lucas)",
      "produto": "Apenas o nome do calçado (ex: Babuche Homem Aranha)",
      "numeracao": "Apenas o número do calçado (ex: 41)",
      "anotacao_stranha": "bizarrice para o bloco de notas"
    }
  ]
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

                    if (IA_Decisao.acao === 'salvar_compra' && Array.isArray(IA_Decisao.clientes) && IA_Decisao.clientes.length > 0) {
                        let disparosComSucesso = 0;
                        
                        // DETECTA SE A VENDA VEIO DO GRUPO DE ANÁPOLIS
                        const grupoAnapolis = queryOne("SELECT valor FROM config WHERE chave = 'grupo_anapolis'");
                        const ehAnapolis = grupoAnapolis && grupoAnapolis.valor === msg.from;
                        const instagramLink = ehAnapolis 
                            ? 'https://www.instagram.com/bitpeanapolis/' 
                            : 'https://www.instagram.com/bitpecalcados/';
                        if (ehAnapolis) console.log('[MOTOR] 📍 Venda detectada no grupo de ANÁPOLIS — usando Instagram local.');
                        
                        for (const cliente of IA_Decisao.clientes) {
                            if (!cliente.telefone_extraido) continue;
                            const numLimpo = limparNumeroBR(cliente.telefone_extraido);
                            const nomeInfo = cliente.nome_cliente || "";
                            const prodInfo = cliente.produto || "seu calçado";
                            const numInfo = cliente.numeracao || "";
                            
                            const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                            const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                            
                            execute("INSERT INTO compras (telefone, nome_cliente, produto, numeracao, data_compra, hora_compra) VALUES (?, ?, ?, ?, ?, ?)", [numLimpo, nomeInfo, prodInfo, numInfo, data, hora]);
                            
                            const wppAgradece = `Oi${nomeInfo ? ' '+nomeInfo : ''}! 👋 Aqui é a equipe da *BitPé Calçados*! 🦶✨\n\nPassando apenas para agradecer imensamente pela sua compra! 💜 Ficamos muito felizes com a sua preferência.\n\n📲 *Siga a gente para ficar por dentro das novidades!*\nPara acompanhar os próximos lançamentos e também garantir nossas promoções, não deixe de seguir nossas redes oficiais:\n\n📷 *Instagram:* ${instagramLink}\n🎵 *TikTok:* https://www.tiktok.com/@bitpeoficial\n\nQualquer dúvida, estaremos sempre à sua disposição. Um abração da equipe!`;
                            
                            try {
                                const idOficialWhatsapp = await this.client.getNumberId(numLimpo);
                                if (idOficialWhatsapp) {
                                    await this.client.sendMessage(idOficialWhatsapp._serialized, wppAgradece);
                                    disparosComSucesso++;
                                }
                            } catch (e) {
                                console.error(`[MOTOR] ❌ PV falhou para ${numLimpo}:`, e.message);
                            }
                        }
                        
                        if (disparosComSucesso > 0) {
                            infoMsgParaEnviarDepois = `✅ *Notificação do Módulo de Disparo:*\nSalvei os dados no Banco e enviei a mensagem de Boas Vindas com sucesso no PV de ${disparosComSucesso} cliente(s)! 🚀`;
                        } else {
                            infoMsgParaEnviarDepois = `⚠️ *Notificação:*\nOs clientes foram salvos no Banco de Dados, porém falhamos ao tentar enviar mensagem no PV deles no momento.`;
                        }
                    }
                    else if (IA_Decisao.acao === 'salvar_lead' && Array.isArray(IA_Decisao.clientes)) {
                        for (const cliente of IA_Decisao.clientes) {
                            if (!cliente.telefone_extraido) continue;
                            const numLimpo = limparNumeroBR(cliente.telefone_extraido);
                            const prodInfo = cliente.produto || "";
                            const existe = queryOne("SELECT id FROM leads WHERE telefone = ?", [numLimpo]);
                            if (!existe) execute("INSERT INTO leads (telefone, observacao_ou_produto) VALUES (?, ?)", [numLimpo, prodInfo]);
                        }
                    } 
                    else if (IA_Decisao.acao === 'apagar_lead' && Array.isArray(IA_Decisao.clientes)) {
                        for (const cliente of IA_Decisao.clientes) {
                            if (!cliente.telefone_extraido) continue;
                            const numLimpo = limparNumeroBR(cliente.telefone_extraido);
                            const numPuro = numLimpo.replace(/^55/, ''); 
                            execute("DELETE FROM leads WHERE telefone = ? OR telefone = ? OR telefone LIKE ?", [numLimpo, numPuro, `%${numPuro}`]);
                            execute("DELETE FROM compras WHERE telefone = ? OR telefone = ? OR telefone LIKE ?", [numLimpo, numPuro, `%${numPuro}`]);
                        }
                    }
                    else if (IA_Decisao.acao === 'bloco_de_notas' && Array.isArray(IA_Decisao.clientes)) {
                        for (const cliente of IA_Decisao.clientes) {
                            if (cliente.anotacao_stranha) execute("INSERT INTO bloco_notas (anotacao) VALUES (?)", [cliente.anotacao_stranha]);
                        }
                    }
                    else if (IA_Decisao.acao === 'contar_leads') {
                        const countLeads = queryOne("SELECT COUNT(*) as total FROM leads");
                        const countCompras = queryOne("SELECT COUNT(*) as total FROM compras");
                        infoMsgParaEnviarDepois = `📊 *MÉTRICAS GERAIS:*\n\n✅ Vendas Concluídas: ${countCompras ? countCompras.total : 0}\n⚠️ Leads de Estoque: ${countLeads ? countLeads.total : 0}`;
                    }
                    else if (IA_Decisao.acao === 'listar_dados') {
                        const ultimasCompras = queryAll("SELECT telefone, nome_cliente, produto, numeracao, data_compra, hora_compra FROM compras ORDER BY id DESC LIMIT 5");
                        const ultimosLeads = queryAll("SELECT telefone, observacao_ou_produto, created_at FROM leads ORDER BY id DESC LIMIT 5");
                        
                        let txtListagem = '📋 *ÚLTIMOS REGISTROS NA BASE DE DADOS*\n\n📦 *ÚLTIMAS 5 VENDAS SALVAS:*\n';
                        ultimasCompras.forEach(c => {
                            txtListagem += '\n👤 *' + (c.nome_cliente || 'Cliente Sem Nome') + '*\n📱 Tel: ' + c.telefone + '\n👞 Produto: ' + c.produto + ' (Nº ' + c.numeracao + ')\n🕑 Ref: ' + (c.data_compra || 'S/Data') + ' às ' + (c.hora_compra || 'S/Hora') + '\n';
                        });
                        if (ultimasCompras.length === 0) txtListagem += '\nNenhuma compra recente.\n';

                        txtListagem += '\n⚠️ *ÚLTIMOS 5 LEADS (Sem Estoque):*\n';
                        ultimosLeads.forEach(l => {
                            let data_lead = l.created_at ? l.created_at.split(' ')[0].split('-').reverse().join('/') : 'Hoje';
                            txtListagem += '\n👤 Tel: ' + l.telefone + '\n👞 Falta: ' + l.observacao_ou_produto + '\n🕑 Ref: ' + data_lead + '\n';
                        });
                        if (ultimosLeads.length === 0) txtListagem += '\nNenhum lead de falta recente.';

                        infoMsgParaEnviarDepois = txtListagem;
                    }
                    else if (IA_Decisao.acao === 'explicar_uso') {
                        infoMsgParaEnviarDepois = `🤖 *COMO TRABALHAR COMIGO (MANUAL RÁPIDO):*\n\n1️⃣ Sempre escreva *@bot* na mensagem para eu acordar.\n2️⃣ Informe: *Nome do Cliente, Produto, Numeração e Celular*.\n\n*Exemplo:* @bot, Maria comprou tênis 35. Cel dela: 62 9...\n\n3️⃣ *Aviso Importante:* Eu não consigo ouvir áudios e nem entender imagens ainda. Preciso que a equipe digite as informações em texto! 😉`;
                    }

                    // 1. O Bot envia a resposta natural no grupo primeiro
                    try {
                        if (IA_Decisao.mensagem_para_grupo) {
                            await this.client.sendMessage(msg.from, IA_Decisao.mensagem_para_grupo);
                            this.memoriaConversa.push(IA_Decisao.mensagem_para_grupo);
                        }
                    } catch (envioErr) {
                        console.error('[MOTOR] ⚠️ Falha ao enviar resposta da IA no grupo:', envioErr.message);
                    }
                    
                    // 2. O Node.js envia os dados Puros logo em seguida
                    if (infoMsgParaEnviarDepois) {
                        try {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            await this.client.sendMessage(msg.from, infoMsgParaEnviarDepois);
                            this.memoriaConversa.push(infoMsgParaEnviarDepois);
                        } catch (envioErr2) {
                            console.error('[MOTOR] ⚠️ Falha ao enviar dados complementares:', envioErr2.message);
                        }
                    }

                } catch (e) {
                    console.error('[MOTOR] ❌ Erro interno do Motor:', e.message);
                    try { await this.client.sendMessage(msg.from, 'Ops, tive um pequeno solavanco interno!'); } catch(x) {}
                }
            } catch (erro) {
                console.error('[WHATSAPP] O Cérebro deu tela azul:', erro.message);
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
