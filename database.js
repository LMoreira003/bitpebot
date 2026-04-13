const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'botbitpe.db');

let db = null;

// Salva o banco no disco periodicamente
function salvarBanco() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    } catch (err) {
        console.error('[DB] Erro ao salvar banco:', err);
    }
}

// Auto-save a cada 10 segundos
setInterval(salvarBanco, 10000);

// Garante salvamento ao fechar
process.on('exit', salvarBanco);
process.on('SIGINT', () => { salvarBanco(); process.exit(); });
process.on('SIGTERM', () => { salvarBanco(); process.exit(); });

async function initDB() {
    const SQL = await initSqlJs();

    // Carrega banco existente ou cria novo
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('[DB] Banco de dados carregado de', DB_PATH);
    } else {
        db = new SQL.Database();
        console.log('[DB] Novo banco de dados criado');
    }

    // Cria tabelas
    db.run(`
        CREATE TABLE IF NOT EXISTS compras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefone TEXT NOT NULL,
            nome_cliente TEXT DEFAULT '',
            produto TEXT NOT NULL,
            numeracao TEXT DEFAULT '',
            data_compra TEXT NOT NULL,
            hora_compra TEXT NOT NULL,
            valor TEXT DEFAULT '',
            status_mensagem TEXT DEFAULT 'pendente',
            data_envio TEXT DEFAULT NULL,
            erro_envio TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telefone TEXT NOT NULL,
            observacao_ou_produto TEXT DEFAULT '',
            status_mensagem TEXT DEFAULT 'pendente',
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bloco_notas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anotacao TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS config (
            chave TEXT PRIMARY KEY,
            valor TEXT NOT NULL
        )
    `);

    // Insere configurações padrão se não existirem
    const defaults = [
        ['mensagem_template', `Oi! 👋 Aqui é a equipe *BitPé*! 🦶✨

Muito obrigado pela sua compra! 💜

📦 Seu pedido: *{produto} — Nº {numeracao}*
🕐 Registrado em: {data} às {hora}

Ficamos felizes demais que você escolheu a BitPé!

🎁 *QUER 10% DE DESCONTO na próxima compra?*

É só nos seguir:
📸 Instagram: https://instagram.com/bitpecalcados
🎵 TikTok: https://tiktok.com/@bitpeoficial

Depois de seguir, manda um print aqui que a gente te envia o cupom! 🔥

Qualquer dúvida, estamos aqui! 🤝`],
        ['instagram_url', 'https://instagram.com/bitpecalcados'],
        ['tiktok_url', 'https://tiktok.com/@bitpeoficial'],
        ['delay_entre_msgs', '8000'],
        ['envio_automatico', 'true']
    ];

    const stmt = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
    defaults.forEach(([chave, valor]) => {
        stmt.run([chave, valor]);
    });
    stmt.free();

    salvarBanco();
    console.log('[DB] Tabelas e configurações inicializadas');

    return db;
}

// Helper: executa query e retorna array de objetos
function queryAll(sql, params = []) {
    if (!db) throw new Error('Banco não inicializado');
    const stmt = db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

// Helper: executa query e retorna primeiro resultado
function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

// Helper: executa INSERT/UPDATE/DELETE e retorna info
function execute(sql, params = []) {
    if (!db) throw new Error('Banco não inicializado');
    db.run(sql, params);
    const changes = db.getRowsModified();
    const lastId = queryOne('SELECT last_insert_rowid() as id');
    salvarBanco();
    return { changes, lastInsertRowid: lastId ? lastId.id : null };
}

module.exports = { initDB, queryAll, queryOne, execute, salvarBanco };
