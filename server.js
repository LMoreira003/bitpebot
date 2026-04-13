const express = require('express');
const path = require('path');
const { initDB, queryAll, queryOne, execute } = require('./database');
const bot = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3333;

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ================================================
// API — Status do WhatsApp
// ================================================
// Rota fantasma para o Cron-Job ficar "cutucando" a Render pra não dormir!
app.get('/api/ping', (req, res) => {
    res.status(200).send("Estou acordado!");
});

app.get('/api/status', (req, res) => {
    res.json(bot.getStatus());
});

// ================================================
// TELA VISUAL PARA LER O QR CODE RÁPIDO:
// ================================================
app.get('/qr', (req, res) => {
    const infos = bot.getStatus();
    if (infos.status === 'aguardando_qr' && infos.qrCode) {
        res.send(`
            <html lang="pt-br">
            <body style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background-color:#121212; color:white; font-family:sans-serif; margin:0;">
                <h2>📱 Leia o QR Code Rapidamente!</h2>
                <img src="${infos.qrCode}" style="border-radius:10px; width:300px; height:300px; border:4px solid #00a884; padding:10px; background:white;"/>
                <p>Tempo esgota rápido. Se falhar, dê F5 (Atualizar) na página.</p>
                <script>
                    // A página atualizará sozinha a cada 15 segundos pra você não perder o QR fresquinho!
                    setTimeout(() => window.location.reload(), 15000);
                </script>
            </body>
            </html>
        `);
    } else if (infos.status === 'conectado') {
        res.send("<body style='background:#121212; color:#00a884; display:flex; justify-content:center; align-items:center; height:100vh;'><h1>✅ WhatsApp Conectado e Vivo!</h1></body>");
    } else {
        res.send("<body style='background:#121212; color:white; display:flex; justify-content:center; align-items:center; height:100vh;'><h2>O Bot está aquecendo... Aguarde 10 segundos e dê F5.</h2></body>");
    }
});

// Reconectar WhatsApp
app.post('/api/reconectar', async (req, res) => {
    try {
        await bot.reiniciar();
        res.json({ sucesso: true, msg: 'Reinicializando bot...' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Desconectar WhatsApp
app.post('/api/desconectar', async (req, res) => {
    try {
        await bot.desconectar();
        res.json({ sucesso: true, msg: 'Bot desconectado' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ================================================
// API — Compras (CRUD)
// ================================================

// Listar compras
app.get('/api/compras', (req, res) => {
    try {
        const compras = queryAll('SELECT * FROM compras ORDER BY id DESC');
        res.json(compras);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Estatísticas
app.get('/api/stats', (req, res) => {
    try {
        const total = queryOne('SELECT COUNT(*) as count FROM compras').count;
        const enviadas = queryOne("SELECT COUNT(*) as count FROM compras WHERE status_mensagem = 'enviada'").count;
        const pendentes = queryOne("SELECT COUNT(*) as count FROM compras WHERE status_mensagem = 'pendente'").count;
        const falhas = queryOne("SELECT COUNT(*) as count FROM compras WHERE status_mensagem = 'falha'").count;
        const hoje = new Date().toISOString().split('T')[0];
        const comprasHoje = queryOne("SELECT COUNT(*) as count FROM compras WHERE date(created_at) = ?", [hoje]).count;

        res.json({ total, enviadas, pendentes, falhas, comprasHoje });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Adicionar compra
app.post('/api/compras', (req, res) => {
    try {
        const { telefone, nome_cliente, produto, numeracao, data_compra, hora_compra, valor } = req.body;

        if (!telefone || !produto) {
            return res.status(400).json({ erro: 'Telefone e produto são obrigatórios' });
        }

        const result = execute(`
            INSERT INTO compras (telefone, nome_cliente, produto, numeracao, data_compra, hora_compra, valor)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [telefone, nome_cliente || '', produto, numeracao || '', data_compra || '', hora_compra || '', valor || '']);

        const compraId = result.lastInsertRowid;

        // Verifica se envio automático está ativo
        const autoEnvio = queryOne("SELECT valor FROM config WHERE chave = 'envio_automatico'");
        if (autoEnvio?.valor === 'true' && bot.status === 'conectado') {
            bot.adicionarNaFila(compraId);
        }

        res.json({ sucesso: true, id: compraId, autoEnvio: autoEnvio?.valor === 'true' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Deletar compra
app.delete('/api/compras/:id', (req, res) => {
    try {
        execute('DELETE FROM compras WHERE id = ?', [parseInt(req.params.id)]);
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Reenviar mensagem
app.post('/api/compras/:id/reenviar', async (req, res) => {
    try {
        execute("UPDATE compras SET status_mensagem = 'pendente', erro_envio = NULL WHERE id = ?", [parseInt(req.params.id)]);
        bot.adicionarNaFila(parseInt(req.params.id));
        res.json({ sucesso: true, msg: 'Adicionado à fila de envio' });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// Enviar mensagem manual
app.post('/api/compras/:id/enviar', async (req, res) => {
    try {
        await bot.enviarMensagem(parseInt(req.params.id));
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ================================================
// API — Configurações
// ================================================

app.get('/api/config', (req, res) => {
    try {
        const configs = queryAll('SELECT * FROM config');
        const obj = {};
        configs.forEach(c => obj[c.chave] = c.valor);
        res.json(obj);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

app.put('/api/config', (req, res) => {
    try {
        const updates = req.body;
        for (const [chave, valor] of Object.entries(updates)) {
            execute('INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)', [chave, valor]);
        }
        res.json({ sucesso: true });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
});

// ================================================
// Inicialização (async por causa do sql.js)
// ================================================
async function start() {
    try {
        await initDB();
        console.log('[DB] ✅ Banco de dados pronto');

        app.listen(PORT, () => {
            console.log(`\n🦶 BitPé Bot — Servidor rodando em http://localhost:${PORT}\n`);
            bot.inicializar();
        });
    } catch (err) {
        console.error('[FATAL] Erro ao iniciar:', err);
        process.exit(1);
    }
}

start();
