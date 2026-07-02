/**
 * Due Diligence - Security & Compliance Server (Node.js + Express)
 * Handles dual database (SQLite / MariaDB) and file uploads.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const XLSX = require('xlsx');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'"
        ].join('; ')
    );
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    next();
});

// Create uploads directory if it doesn't exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const UPDATES_DIR = path.join(__dirname, 'updates');
if (!fs.existsSync(UPDATES_DIR)) {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
}

// Serve only the public frontend assets. Avoid exposing the SQLite DB,
// Excel template, source maps, package files, or other local artifacts.
const PUBLIC_FILES = ['index.html', 'app.js', 'styles.css', 'CFC.png'];
PUBLIC_FILES.forEach((fileName) => {
    const route = fileName === 'index.html' ? '/' : `/${fileName}`;
    app.get(route, (req, res) => res.sendFile(path.join(__dirname, fileName)));
});
app.use('/uploads', requireAuth, express.static(UPLOADS_DIR));

// Configure Multer for evidence file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        // Sanitize and create a unique name
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + cleanName);
    }
});
const allowedEvidenceExtensions = new Set([
    '.pdf', '.doc', '.docx', '.csv', '.txt',
    '.png', '.jpg', '.jpeg', '.webp', '.zip', '.rar', '.7z'
]);
const upload = multer({
    storage,
    limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedEvidenceExtensions.has(ext)) {
            return cb(new Error('Tipo de archivo no permitido para evidencia.'));
        }
        cb(null, true);
    }
});

const updateStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPDATES_DIR),
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + '-' + cleanName);
    }
});
const allowedUpdateExtensions = new Set(['.zip', '.sql', '.json', '.md', '.txt']);
const updateUpload = multer({
    storage: updateStorage,
    limits: { fileSize: Number(process.env.MAX_UPDATE_MB || 100) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedUpdateExtensions.has(ext)) {
            return cb(new Error('Tipo de paquete de actualizacion no permitido.'));
        }
        cb(null, true);
    }
});

const logoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOADS_DIR),
        filename: (req, file, cb) => {
            const cleanName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, `brand-${uniqueSuffix}-${cleanName}`);
        }
    }),
    limits: { fileSize: Number(process.env.MAX_LOGO_MB || 5) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
            return cb(new Error('Tipo de logo no permitido. Use PNG, JPG o WEBP.'));
        }
        cb(null, true);
    }
});

// --- DATABASE MANAGER ---
const DEFAULT_DB_NAME = process.env.DB_NAME || 'SBSEPS';
const DEFAULT_DB_USER = process.env.DB_USER || 'seguridadinf';
const DEFAULT_DB_PASSWORD = process.env.DB_PASSWORD || 'seguridadinf';
const SESSION_COOKIE = 'sbseps_session';
const CAPTCHA_COOKIE = 'sbseps_captcha';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_SECRET = process.env.SESSION_SECRET || 'change-this-secret-in-production';
const sessions = new Map();
const allowedRoles = new Set(['admin', 'auditor', 'tecnico', 'revisor', 'informes']);

let dbType = process.env.DB_HOST ? 'mariadb' : 'sqlite';
let dbPool = null; // MySQL Pool
let sqliteDb = null; // SQLite connection

function isHttpsRequest(req) {
    return Boolean(req?.secure || req?.headers?.['x-forwarded-proto'] === 'https');
}

function shouldUseSecureCookies(req) {
    if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true') return true;
    if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'false') return false;
    return isHttpsRequest(req);
}

function parseCookies(req) {
    return String(req.headers.cookie || '').split(';').reduce((acc, part) => {
        const idx = part.indexOf('=');
        if (idx > -1) {
            acc[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
        }
        return acc;
    }, {});
}

function signValue(value) {
    return crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
}

function encodeSignedCookie(value) {
    return `${value}.${signValue(value)}`;
}

function decodeSignedCookie(value) {
    const raw = String(value || '');
    const idx = raw.lastIndexOf('.');
    if (idx < 1) return null;
    const payload = raw.slice(0, idx);
    const signature = raw.slice(idx + 1);
    const expected = signValue(payload);
    if (signature.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? payload : null;
}

function setCookie(req, res, name, value, options = {}) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/'
    ];
    if (shouldUseSecureCookies(req)) parts.push('Secure');
    if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
    const nextCookie = parts.join('; ');
    const current = res.getHeader('Set-Cookie');
    if (!current) {
        res.setHeader('Set-Cookie', nextCookie);
    } else if (Array.isArray(current)) {
        res.setHeader('Set-Cookie', [...current, nextCookie]);
    } else {
        res.setHeader('Set-Cookie', [current, nextCookie]);
    }
}

function clearCookie(req, res, name) {
    setCookie(req, res, name, '', { maxAge: 0 });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
    return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
    const { hash } = hashPassword(password, salt);
    if (hash.length !== String(expectedHash || '').length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

async function initDatabase() {
    if (dbType === 'mariadb') {
        const mysql = require('mysql2/promise');
        try {
            const bootstrap = await mysql.createConnection({
                host: process.env.DB_HOST,
                user: DEFAULT_DB_USER,
                password: DEFAULT_DB_PASSWORD,
                port: process.env.DB_PORT || 3306,
                multipleStatements: false
            });
            await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DEFAULT_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            await bootstrap.end();

            dbPool = mysql.createPool({
                host: process.env.DB_HOST,
                user: DEFAULT_DB_USER,
                password: DEFAULT_DB_PASSWORD,
                database: DEFAULT_DB_NAME,
                port: process.env.DB_PORT || 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
            // Test connection
            const connection = await dbPool.getConnection();
            connection.release();
            console.log('Database Connection: Connected to MariaDB/MySQL successfully.');
        } catch (err) {
            console.error('Database connection failed. Falling back to local SQLite.', err);
            dbType = 'sqlite';
        }
    }

    if (dbType === 'sqlite') {
        const sqlite3 = require('sqlite3').verbose();
        const dbPath = process.env.SQLITE_PATH || path.join(__dirname, 'SBSEPS.db');
        sqliteDb = new sqlite3.Database(dbPath);
        
        console.log(`Database Connection: Connected to local SQLite database at ${dbPath}`);
        await run('PRAGMA foreign_keys = ON');
    }

    await initializeSchema();
    await ensureAdminUser();
}

// Database helper functions (unified query runner)
async function query(sql, params = []) {
    if (dbType === 'mariadb') {
        const [rows] = await dbPool.execute(sql, params);
        return rows;
    } else {
        return new Promise((resolve, reject) => {
            // Replace MySQL placeholders (?) with SQLite compatible if needed, but sqlite3 supports (?) natively
            sqliteDb.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

async function run(sql, params = []) {
    if (dbType === 'mariadb') {
        const [result] = await dbPool.execute(sql, params);
        return result;
    } else {
        return new Promise((resolve, reject) => {
            sqliteDb.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ insertId: this.lastID, affectedRows: this.changes });
            });
        });
    }
}

async function initializeSchema() {
    const autoId = dbType === 'mariadb' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    const textType = dbType === 'mariadb' ? 'TEXT' : 'TEXT';
    const dateTimeDefault = dbType === 'mariadb' ? 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';

    await run(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(80) PRIMARY KEY,
            description VARCHAR(255),
            applied_at ${dateTimeDefault}
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id ${autoId},
            username VARCHAR(60) NOT NULL UNIQUE,
            display_name VARCHAR(120) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'auditor',
            password_hash VARCHAR(200) NOT NULL,
            password_salt VARCHAR(80) NOT NULL,
            active INTEGER DEFAULT 1,
            must_change_password INTEGER DEFAULT 0,
            created_at ${dateTimeDefault},
            updated_at ${dateTimeDefault}
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key VARCHAR(80) PRIMARY KEY,
            setting_value ${textType},
            updated_at ${dateTimeDefault}
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS controls (
            id VARCHAR(30) PRIMARY KEY,
            excel_index INTEGER DEFAULT 0,
            category VARCHAR(255),
            subcategory VARCHAR(255),
            control_text ${textType},
            requirement_text ${textType},
            ev_source ${textType},
            normative VARCHAR(80),
            control_type VARCHAR(255),
            domain ${textType},
            default_score VARCHAR(20) DEFAULT '',
            default_state VARCHAR(40) DEFAULT 'Por evaluar',
            default_comment ${textType},
            default_evidence ${textType},
            topic VARCHAR(255),
            priority VARCHAR(40) DEFAULT 'Media',
            rec_action_short ${textType},
            rec_action_detail ${textType},
            timeframe VARCHAR(80),
            risk_weight REAL DEFAULT 0,
            phase VARCHAR(255),
            active INTEGER DEFAULT 1,
            created_at ${dateTimeDefault},
            updated_at ${dateTimeDefault}
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS evaluations (
            id VARCHAR(80) PRIMARY KEY,
            company_name VARCHAR(150) NOT NULL,
            evaluator_name VARCHAR(150) NOT NULL,
            evaluation_date VARCHAR(20) NOT NULL,
            compliance_pct REAL DEFAULT 0.00,
            total_controls INTEGER DEFAULT 0,
            compliant_controls INTEGER DEFAULT 0,
            partial_controls INTEGER DEFAULT 0,
            non_compliant_controls INTEGER DEFAULT 0,
            na_controls INTEGER DEFAULT 0,
            created_by INTEGER,
            created_at ${dateTimeDefault},
            updated_at ${dateTimeDefault}
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS evaluation_items (
            id ${autoId},
            evaluation_id VARCHAR(80) NOT NULL,
            control_id VARCHAR(30) NOT NULL,
            score VARCHAR(20) DEFAULT '',
            state VARCHAR(40) DEFAULT 'Por evaluar',
            comment ${textType},
            evidence ${textType},
            evidence_file_path VARCHAR(500),
            evidence_file_name VARCHAR(255),
            UNIQUE(evaluation_id, control_id),
            FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS update_packages (
            id ${autoId},
            version VARCHAR(80) NOT NULL,
            title VARCHAR(180) NOT NULL,
            description ${textType},
            package_file_path VARCHAR(500),
            package_file_name VARCHAR(255),
            checksum_sha256 VARCHAR(80),
            status VARCHAR(30) DEFAULT 'pendiente',
            created_by INTEGER,
            created_at ${dateTimeDefault},
            applied_at ${dbType === 'mariadb' ? 'TIMESTAMP NULL' : 'DATETIME'}
        )
    `);

    const migrationRows = await query('SELECT version FROM schema_migrations WHERE version = ?', ['001_initial_sbseps']);
    if (!migrationRows.length) {
        await run('INSERT INTO schema_migrations (version, description) VALUES (?, ?)', [
            '001_initial_sbseps',
            'Initial SBSEPS schema with users, roles, controls and evaluations'
        ]);
    }

    await ensureDefaultSettings();
}

async function ensureDefaultSettings() {
    const defaults = {
        company_name: 'Corporacion CFC S.A.',
        legal_representative: 'Representante Legal',
        logo_url: 'CFC.png'
    };

    for (const [key, value] of Object.entries(defaults)) {
        const rows = await query('SELECT setting_key FROM app_settings WHERE setting_key = ?', [key]);
        if (!rows.length) {
            await run('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
        }
    }
}

async function getAppSettings() {
    const rows = await query('SELECT setting_key, setting_value FROM app_settings');
    return rows.reduce((acc, row) => {
        acc[row.setting_key] = row.setting_value;
        return acc;
    }, {});
}

async function setAppSetting(key, value) {
    const existing = await query('SELECT setting_key FROM app_settings WHERE setting_key = ?', [key]);
    if (existing.length) {
        await run('UPDATE app_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?', [value, key]);
    } else {
        await run('INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
    }
}

async function ensureAdminUser() {
    const existing = await query('SELECT id FROM users WHERE username = ?', ['admin']);
    if (existing.length) return;

    const { hash, salt } = hashPassword('admin');
    await run(`
        INSERT INTO users (username, display_name, role, password_hash, password_salt, active, must_change_password)
        VALUES (?, ?, ?, ?, ?, 1, 1)
    `, ['admin', 'Administrador', 'admin', hash, salt]);
    console.log('Default admin user created: admin / admin');
}

async function seedControlsFromTemplateIfNeeded() {
    const countRows = await query('SELECT COUNT(*) AS total FROM controls');
    const total = Number(countRows[0]?.total || countRows[0]?.['COUNT(*)'] || 0);
    if (total > 0 || !parsedTemplateRows.length) return;

    for (const row of parsedTemplateRows) {
        await run(`
            INSERT INTO controls (
                id, excel_index, category, subcategory, control_text, requirement_text,
                ev_source, normative, control_type, domain, default_score, default_state,
                default_comment, default_evidence, topic, priority, rec_action_short,
                rec_action_detail, timeframe, risk_weight, phase, active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            String(row.id), row.excelIndex, row.category, row.subcategory, row.control, row.requirement,
            row.evSource, row.normative, row.controlType, row.domain, String(row.score ?? ''),
            row.state, row.comment, row.evidence, row.topic, row.priority, row.t, row.u,
            row.v, Number(row.w || 0), row.x
        ]);
    }

    console.log(`Controls seeded into database: ${parsedTemplateRows.length} controls.`);
}

async function loadControlsFromDatabase() {
    const orderSql = dbType === 'mariadb'
        ? 'SELECT * FROM controls WHERE active = 1 ORDER BY excel_index ASC, CAST(id AS UNSIGNED) ASC'
        : 'SELECT * FROM controls WHERE active = 1 ORDER BY excel_index ASC, CAST(id AS INTEGER) ASC';
    const controls = await query(orderSql);
    parsedTemplateRows = controls.map(row => ({
        excelIndex: row.excel_index,
        id: row.id,
        category: row.category,
        subcategory: row.subcategory,
        control: row.control_text,
        requirement: row.requirement_text,
        evSource: row.ev_source,
        normative: row.normative,
        controlType: row.control_type,
        domain: row.domain,
        score: row.default_score || '',
        state: row.default_state || 'Por evaluar',
        comment: row.default_comment || '',
        evidence: row.default_evidence || '',
        topic: row.topic,
        priority: row.priority || 'Media',
        t: row.rec_action_short || '',
        u: row.rec_action_detail || '',
        v: row.timeframe || '',
        w: Number(row.risk_weight || 0),
        x: row.phase || ''
    }));
}

// --- EXCEL TEMPLATE PARSER ---
const EXCEL_TEMPLATE_NAME = 'DUE DILIGENCE SB SEPS SEGURIDAD DE LA INFORMACION - CFC.xlsx';
const templatePath = path.join(__dirname, EXCEL_TEMPLATE_NAME);
let parsedTemplateRows = [];

function loadExcelTemplate() {
    if (!fs.existsSync(templatePath)) {
        console.error(`Excel template file not found at ${templatePath}`);
        return;
    }

    try {
        const workbook = XLSX.readFile(templatePath);
        const sheetName = 'Matriz_DD_Unificada';
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            console.error(`Sheet "${sheetName}" not found in template.`);
            return;
        }

        const range = XLSX.utils.decode_range(sheet['!ref']);
        const data = [];
        for (let R = range.s.r; R <= range.e.r; ++R) {
            const row = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                row.push(sheet[cellRef] || null);
            }
            data.push(row);
        }

        const headerRow = data[0];
        const rows = [];
        for (let i = 1; i < data.length; i++) {
            const excelRow = data[i];
            // Skip empty rows (must have ID)
            if (!excelRow[0] || excelRow[0].v === undefined || excelRow[0].v === null || excelRow[0].v === '') {
                continue;
            }

            const getVal = (idx, def = '') => {
                const cell = excelRow[idx];
                return (cell && cell.v !== undefined) ? cell.v : def;
            };

            // Map columns
            rows.push({
                excelIndex: i,
                id: getVal(0),
                category: getVal(1),
                subcategory: getVal(2),
                control: getVal(3),
                requirement: getVal(4),
                evSource: getVal(5),
                normative: getVal(6),
                controlType: getVal(7),
                domain: getVal(8),
                score: getVal(9, ''),
                state: getVal(10, 'Por evaluar'),
                comment: getVal(11),
                evidence: getVal(12),
                topic: getVal(13),
                priority: getVal(14, 'Media'),
                t: getVal(19, ''),
                u: getVal(20, ''),
                v: getVal(21, ''),
                w: Number(getVal(22, 0)),
                x: getVal(23, '')
            });
        }
        parsedTemplateRows = rows;
        console.log(`Excel template loaded: ${parsedTemplateRows.length} controls parsed from sheet "${sheetName}".`);
    } catch (e) {
        console.error('Error loading Excel template:', e);
    }
}

function createSession(user) {
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, {
        user: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            role: user.role,
            mustChangePassword: Boolean(user.must_change_password)
        },
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    return sid;
}

function getSessionUser(req) {
    const cookies = parseCookies(req);
    const sid = decodeSignedCookie(cookies[SESSION_COOKIE]);
    if (!sid) return null;

    const session = sessions.get(sid);
    if (!session || session.expiresAt < Date.now()) {
        sessions.delete(sid);
        return null;
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return session.user;
}

function requireAuth(req, res, next) {
    const user = getSessionUser(req);
    if (!user) {
        return res.status(401).json({ success: false, error: 'Autenticacion requerida.' });
    }
    req.user = user;
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Permisos insuficientes.' });
        }
        next();
    };
}

function generateCaptcha() {
    const a = crypto.randomInt(2, 10);
    const b = crypto.randomInt(2, 10);
    return { question: `${a} + ${b}`, answer: String(a + b) };
}

function verifyCaptcha(req, answer) {
    const cookies = parseCookies(req);
    const encoded = decodeSignedCookie(cookies[CAPTCHA_COOKIE]);
    if (!encoded) return false;
    const [expected, expiresAt] = encoded.split(':');
    if (!expected || Number(expiresAt) < Date.now()) return false;
    return String(answer || '').trim() === expected;
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.display_name,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword ?? user.must_change_password)
    };
}

// --- API ENDPOINTS ---

app.get('/api/auth/captcha', (req, res) => {
    const captcha = generateCaptcha();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    setCookie(req, res, CAPTCHA_COOKIE, encodeSignedCookie(`${captcha.answer}:${expiresAt}`), { maxAge: 300 });
    res.json({ success: true, question: captcha.question });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password, captcha } = req.body || {};

    if (!username || !password || !captcha) {
        return res.status(400).json({ success: false, error: 'Usuario, contrasena y captcha son requeridos.' });
    }

    if (!verifyCaptcha(req, captcha)) {
        return res.status(400).json({ success: false, error: 'Captcha incorrecto o expirado.' });
    }

    const users = await query('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
    const user = users[0];
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
        return res.status(401).json({ success: false, error: 'Credenciales invalidas.' });
    }

    const sid = createSession(user);
    setCookie(req, res, SESSION_COOKIE, encodeSignedCookie(sid), { maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    clearCookie(req, res, CAPTCHA_COOKIE);
    res.json({ success: true, user: publicUser(sessions.get(sid).user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    const sid = decodeSignedCookie(parseCookies(req)[SESSION_COOKIE]);
    if (sid) sessions.delete(sid);
    clearCookie(req, res, SESSION_COOKIE);
    res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: publicUser(req.user) });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 4) {
        return res.status(400).json({ success: false, error: 'La nueva contrasena debe tener al menos 4 caracteres.' });
    }

    const users = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = users[0];
    if (!user || !verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
        return res.status(401).json({ success: false, error: 'Contrasena actual incorrecta.' });
    }

    const { hash, salt } = hashPassword(newPassword);
    await run('UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, salt, req.user.id]);
    req.user.mustChangePassword = false;
    res.json({ success: true, message: 'Contrasena actualizada.' });
});

app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const settings = await getAppSettings();
        res.json({
            success: true,
            settings: {
                companyName: settings.company_name || 'Corporacion CFC S.A.',
                legalRepresentative: settings.legal_representative || 'Representante Legal',
                logoUrl: settings.logo_url || 'CFC.png'
            }
        });
    } catch (err) {
        console.error('Error loading settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/settings', requireAuth, requireRole('admin'), logoUpload.single('logo'), async (req, res) => {
    try {
        const { companyName, legalRepresentative } = req.body || {};
        const cleanCompany = String(companyName || '').trim();
        const cleanRepresentative = String(legalRepresentative || '').trim();

        if (!cleanCompany || !cleanRepresentative) {
            if (req.file?.path) fs.unlink(req.file.path, () => {});
            return res.status(400).json({ success: false, error: 'Nombre de empresa y representante legal son requeridos.' });
        }

        await setAppSetting('company_name', cleanCompany);
        await setAppSetting('legal_representative', cleanRepresentative);

        if (req.file) {
            const logoUrl = '/uploads/' + req.file.filename;
            await setAppSetting('logo_url', logoUrl);
        }

        const settings = await getAppSettings();
        res.json({
            success: true,
            message: 'Configuracion institucional actualizada.',
            settings: {
                companyName: settings.company_name,
                legalRepresentative: settings.legal_representative,
                logoUrl: settings.logo_url
            }
        });
    } catch (err) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        console.error('Error saving settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
    const users = await query('SELECT id, username, display_name, role, active, must_change_password, created_at, updated_at FROM users ORDER BY username ASC');
    res.json({ success: true, users });
});

app.post('/api/users', requireAuth, requireRole('admin'), async (req, res) => {
    const { username, displayName, role, password, active = 1 } = req.body || {};
    if (!username || !displayName || !password || !allowedRoles.has(role)) {
        return res.status(400).json({ success: false, error: 'Datos de usuario incompletos o rol invalido.' });
    }

    const { hash, salt } = hashPassword(password);
    await run(`
        INSERT INTO users (username, display_name, role, password_hash, password_salt, active, must_change_password)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [username, displayName, role, hash, salt, active ? 1 : 0]);
    res.json({ success: true, message: 'Usuario creado.' });
});

app.put('/api/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
    const { displayName, role, active, password } = req.body || {};
    if (role && !allowedRoles.has(role)) {
        return res.status(400).json({ success: false, error: 'Rol invalido.' });
    }

    const fields = [];
    const params = [];
    if (displayName) { fields.push('display_name = ?'); params.push(displayName); }
    if (role) { fields.push('role = ?'); params.push(role); }
    if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
    if (password) {
        const { hash, salt } = hashPassword(password);
        fields.push('password_hash = ?', 'password_salt = ?', 'must_change_password = 1');
        params.push(hash, salt);
    }

    if (!fields.length) {
        return res.status(400).json({ success: false, error: 'No hay cambios para aplicar.' });
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    await run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    res.json({ success: true, message: 'Usuario actualizado.' });
});

app.get('/api/updates', requireAuth, requireRole('admin'), async (req, res) => {
    const rows = await query('SELECT * FROM update_packages ORDER BY created_at DESC, id DESC');
    res.json({ success: true, updates: rows });
});

app.post('/api/updates', requireAuth, requireRole('admin'), updateUpload.single('package'), async (req, res) => {
    const { version, title, description } = req.body || {};
    if (!version || !title) {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'Version y titulo son requeridos.' });
    }

    let checksum = null;
    let filePath = null;
    let fileName = null;
    if (req.file) {
        const fileBuffer = fs.readFileSync(req.file.path);
        checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        filePath = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
        fileName = req.file.originalname;
    }

    await run(`
        INSERT INTO update_packages (
            version, title, description, package_file_path, package_file_name,
            checksum_sha256, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)
    `, [version, title, description || '', filePath, fileName, checksum, req.user.id]);

    res.json({ success: true, message: 'Paquete de actualizacion registrado.', checksum });
});

app.put('/api/updates/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
    const { status } = req.body || {};
    const allowedStatuses = new Set(['pendiente', 'probado', 'aplicado', 'descartado']);
    if (!allowedStatuses.has(status)) {
        return res.status(400).json({ success: false, error: 'Estado de actualizacion invalido.' });
    }

    if (status === 'aplicado') {
        await run('UPDATE update_packages SET status = ?, applied_at = CURRENT_TIMESTAMP WHERE id = ?', [status, req.params.id]);
    } else {
        await run('UPDATE update_packages SET status = ? WHERE id = ?', [status, req.params.id]);
    }
    res.json({ success: true, message: 'Estado actualizado.' });
});

// 1. Get raw Excel template requirements
app.get('/api/template', requireAuth, (req, res) => {
    res.json({
        success: true,
        templateName: EXCEL_TEMPLATE_NAME,
        rows: parsedTemplateRows
    });
});

// 2. Get list of historical evaluations
app.get('/api/evaluations', requireAuth, async (req, res) => {
    try {
        const rows = await query('SELECT * FROM evaluations ORDER BY evaluation_date DESC, created_at DESC');
        res.json({ success: true, evaluations: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Get specific evaluation details
app.get('/api/evaluations/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const evals = await query('SELECT * FROM evaluations WHERE id = ?', [id]);
        if (!evals.length) {
            return res.status(404).json({ success: false, error: 'Evaluación no encontrada' });
        }

        const items = await query('SELECT * FROM evaluation_items WHERE evaluation_id = ?', [id]);
        
        // Merge items with template so we always return full 115 records with current scores
        const mergedRows = parsedTemplateRows.map(tmpl => {
            const savedItem = items.find(itm => String(itm.control_id) === String(tmpl.id));
            const rowCopy = { ...tmpl };
            if (savedItem) {
                rowCopy.score = savedItem.score;
                rowCopy.state = savedItem.state;
                rowCopy.comment = savedItem.comment;
                rowCopy.evidence = savedItem.evidence;
                rowCopy.evidence_file_path = savedItem.evidence_file_path;
                rowCopy.evidence_file_name = savedItem.evidence_file_name;
            } else {
                rowCopy.score = ''; // default empty
                rowCopy.state = 'Por evaluar';
                rowCopy.comment = '';
                rowCopy.evidence = '';
                rowCopy.evidence_file_path = null;
                rowCopy.evidence_file_name = null;
            }
            return rowCopy;
        });

        res.json({
            success: true,
            evaluation: evals[0],
            rows: mergedRows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. Save/Update an evaluation
app.post('/api/evaluations', requireAuth, requireRole('admin', 'auditor'), async (req, res) => {
    const { id, companyName, evaluatorName, evaluationDate, metrics, rows } = req.body;

    if (!id || !companyName || !evaluationDate || !Array.isArray(rows) || !metrics) {
        return res.status(400).json({ success: false, error: 'Datos incompletos.' });
    }

    try {
        const safeMetrics = {
            compliancePercentage: Number(metrics.compliancePercentage) || 0,
            totalCount: Number(metrics.totalCount) || rows.length,
            complianceCount: Number(metrics.complianceCount) || 0,
            partialCount: Number(metrics.partialCount) || 0,
            nonComplianceCount: Number(metrics.nonComplianceCount) || 0,
            naCount: Number(metrics.naCount) || 0
        };

        // Insert or update evaluation header
        const existing = await query('SELECT id FROM evaluations WHERE id = ?', [id]);
        if (existing.length) {
            // Update
            await run(`
                UPDATE evaluations 
                SET company_name = ?, evaluator_name = ?, evaluation_date = ?, 
                    compliance_pct = ?, total_controls = ?, compliant_controls = ?, 
                    partial_controls = ?, non_compliant_controls = ?, na_controls = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [
                companyName, evaluatorName, evaluationDate, 
                safeMetrics.compliancePercentage, safeMetrics.totalCount, safeMetrics.complianceCount,
                safeMetrics.partialCount, safeMetrics.nonComplianceCount, safeMetrics.naCount,
                id
            ]);
        } else {
            // Insert
            await run(`
                INSERT INTO evaluations (
                    id, company_name, evaluator_name, evaluation_date, 
                    compliance_pct, total_controls, compliant_controls, 
                    partial_controls, non_compliant_controls, na_controls, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id, companyName, evaluatorName, evaluationDate,
                safeMetrics.compliancePercentage, safeMetrics.totalCount, safeMetrics.complianceCount,
                safeMetrics.partialCount, safeMetrics.nonComplianceCount, safeMetrics.naCount,
                req.user.id
            ]);
        }

        // Insert or update evaluation items
        for (const row of rows) {
            if (!row || row.id === undefined || row.id === null || row.id === '') {
                continue;
            }

            const itemExisting = await query(
                'SELECT id FROM evaluation_items WHERE evaluation_id = ? AND control_id = ?',
                [id, row.id]
            );

            if (itemExisting.length) {
                await run(`
                    UPDATE evaluation_items 
                    SET score = ?, state = ?, comment = ?, evidence = ?, 
                        evidence_file_path = ?, evidence_file_name = ?
                    WHERE evaluation_id = ? AND control_id = ?
                `, [
                    row.score, row.state, row.comment || '', row.evidence || '',
                    row.evidence_file_path || null, row.evidence_file_name || null,
                    id, row.id
                ]);
            } else {
                await run(`
                    INSERT INTO evaluation_items (
                        evaluation_id, control_id, score, state, comment, evidence, 
                        evidence_file_path, evidence_file_name
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    id, row.id, row.score, row.state, row.comment || '', row.evidence || '',
                    row.evidence_file_path || null, row.evidence_file_name || null
                ]);
            }
        }

        res.json({ success: true, message: 'Evaluación guardada exitosamente.' });
    } catch (err) {
        console.error('Error saving evaluation:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. Upload evidence file
app.post('/api/upload-evidence', requireAuth, requireRole('admin', 'auditor', 'tecnico'), upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No se subió ningún archivo.' });
    }
    
    // Relative path to serve
    const fileUrlPath = '/uploads/' + req.file.filename;

    res.json({
        success: true,
        filePath: fileUrlPath,
        fileName: req.file.originalname
    });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message.includes('archivo') || err.message.includes('actualizacion') || err.message.includes('logo')) {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? `El archivo supera el limite configurado.`
            : err.message;
        return res.status(400).json({ success: false, error: message });
    }
    next(err);
});

// 6. Delete evaluation
app.delete('/api/evaluations/:id', requireAuth, requireRole('admin', 'auditor'), async (req, res) => {
    const id = req.params.id;
    try {
        await run('DELETE FROM evaluations WHERE id = ?', [id]);
        res.json({ success: true, message: 'Evaluación eliminada exitosamente.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Server-side Export Excel
app.get('/api/export-excel/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        const evals = await query('SELECT * FROM evaluations WHERE id = ?', [id]);
        if (!evals.length) {
            return res.status(404).send('Evaluación no encontrada.');
        }

        const evaluation = evals[0];
        const items = await query('SELECT * FROM evaluation_items WHERE evaluation_id = ?', [id]);

        if (!fs.existsSync(templatePath)) {
            return res.status(500).send('Archivo de plantilla Excel no encontrado en el servidor.');
        }

        // Read template Excel
        const workbook = XLSX.readFile(templatePath, { cellFormula: true, cellStyles: true });
        
        // Loop sheets to copy and edit sheet 1
        const sheetName = 'Matriz_DD_Unificada';
        const ws = workbook.Sheets[sheetName];
        if (!ws) {
            return res.status(500).send(`Hoja ${sheetName} no encontrada en la plantilla.`);
        }

        // Helper formulas / text recalculation similar to backend schema
        const recalculateRow = (scoreVal, priorityVal, categoryVal) => {
            const scoreStr = String(scoreVal).trim().toUpperCase();
            let state = 'Por evaluar';
            let t = 'Levantar evidencia';
            let u = 'Levantar evidencia y confirmar aplicabilidad';
            let v = '0-30 días';
            let w = 0;
            let x = 'Fase 0 - Evidencia/aplicabilidad';

            if (scoreStr === 'N/A') {
                state = 'No aplica';
                t = 'Sin acción';
                u = 'Documentar justificación de no aplicabilidad';
                v = 'No aplica';
                x = 'No aplica';
            } else if (scoreStr !== '') {
                const scoreNum = Number(scoreStr);
                const prio = String(priorityVal).trim().toLowerCase();
                const cat = String(categoryVal).trim().toLowerCase();

                if (scoreNum === 1) {
                    state = 'Cumple';
                    t = 'Mantener / evidenciar';
                    u = 'Mantener evidencia y revisión periódica';
                    v = 'Revisión periódica';
                    x = 'Mantenimiento';
                } else if (scoreNum === 0.5) {
                    state = 'Parcial';
                    t = 'Cerrar brecha parcial';
                    u = 'Completar documentación/control y validar efectividad';
                    v = (prio === 'alta') ? '0-45 días' : (prio === 'media') ? '31-75 días' : '61-120 días';
                    w = (prio === 'alta') ? 2 : (prio === 'media') ? 1.5 : 1;
                } else if (scoreNum === 0) {
                    state = 'No cumple';
                    t = 'Implementar control';
                    u = 'Diseñar, aprobar e implementar control requerido';
                    v = (prio === 'alta') ? '0-30 días' : (prio === 'media') ? '31-60 días' : '61-90 días';
                    w = (prio === 'alta') ? 3 : (prio === 'media') ? 2 : 1;
                }

                if (state !== 'Cumple') {
                    if (cat.includes('gobernanza') || cat.includes('sgsi') || cat.includes('contexto') || cat.includes('alcance')) {
                        x = 'Fase 1 - Gobierno y SGSI';
                    } else if (cat.includes('riesgo') || cat.includes('proceso') || cat.includes('persona')) {
                        x = 'Fase 2 - Riesgos y operación';
                    } else if (cat.includes('tercero') || cat.includes('continuidad')) {
                        x = 'Fase 3 - Continuidad y terceros';
                    } else if (cat.includes('tecnolog') || cat.includes('acceso') || cat.includes('ciber') || cat.includes('vulnera') || cat.includes('incidente') || cat.includes('monito')) {
                        x = 'Fase 4 - Controles técnicos';
                    } else {
                        x = 'Fase 5 - Canales y datos';
                    }
                }
            }
            return { state, t, u, v, w, x };
        };

        // Parse template rows to map indices
        parsedTemplateRows.forEach(tmpl => {
            const savedItem = items.find(itm => String(itm.control_id) === String(tmpl.id));
            const score = savedItem ? savedItem.score : '';
            const comment = savedItem ? (savedItem.comment || '') : '';
            const evidence = savedItem ? (savedItem.evidence || '') : '';
            const fileLink = savedItem && savedItem.evidence_file_path 
                ? `${req.protocol}://${req.get('host')}${savedItem.evidence_file_path}` 
                : '';
            
            const fullEvidence = fileLink 
                ? (evidence ? `${evidence} (Archivo: ${fileLink})` : `Archivo adjunto: ${fileLink}`)
                : evidence;

            const calc = recalculateRow(score, tmpl.priority, tmpl.category);

            // Update cells
            // Col J (9): Score
            const cellJ = XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 9 });
            ws[cellJ] = { v: score, t: isNaN(score) || score === '' ? 's' : 'n' };

            // Col K (10): State
            const cellK = XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 10 });
            ws[cellK] = { v: calc.state, t: 's' };

            // Col L (11): Comments
            const cellL = XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 11 });
            ws[cellL] = { v: comment, t: 's' };

            // Col M (12): Evidence
            const cellM = XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 12 });
            ws[cellM] = { v: fullEvidence, t: 's' };

            // Col T (19): t
            ws[XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 19 })] = { v: calc.t, t: 's' };
            // Col U (20): u
            ws[XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 20 })] = { v: calc.u, t: 's' };
            // Col V (21): v
            ws[XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 21 })] = { v: calc.v, t: 's' };
            // Col W (22): w
            ws[XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 22 })] = { v: calc.w, t: 'n' };
            // Col X (23): x
            ws[XLSX.utils.encode_cell({ r: tmpl.excelIndex, c: 23 })] = { v: calc.x, t: 's' };
        });

        // Add history sheet
        const historyRows = await query('SELECT * FROM evaluations ORDER BY evaluation_date ASC');
        if (historyRows.length) {
            const historyData = [
                ['Reporte de Progreso Histórico - Due Diligence SB/SEPS'],
                ['Empresa:', evaluation.company_name],
                ['Fecha de Reporte:', new Date().toLocaleDateString()],
                [],
                ['Fecha Evaluación', 'Evaluador', '% Cumplimiento', 'Brechas Abiertas', 'Controles Cumplidos', 'Totales']
            ];
            
            historyRows.forEach(h => {
                historyData.push([
                    h.evaluation_date,
                    h.evaluator_name,
                    Number(h.compliance_pct),
                    h.total_controls - h.compliant_controls - h.na_controls,
                    h.compliant_controls,
                    h.total_controls - h.na_controls
                ]);
            });

            const wsHist = XLSX.utils.aoa_to_sheet(historyData);
            XLSX.utils.book_append_sheet(workbook, wsHist, 'Historial_Evaluaciones');
        }

        // Write buffer and send file
        const wopts = { bookType: 'xlsx', bookSST: false, type: 'buffer' };
        const buffer = XLSX.write(workbook, wopts);

        const safeCompanyName = evaluation.company_name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=DUE_DILIGENCE_EVALUADO_${safeCompanyName}_${evaluation.evaluation_date}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('Error exporting Excel:', err);
        res.status(500).send('Error al generar el archivo Excel: ' + err.message);
    }
});

// Start Server
initDatabase().then(async () => {
    loadExcelTemplate();
    await seedControlsFromTemplateIfNeeded();
    await loadControlsFromDatabase();
    app.listen(PORT, () => {
        console.log(`Server is running locally at http://localhost:${PORT}`);
        console.log(`Database mode: ${dbType}; database name/path: ${dbType === 'mariadb' ? DEFAULT_DB_NAME : (process.env.SQLITE_PATH || 'SBSEPS.db')}`);
    });
}).catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
});
