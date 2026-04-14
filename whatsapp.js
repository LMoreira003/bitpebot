const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { queryOne, execute, queryAll } = require('./database');

// ============================================
// CONFIGURAÇÃO DAS LOJAS / QUIOSQUES
// ============================================
const LOJAS_CONFIG = {
    'anapolis': { nome: 'Anápolis', instagram: 'https://www.instagram.com/bitpeanapolis/', whatsapp: '556293195634' },
    'cerrado':  { nome: 'Cerrado',  instagram: 'https://www.instagram.com/bitpe_cerrado/', whatsapp: '556294113866' },
    'portal':   { nome: 'Portal',   instagram: 'https://www.instagram.com/bitpecalcados/', whatsapp: '556292525532' }
};
const INSTAGRAM_PADRAO = 'https://www.instagram.com/bitpecalcados/';
const WHATSAPP_PADRAO = '556292525532';
const TIKTOK_PADRAO = 'https://www.tiktok.com/@bitpeoficial';

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
                const grupos = queryAll("SELECT grupo_id FROM grupos_ativos");
                if (grupos.length > 0) {
                    for (const grupo of grupos) {
                        try {
                            await this.client.sendMessage(grupo.grupo_id, "🤖 *SISTEMA REINICIADO*\nFui atualizado e estou 100% online novamente! ✅");
                        } catch(e) {
                            console.log(`[BOT] ⚠️ Falha ao notificar grupo ${grupo.grupo_id}:`, e.message);
                        }
                        await new Promise(r => setTimeout(r, 2000));
                    }
                    console.log(`[BOT] ✅ Mensagem de reinicialização enviada para ${grupos.length} grupo(s).`);
                } else {
                    console.log('[BOT] Nenhum grupo ativo registrado ainda.');
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
            
            // REGISTRA O GRUPO NA LISTA DE GRUPOS ATIVOS (para avisar todos no restart)
            if (msg.from.endsWith('@g.us')) {
                 try {
                     execute("INSERT OR IGNORE INTO grupos_ativos (grupo_id) VALUES (?)", [msg.from]);
                 } catch(e){}
            }

            // ============================================
            // COMANDOS ESPECIAIS (antes da IA processar)
            // Esses comandos NÃO passam pela IA — são hardcoded e instantâneos
            // ============================================
            const textoComando = msg.body.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            // FIXAR LOJA (genérico: @bot fixar portal / cerrado / anapolis)
            const matchFixar = textoComando.match(/fixar\s+(anapolis|cerrado|portal)/);
            if (matchFixar) {
                const lojaKey = matchFixar[1];
                const lojaConfig = LOJAS_CONFIG[lojaKey];
                if (msg.from.endsWith('@g.us') && lojaConfig) {
                    // Remove vinculação anterior deste grupo (se tinha)
                    execute("DELETE FROM lojas WHERE grupo_id = ?", [msg.from]);
                    // Insere nova vinculação com todos os dados da loja
                    execute("INSERT INTO lojas (grupo_id, nome, instagram_url, whatsapp_contato) VALUES (?, ?, ?, ?)", 
                        [msg.from, lojaConfig.nome, lojaConfig.instagram, lojaConfig.whatsapp]);
                    try {
                        await this.client.sendMessage(msg.from, 
                            `✅ *Grupo fixado como ${lojaConfig.nome}!*\n\n` +
                            `📷 *Instagram:* ${lojaConfig.instagram}\n` +
                            `🎵 *TikTok:* ${TIKTOK_PADRAO}\n` +
                            `💬 *WhatsApp equipe:* https://wa.me/${lojaConfig.whatsapp}\n\n` +
                            `A partir de agora, todas as vendas e leads deste grupo serão vinculados à loja *${lojaConfig.nome}*. 📍`);
                    } catch(e) {}
                } else if (!msg.from.endsWith('@g.us')) {
                    try {
                        await this.client.sendMessage(msg.from, '⚠️ Esse comando só funciona dentro de um grupo!');
                    } catch(e) {}
                }
                return;
            }
            
            // DESFIXAR LOJA
            if (textoComando.includes('desfixar')) {
                execute("DELETE FROM lojas WHERE grupo_id = ?", [msg.from]);
                try {
                    await this.client.sendMessage(msg.from, '🔓 *Grupo desvinculado!*\nEste grupo não está mais associado a nenhuma loja.');
                } catch(e) {}
                return;
            }

            // ============================================
            // COMANDO SECRETO: ADMIN GERAL
            // Não passa pela IA, a IA não sabe que isso existe
            // ============================================
            if (textoComando.includes('admin geral')) {
                try {
                    const totalCompras = queryOne("SELECT COUNT(*) as total FROM compras");
                    const totalLeads = queryOne("SELECT COUNT(*) as total FROM leads");
                    const lojas = queryAll("SELECT * FROM lojas");
                    
                    let txt = '🔒 *PAINEL ADMINISTRATIVO GERAL*\n\n';
                    txt += `📊 *TOTAIS GLOBAIS:*\n`;
                    txt += `✅ Vendas: ${totalCompras ? totalCompras.total : 0}\n`;
                    txt += `⚠️ Leads: ${totalLeads ? totalLeads.total : 0}\n`;
                    
                    // Dados de cada loja registrada
                    if (lojas.length > 0) {
                        txt += `\n📍 *LOJAS REGISTRADAS (${lojas.length}):*\n`;
                        for (const loja of lojas) {
                            const vendas = queryOne("SELECT COUNT(*) as total FROM compras WHERE loja_origem = ?", [loja.nome.toLowerCase()]);
                            const leads = queryOne("SELECT COUNT(*) as total FROM leads WHERE loja_origem = ?", [loja.nome.toLowerCase()]);
                            txt += `\n🏪 *${loja.nome}*\n`;
                            txt += `   📷 ${loja.instagram_url}\n`;
                            txt += `   ✅ Vendas: ${vendas ? vendas.total : 0} | ⚠️ Leads: ${leads ? leads.total : 0}\n`;
                        }
                    } else {
                        txt += `\n⚠️ Nenhuma loja fixada ainda.\n`;
                    }
                    
                    // Dados sem loja vinculada
                    const vendasGeral = queryOne("SELECT COUNT(*) as total FROM compras WHERE loja_origem = 'geral'");
                    const leadsGeral = queryOne("SELECT COUNT(*) as total FROM leads WHERE loja_origem = 'geral'");
                    if ((vendasGeral && vendasGeral.total > 0) || (leadsGeral && leadsGeral.total > 0)) {
                        txt += `\n🏢 *Sem loja vinculada (geral):*\n`;
                        txt += `   ✅ Vendas: ${vendasGeral ? vendasGeral.total : 0} | ⚠️ Leads: ${leadsGeral ? leadsGeral.total : 0}\n`;
                    }

                    // Últimas 5 vendas globais
                    const ultimas = queryAll("SELECT telefone, nome_cliente, produto, numeracao, data_compra, loja_origem FROM compras ORDER BY id DESC LIMIT 5");
                    if (ultimas.length > 0) {
                        txt += '\n📦 *ÚLTIMAS 5 VENDAS (GLOBAL):*\n';
                        for (const c of ultimas) {
                            txt += `\n👤 *${c.nome_cliente || 'Sem Nome'}* | 📱 ${c.telefone}\n`;
                            txt += `   👞 ${c.produto} (Nº ${c.numeracao}) | 🏪 ${c.loja_origem || 'geral'}\n`;
                            txt += `   🕑 ${c.data_compra || 'S/Data'}\n`;
                        }
                    }

                    await this.client.sendMessage(msg.from, txt);
                } catch(e) {
                    console.error('[ADMIN] Erro no painel geral:', e.message);
                    try { await this.client.sendMessage(msg.from, '❌ Erro ao gerar painel administrativo.'); } catch(x) {}
                }
                return;
            }

            // ============================================
            // A PARTIR DAQUI: TUDO PASSA PELA IA
            // ============================================

            console.log(`\n======================================================`);
            console.log(`[TESTE V2] 🔔 GATILHO ACIONADO POR ${msg.from}!`);
            console.log(`[TESTE V2] 📩 MENSAGEM LIDA: "${msg.body}"`);
            console.log(`======================================================`);

            // IDENTIFICA A LOJA DO GRUPO ATUAL (usado em todo o motor)
            const lojaAtual = queryOne("SELECT * FROM lojas WHERE grupo_id = ?", [msg.from]);
            const lojaOrigem = lojaAtual ? lojaAtual.nome.toLowerCase() : 'geral';
            const instagramDaLoja = lojaAtual ? lojaAtual.instagram_url : INSTAGRAM_PADRAO;
            if (lojaAtual) console.log(`[MOTOR] 📍 Grupo identificado como loja: ${lojaAtual.nome}`);

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
                        
                        for (const cliente of IA_Decisao.clientes) {
                            if (!cliente.telefone_extraido) continue;
                            const numLimpo = limparNumeroBR(cliente.telefone_extraido);
                            const nomeInfo = cliente.nome_cliente || "";
                            const prodInfo = cliente.produto || "seu calçado";
                            const numInfo = cliente.numeracao || "";
                            
                            const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                            const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                            
                            // SALVA COM A LOJA DE ORIGEM
                            execute("INSERT INTO compras (telefone, nome_cliente, produto, numeracao, data_compra, hora_compra, loja_origem) VALUES (?, ?, ?, ?, ?, ?, ?)", [numLimpo, nomeInfo, prodInfo, numInfo, data, hora, lojaOrigem]);
                            
                            // MENSAGEM DINÂMICA COM INSTAGRAM + WHATSAPP DA LOJA CORRETA
                            const whatsappDaLoja = lojaAtual ? (lojaAtual.whatsapp_contato || WHATSAPP_PADRAO) : WHATSAPP_PADRAO;
                            const wppAgradece = `Oi${nomeInfo ? ' '+nomeInfo : ''}! 👋 Aqui é a equipe da *BitPé Calçados*! 🦶✨\n\nPassando apenas para agradecer imensamente pela sua compra! 💜 Ficamos muito felizes com a sua preferência.\n\n📲 *Siga a gente para ficar por dentro das novidades!*\nPara acompanhar os próximos lançamentos e também garantir nossas promoções, não deixe de seguir nossas redes oficiais:\n\n📷 *Instagram:* ${instagramDaLoja}\n🎵 *TikTok:* ${TIKTOK_PADRAO}\n\n💬 *Fale com a nossa equipe:* https://wa.me/${whatsappDaLoja}\n\nQualquer dúvida, estaremos sempre à sua disposição. Um abração da equipe!`;
                            
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
                            const existe = queryOne("SELECT id FROM leads WHERE telefone = ? AND loja_origem = ?", [numLimpo, lojaOrigem]);
                            if (!existe) execute("INSERT INTO leads (telefone, observacao_ou_produto, loja_origem) VALUES (?, ?, ?)", [numLimpo, prodInfo, lojaOrigem]);
                        }
                    } 
                    else if (IA_Decisao.acao === 'apagar_lead' && Array.isArray(IA_Decisao.clientes)) {
                        for (const cliente of IA_Decisao.clientes) {
                            if (!cliente.telefone_extraido) continue;
                            const numLimpo = limparNumeroBR(cliente.telefone_extraido);
                            const numPuro = numLimpo.replace(/^55/, ''); 
                            // Apaga só da loja do grupo (ou geral se não tem loja)
                            execute("DELETE FROM leads WHERE (telefone = ? OR telefone = ? OR telefone LIKE ?) AND loja_origem = ?", [numLimpo, numPuro, `%${numPuro}`, lojaOrigem]);
                            execute("DELETE FROM compras WHERE (telefone = ? OR telefone = ? OR telefone LIKE ?) AND loja_origem = ?", [numLimpo, numPuro, `%${numPuro}`, lojaOrigem]);
                        }
                    }
                    else if (IA_Decisao.acao === 'bloco_de_notas' && Array.isArray(IA_Decisao.clientes)) {
                        for (const cliente of IA_Decisao.clientes) {
                            if (cliente.anotacao_stranha) execute("INSERT INTO bloco_notas (anotacao) VALUES (?)", [cliente.anotacao_stranha]);
                        }
                    }
                    else if (IA_Decisao.acao === 'contar_leads') {
                        // FILTRADO POR LOJA DO GRUPO
                        const countLeads = queryOne("SELECT COUNT(*) as total FROM leads WHERE loja_origem = ?", [lojaOrigem]);
                        const countCompras = queryOne("SELECT COUNT(*) as total FROM compras WHERE loja_origem = ?", [lojaOrigem]);
                        const nomeLoja = lojaAtual ? lojaAtual.nome.toUpperCase() : 'GERAL';
                        infoMsgParaEnviarDepois = `📊 *MÉTRICAS — ${nomeLoja}:*\n\n✅ Vendas Concluídas: ${countCompras ? countCompras.total : 0}\n⚠️ Leads de Estoque: ${countLeads ? countLeads.total : 0}`;
                    }
                    else if (IA_Decisao.acao === 'listar_dados') {
                        // FILTRADO POR LOJA DO GRUPO
                        const ultimasCompras = queryAll("SELECT telefone, nome_cliente, produto, numeracao, data_compra, hora_compra FROM compras WHERE loja_origem = ? ORDER BY id DESC LIMIT 5", [lojaOrigem]);
                        const ultimosLeads = queryAll("SELECT telefone, observacao_ou_produto, created_at FROM leads WHERE loja_origem = ? ORDER BY id DESC LIMIT 5", [lojaOrigem]);
                        
                        const nomeLoja = lojaAtual ? lojaAtual.nome.toUpperCase() : 'GERAL';
                        let txtListagem = `📋 *REGISTROS — ${nomeLoja}*\n\n📦 *ÚLTIMAS 5 VENDAS:*\n`;
                        ultimasCompras.forEach(c => {
                            txtListagem += '\n👤 *' + (c.nome_cliente || 'Cliente Sem Nome') + '*\n📱 Tel: ' + c.telefone + '\n👞 Produto: ' + c.produto + ' (Nº ' + c.numeracao + ')\n🕑 Ref: ' + (c.data_compra || 'S/Data') + ' às ' + (c.hora_compra || 'S/Hora') + '\n';
                        });
                        if (ultimasCompras.length === 0) txtListagem += '\nNenhuma venda registrada ainda.\n';

                        txtListagem += '\n⚠️ *ÚLTIMOS 5 LEADS (Sem Estoque):*\n';
                        ultimosLeads.forEach(l => {
                            let data_lead = l.created_at ? l.created_at.split(' ')[0].split('-').reverse().join('/') : 'Hoje';
                            txtListagem += '\n👤 Tel: ' + l.telefone + '\n👞 Falta: ' + l.observacao_ou_produto + '\n🕑 Ref: ' + data_lead + '\n';
                        });
                        if (ultimosLeads.length === 0) txtListagem += '\nNenhum lead registrado ainda.';

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
