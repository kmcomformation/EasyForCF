const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, initializeDatabase, hashPassword, seedDefaultUsers, initLogs } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'comformation_secret_jwt_token_2026_cf6';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Limite élevée pour pouvoir envoyer les photos des étudiants
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cache de promesse d'initialisation pour éviter les race-conditions
let dbInitPromise = null;
let dbInitialized = false;
function getDbInitPromise() {
  if (dbInitialized) return Promise.resolve();
  if (!dbInitPromise) {
    dbInitPromise = initializeDatabase()
      .then(() => {
        dbInitialized = true;
      })
      .catch(err => {
        dbInitPromise = null; // Réinitialiser pour pouvoir réessayer au prochain appel
        throw err;
      });
  }
  return dbInitPromise;
}

// Middleware pour forcer l'attente du bootstrapping de la DB
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await getDbInitPromise();
    } catch (err) {
      console.error('[DB Init Middleware Error]', err);
      return res.status(500).json({ error: 'Initialisation de la base de données en cours ou en échec.' });
    }
  }
  next();
});

// Route diagnostic pour vérifier les variables d'environnement en production
app.get('/api/diag', async (req, res) => {
  let tableList = [];
  let createCentresError = null;
  let createCentresResult = null;
  let connection;
  try {
    connection = await pool.getConnection();
    const [tables] = await connection.query('SHOW TABLES');
    tableList = tables.map(t => Object.values(t)[0]);

    try {
      const [createRes] = await connection.query(`
        CREATE TABLE IF NOT EXISTS centres (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          nom_centre VARCHAR(150) NOT NULL,
          prenom_admin VARCHAR(80) NOT NULL,
          nom_admin VARCHAR(80) NOT NULL,
          email_admin VARCHAR(100) UNIQUE NOT NULL,
          telephone VARCHAR(30) NULL,
          montant_mensuel DECIMAL(15, 2) NOT NULL DEFAULT 0,
          statut VARCHAR(20) DEFAULT 'actif',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      createCentresResult = createRes;
    } catch (createErr) {
      createCentresError = {
        message: createErr.message,
        code: createErr.code,
        errno: createErr.errno
      };
    }
  } catch (err) {
    createCentresError = { globalError: err.message };
  } finally {
    if (connection) connection.release();
  }

  res.json({
    VERCEL: !!process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_NAME: process.env.DB_NAME,
    computedDatabase: process.env.DB_NAME || 'comformation_db',
    tables: tableList,
    createCentresResult,
    createCentresError,
    DB_SSL: process.env.DB_SSL,
    initLogs: initLogs
  });
});

// Whitelist des colonnes valides pour chaque table SQL pour éviter toute injection ou erreur de champ
const VALID_COLUMNS = {
  users: ['id', 'centre_id', 'login', 'pwd', 'role', 'perms', 'legacy', 'nom', 'prenom', 'num'],
  sessions: ['id', 'centre_id', 'code', 'det', 'closed'],
  formations: ['id', 'centre_id', 'label'],
  etudiants: ['id', 'centre_id', 'mat', 'nom', 'prenom', 'contact', 'cout', 'date', 'echeance', 'sesId', 'formId', 'photo', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  paiements: ['id', 'centre_id', 'etuId', 'nom', 'mat', 'montant', 'date', 'sesId', 'formId', 'createdBy', 'createdAt'],
  depenses: ['id', 'centre_id', 'lib', 'montant', 'date', 'sesId', 'det', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  disponibilites: ['id', 'centre_id', 'type', 'responsable', 'montant', 'detail', 'date', 'createdBy', 'createdAt', 'updatedBy'],
  backups: ['id', 'centre_id', 'name', 'date', 'type', 'data']
};

// Middleware d'authentification par JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token manquant.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide ou expiré.' });
    }
    req.user = user;
    next();
  });
}

// Fonction utilitaire pour vérifier un mot de passe
function verifyPassword(pwd, stored) {
  if (stored.startsWith('h')) {
    return hashPassword(pwd) === stored;
  }
  return pwd === stored;
}

// -------------------------------------------------------------
// ROUTES API
// -------------------------------------------------------------

// Route de diagnostic de la base de données
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    const [tables] = await pool.query('SHOW TABLES');
    
    let userCount = 0;
    try {
      const [userRows] = await pool.query('SELECT COUNT(*) AS count FROM users');
      userCount = userRows[0].count;
      if (userCount === 0) {
        console.log('[API Health] Base vide détectée, lancement du seeding à la demande...');
        await seedDefaultUsers();
        const [updatedRows] = await pool.query('SELECT COUNT(*) AS count FROM users');
        userCount = updatedRows[0].count;
      }
    } catch (err) {
      userCount = `Table users manquante ou erreur: ${err.message}`;
    }

    res.json({
      status: 'success',
      database: {
        host: process.env.DB_HOST,
        name: process.env.DB_NAME,
        connection: 'OK',
        test_query: rows[0].result
      },
      tables: tables.map(t => Object.values(t)[0]),
      users_in_db: userCount
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: {
        host: process.env.DB_HOST,
        name: process.env.DB_NAME,
        connection: 'FAILED'
      },
      error: err.message
    });
  }
});

// Connexion avec email et mot de passe (mécanisme ComFormation)
app.post('/api/login', async (req, res) => {
  const { email, pwd } = req.body;

  if (!email || !pwd) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    // Tenter de seeder automatiquement si la base est vide (mécanisme d'auto-guérison)
    try {
      const [countRows] = await pool.query('SELECT COUNT(*) AS count FROM users');
      if (countRows[0].count === 0) {
        console.log('[API Login] Base vide détectée, lancement du seeding à la demande...');
        await seedDefaultUsers();
      }
    } catch (dbErr) {
      console.warn('[DB Warning] Échec vérification ou seeding :', dbErr.message);
    }

    // Récupérer l'utilisateur correspondant à l'email (login) avec les infos de son centre
    const [users] = await pool.query(`
      SELECT u.*, c.statut as centre_statut, c.nom_centre as centre_nom, c.logo as centre_logo
      FROM users u 
      LEFT JOIN centres c ON u.centre_id = c.id 
      WHERE u.login = ?
    `, [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects. Accès refusé.' });
    }
    
    const u = users[0];
    if (!verifyPassword(pwd, u.pwd)) {
      return res.status(401).json({ error: 'Identifiants incorrects. Accès refusé.' });
    }

    if (u.role !== 'SuperAdmin' && u.centre_statut === 'inactif') {
      return res.status(403).json({ error: "Votre compte est désactivé. Veuillez contacter l'administrateur pour en savoir plus." });
    }

    // Générer le JWT
    const token = jwt.sign(
      { id: u.id, centre_id: u.centre_id, login: u.login, role: u.role },
      JWT_SECRET,
      { expiresIn: '30d' } // Session valide 30 jours
    );

    // Retourner le token et l'utilisateur
    res.json({
      token,
      user: {
        id: Number(u.id),
        centre_id: u.centre_id ? Number(u.centre_id) : null,
        login: u.login,
        role: u.role,
        perms: u.perms ? (typeof u.perms === 'string' ? JSON.parse(u.perms) : u.perms) : {},
        centre_nom: u.centre_nom || null,
        centre_logo: u.centre_logo || null
      }
    });

  } catch (err) {
    console.error('[Login Error]', err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// Récupérer le profil utilisateur courant (vérification de session)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.*, c.nom_centre as centre_nom, c.logo as centre_logo
      FROM users u
      LEFT JOIN centres c ON u.centre_id = c.id
      WHERE u.id = ?
    `, [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    const u = rows[0];
    res.json({
      id: Number(u.id),
      centre_id: u.centre_id ? Number(u.centre_id) : null,
      login: u.login,
      role: u.role,
      perms: u.perms ? JSON.parse(u.perms) : {},
      centre_nom: u.centre_nom || null,
      centre_logo: u.centre_logo || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Synchronisation d'une opération locale (CREATE/UPDATE/DELETE)
app.post('/api/sync', authenticateToken, async (req, res) => {
  const { action, table, recordId, data } = req.body;

  if (!action || !table || !recordId) {
    return res.status(400).json({ error: 'Paramètres de synchronisation invalides.' });
  }

  if (!req.user.centre_id && req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'Accès interdit. Aucun centre assigné.' });
  }

  // Sécurité: Vérifier que la table demandée est autorisée
  if (!VALID_COLUMNS[table]) {
    return res.status(400).json({ error: `Table '${table}' non autorisée.` });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (action === 'CREATE') {
      // Injecter le centre_id de force
      data.centre_id = req.user.centre_id;
      // Filtrer les colonnes pour n'envoyer que ce qui est valide
      const fields = Object.keys(data).filter(k => VALID_COLUMNS[table].includes(k) && k !== 'id');
      const columns = ['id', ...fields];

      const values = columns.map(col => {
        if (col === 'id') return recordId;
        let val = data[col];
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (val === undefined || val === '') return null;
        return val;
      });

      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO \`${table}\` (${columns.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;
      await connection.query(sql, values);

    } else if (action === 'UPDATE') {
      // Filtrer les colonnes pour n'envoyer que ce qui est valide
      const fields = Object.keys(data).filter(k => VALID_COLUMNS[table].includes(k) && k !== 'id');
      
      const values = fields.map(col => {
        let val = data[col];
        if (typeof val === 'object' && val !== null) return JSON.stringify(val);
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (val === undefined || val === '') return null;
        return val;
      });
      
      // Ajouter l'ID et le centre_id pour la clause WHERE
      values.push(recordId, req.user.centre_id);

      const updateClauses = fields.map(col => `\`${col}\` = ?`).join(', ');
      const sql = `UPDATE \`${table}\` SET ${updateClauses} WHERE id = ? AND centre_id = ?`;
      await connection.query(sql, values);

    } else if (action === 'DELETE') {
      // Suppression de l'enregistrement avec vérification du centre_id
      await connection.query(`DELETE FROM \`${table}\` WHERE id = ? AND centre_id = ?`, [recordId, req.user.centre_id]);
    }

    await connection.commit();
    res.json({ success: true });

  } catch (err) {
    await connection.rollback();
    console.error(`[Sync DB Error] Table: ${table}, Action: ${action}, ID: ${recordId}`, err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Récupération de l'ensemble des données distantes (Pull complet)
app.get('/api/sync/pull', authenticateToken, async (req, res) => {
  try {
    const cid = req.user.centre_id;
    if (!cid && req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ error: 'Accès interdit. Aucun centre assigné.' });
    }
    if (req.user.role === 'SuperAdmin') {
      return res.json({ users:[], sessions:[], formations:[], etudiants:[], paiements:[], depenses:[], disponibilites:[], backups:[] });
    }

    const [users] = await pool.query('SELECT id, login, pwd, role, perms, legacy, nom, prenom, num FROM users WHERE centre_id = ?', [cid]);
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE centre_id = ?', [cid]);
    const [formations] = await pool.query('SELECT * FROM formations WHERE centre_id = ?', [cid]);
    const [etudiants] = await pool.query('SELECT * FROM etudiants WHERE centre_id = ?', [cid]);
    const [paiements] = await pool.query('SELECT * FROM paiements WHERE centre_id = ?', [cid]);
    const [depenses] = await pool.query('SELECT * FROM depenses WHERE centre_id = ?', [cid]);
    const [disponibilites] = await pool.query('SELECT * FROM disponibilites WHERE centre_id = ?', [cid]);
    const [backups] = await pool.query('SELECT id, name, date, type, data FROM backups WHERE centre_id = ?', [cid]);

    // Formater les données pour correspondre aux attentes du client JS
    const parsedUsers = users.map(u => ({
      id: Number(u.id),
      login: u.login,
      pwd: u.pwd,
      role: u.role,
      perms: u.perms ? JSON.parse(u.perms) : {},
      legacy: !!u.legacy,
      nom: u.nom || '',
      prenom: u.prenom || '',
      num: u.num || ''
    }));

    const parsedSessions = sessions.map(s => ({
      id: Number(s.id),
      code: s.code,
      det: s.det,
      closed: !!s.closed
    }));

    const parsedFormations = formations.map(f => ({
      id: Number(f.id),
      label: f.label
    }));

    const parsedEtudiants = etudiants.map(e => ({
      id: Number(e.id),
      mat: e.mat,
      nom: e.nom,
      prenom: e.prenom,
      contact: e.contact,
      cout: parseFloat(e.cout),
      date: e.date ? e.date.toISOString().split('T')[0] : null,
      echeance: e.echeance ? e.echeance.toISOString().split('T')[0] : null,
      sesId: e.sesId ? Number(e.sesId) : null,
      formId: e.formId ? Number(e.formId) : null,
      photo: e.photo,
      createdBy: e.createdBy ? Number(e.createdBy) : null,
      createdAt: e.createdAt ? e.createdAt.toISOString().split('T')[0] : null,
      updatedBy: e.updatedBy ? Number(e.updatedBy) : null,
      updatedAt: e.updatedAt ? e.updatedAt.toISOString().split('T')[0] : null
    }));

    const parsedPaiements = paiements.map(p => ({
      id: Number(p.id),
      etuId: p.etuId ? Number(p.etuId) : null,
      nom: p.nom,
      mat: p.mat,
      montant: parseFloat(p.montant),
      date: p.date ? p.date.toISOString().split('T')[0] : null,
      sesId: p.sesId ? Number(p.sesId) : null,
      formId: p.formId ? Number(p.formId) : null,
      createdBy: p.createdBy ? Number(p.createdBy) : null,
      createdAt: p.createdAt ? p.createdAt.toISOString().split('T')[0] : null
    }));

    const parsedDepenses = depenses.map(d => ({
      id: Number(d.id),
      lib: d.lib,
      montant: parseFloat(d.montant),
      date: d.date ? d.date.toISOString().split('T')[0] : null,
      sesId: d.sesId ? Number(d.sesId) : null,
      det: d.det,
      createdBy: d.createdBy ? Number(d.createdBy) : null,
      createdAt: d.createdAt ? d.createdAt.toISOString().split('T')[0] : null,
      updatedBy: d.updatedBy ? Number(d.updatedBy) : null,
      updatedAt: d.updatedAt ? d.updatedAt.toISOString().split('T')[0] : null
    }));

    const parsedDisponibilites = disponibilites.map(d => ({
      id: Number(d.id),
      type: d.type || 'Entree',
      responsable: d.responsable,
      montant: parseFloat(d.montant),
      detail: d.detail,
      date: d.date ? d.date.toISOString().split('T')[0] : null,
      createdBy: d.createdBy ? Number(d.createdBy) : null,
      createdAt: d.createdAt ? d.createdAt.toISOString().split('T')[0] : null,
      updatedBy: d.updatedBy ? Number(d.updatedBy) : null
    }));

    res.json({
      users: parsedUsers,
      sessions: parsedSessions,
      formations: parsedFormations,
      etudiants: parsedEtudiants,
      paiements: parsedPaiements,
      depenses: parsedDepenses,
      disponibilites: parsedDisponibilites,
      backups: backups
    });

  } catch (err) {
    console.error('[Sync Pull Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Route pour vider toutes les données (sauf les utilisateurs et sauvegardes)
app.post('/api/sync/clear', authenticateToken, async (req, res) => {
  const cid = req.user.centre_id;
  if (!cid) return res.status(403).json({ error: 'Accès interdit.' });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DELETE FROM paiements WHERE centre_id = ?', [cid]);
    await connection.query('DELETE FROM etudiants WHERE centre_id = ?', [cid]);
    await connection.query('DELETE FROM depenses WHERE centre_id = ?', [cid]);
    await connection.query('DELETE FROM disponibilites WHERE centre_id = ?', [cid]);
    await connection.query('DELETE FROM sessions WHERE centre_id = ?', [cid]);
    await connection.query('DELETE FROM formations WHERE centre_id = ?', [cid]);
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();
    res.json({ success: true });
  } catch (err) {
    await connection.rollback();
    console.error('[Sync Clear Error]', err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Route d'analyse assistée par l'Agent IA (Cohere Command R+)
app.post('/api/ai/chat', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

  const cohereApiKey = process.env.COHERE_API_KEY;
  if (!cohereApiKey) {
    return res.status(500).json({ error: 'Clé d\'API Cohere non configurée sur le serveur.' });
  }

  const { message, chat_history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message requis.' });
  }
  try {
    const cid = req.user.centre_id;
    if (!cid) return res.status(403).json({ error: 'Centre non assigné.' });

    // 1. Requêtes SQL parallèles pour construire le contexte dynamique réel à vitesse maximale
    const [
      [studentsRows],
      [formationsRows],
      [sessionsRows],
      [revenueRows],
      [paidRows],
      [expensesRows],
      [disposRows],
      [sessionsData],
      [unpaidStudents]
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) AS count FROM etudiants WHERE centre_id = ?', [cid]),
      pool.query('SELECT COUNT(*) AS count FROM formations WHERE centre_id = ?', [cid]),
      pool.query('SELECT COUNT(*) AS count FROM sessions WHERE centre_id = ?', [cid]),
      pool.query('SELECT COALESCE(SUM(cout), 0) AS total FROM etudiants WHERE centre_id = ?', [cid]),
      pool.query('SELECT COALESCE(SUM(montant), 0) AS total FROM paiements WHERE centre_id = ?', [cid]),
      pool.query('SELECT COALESCE(SUM(montant), 0) AS total FROM depenses WHERE centre_id = ?', [cid]),
      pool.query('SELECT COALESCE(SUM(montant), 0) AS total FROM disponibilites WHERE centre_id = ?', [cid]),
      pool.query(`
        SELECT 
          s.id, s.code, s.det, s.closed,
          COUNT(e.id) AS etudiantCount,
          COALESCE(SUM(e.cout), 0) AS coutTotal,
          COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.sesId = s.id AND p.centre_id = ?), 0) AS paidTotal,
          COALESCE((SELECT SUM(d.montant) FROM depenses d WHERE d.sesId = s.id AND d.centre_id = ?), 0) AS depenseTotal
        FROM sessions s
        LEFT JOIN etudiants e ON e.sesId = s.id AND e.centre_id = ?
        WHERE s.centre_id = ?
        GROUP BY s.id, s.code, s.det, s.closed
      `, [cid, cid, cid, cid]),
      pool.query(`
        SELECT * FROM (
          SELECT 
            e.mat, e.nom, e.prenom, e.contact, e.cout, e.echeance,
            s.code AS sessionCode,
            f.label AS formationLabel,
            COALESCE((SELECT SUM(p.montant) FROM paiements p WHERE p.etuId = e.id AND p.centre_id = ?), 0) AS paidAmount
          FROM etudiants e
          LEFT JOIN sessions s ON e.sesId = s.id AND s.centre_id = ?
          LEFT JOIN formations f ON e.formId = f.id AND f.centre_id = ?
          WHERE e.centre_id = ?
        ) AS t
        WHERE t.cout > t.paidAmount
      `, [cid, cid, cid, cid])
    ]);

    const studentsCount = studentsRows[0]?.count || 0;
    const formationsCount = formationsRows[0]?.count || 0;
    const sessionsCount = sessionsRows[0]?.count || 0;
    const totalRevenue = parseFloat(revenueRows[0]?.total || 0);
    const totalPaid = parseFloat(paidRows[0]?.total || 0);
    const totalExpenses = parseFloat(expensesRows[0]?.total || 0);
    const totalDispos = parseFloat(disposRows[0]?.total || 0);

    const totalUnpaid = Math.max(0, totalRevenue - totalPaid);
    const unpaidPercent = totalRevenue > 0 ? ((totalUnpaid / totalRevenue) * 100).toFixed(1) : '0';
    const netProfit = totalPaid - totalExpenses;

    let sessionsDetailsText = '';
    for (const s of sessionsData) {
      const unpaid = Math.max(0, s.coutTotal - s.paidTotal);
      const profit = s.paidTotal - s.depenseTotal;
      sessionsDetailsText += `- Session **${s.code}** (${s.det || 'sans description'}) :
  * Statut : ${s.closed ? 'Fermée' : 'Ouverte'}
  * Étudiants : ${s.etudiantCount}
  * Recettes attendues : ${parseFloat(s.coutTotal).toLocaleString('fr-FR')} FCFA
  * Encaissé : ${parseFloat(s.paidTotal).toLocaleString('fr-FR')} FCFA
  * Impayés : ${unpaid.toLocaleString('fr-FR')} FCFA
  * Dépenses : ${parseFloat(s.depenseTotal).toLocaleString('fr-FR')} FCFA
  * Bénéfice Net (Encaissé - Dépenses) : ${profit.toLocaleString('fr-FR')} FCFA\n\n`;
    }
    if (!sessionsDetailsText) sessionsDetailsText = 'Aucune session enregistrée.\n';

    // Trier les étudiants par solde restant dû décroissant
    unpaidStudents.sort((a, b) => (b.cout - a.paidAmount) - (a.cout - b.paidAmount));

    const totalUnpaidStudentsCount = unpaidStudents.length;
    let unpaidStudentsText = `Il y a au total ${totalUnpaidStudentsCount} étudiant(s) avec des paiements incomplets pour un montant total restant dû de ${totalUnpaid.toLocaleString('fr-FR')} FCFA.\n\n`;

    if (totalUnpaidStudentsCount > 0) {
      unpaidStudentsText += `Voici les 10 situations d'impayés les plus prioritaires (les restes à payer les plus élevés) :\n\n`;
      const topUnpaidStudents = unpaidStudents.slice(0, 10);
      let counter = 1;
      for (const e of topUnpaidStudents) {
        const rest = e.cout - e.paidAmount;
        const progress = e.cout > 0 ? ((e.paidAmount / e.cout) * 100).toFixed(0) : '0';
        const formattedEcheance = e.echeance ? (e.echeance instanceof Date ? e.echeance.toISOString().split('T')[0] : e.echeance) : 'Non définie';
        unpaidStudentsText += `${counter}. **${e.prenom} ${e.nom}** (Matricule: \`${e.mat}\`)
   * Session: ${e.sessionCode || 'N/A'} | Formation: ${e.formationLabel || 'N/A'} | Contact: ${e.contact || 'N/A'}
   * Dû: ${parseFloat(e.cout).toLocaleString('fr-FR')} FCFA | Payé: ${parseFloat(e.paidAmount).toLocaleString('fr-FR')} FCFA (${progress}%)
   * Reste à payer: **${rest.toLocaleString('fr-FR')} FCFA** | Échéance: ${formattedEcheance}\n\n`;
        counter++;
      }
      if (totalUnpaidStudentsCount > 10) {
        unpaidStudentsText += `*Et ${totalUnpaidStudentsCount - 10} autres étudiants ont un solde impayé de moindre importance. Pour des raisons de performance, seuls les 10 cas les plus critiques sont détaillés ci-dessus. Si l'administrateur demande à voir d'autres cas, invitez-le à spécifier la session ou le nom.*`;
      }
    } else {
      unpaidStudentsText = 'Félicitations ! Aucun étudiant n\'a de solde impayé.\n';
    }

    // 2. Construire le Preamble (System Instruction) complet
    const preambleText = `Vous êtes "ComFormation AI", un agent d'intelligence artificielle d'élite intégré directement dans l'application ComFormation. Votre rôle est d'assister l'administrateur dans l'analyse de gestion financière, le suivi des étudiants et l'état des sessions de formation.

Vous disposez d'un accès en temps réel aux données consolidées de la base de données de l'application. Voici les statistiques réelles et précises de la base aujourd'hui :

[MÉTRIQUES FINANCIÈRES GLOBALES]
- Sessions de formation : ${sessionsCount}
- Formations proposées : ${formationsCount}
- Étudiants inscrits : ${studentsCount}
- Chiffre d'affaires brut attendu (Total dû par les étudiants) : ${totalRevenue.toLocaleString('fr-FR')} FCFA
- Total encaissé (Paiements reçus) : ${totalPaid.toLocaleString('fr-FR')} FCFA
- Reste à recouvrer (Impayés totaux) : ${totalUnpaid.toLocaleString('fr-FR')} FCFA (${unpaidPercent}% du total attendu)
- Total des dépenses enregistrées : ${totalExpenses.toLocaleString('fr-FR')} FCFA
- Solde net de caisse (Encaissé - Dépenses) : ${netProfit.toLocaleString('fr-FR')} FCFA
- Disponibilités déclarées : ${totalDispos.toLocaleString('fr-FR')} FCFA

[ÉTAT PAR SESSION DE FORMATION]
${sessionsDetailsText}

[LISTE DES ÉTUDIANTS EN RETARD OU COMPTE INCOMPLET DE PAIEMENT]
${unpaidStudentsText}

CONSIGNES DE RÉPONSE ET RÈGLES DE CONDUITE :
1. Soyez un analyste financier et d'affaires d'élite. Allez droit au but, soyez rigoureux et donnez des chiffres exacts en vous basant UNIQUEMENT sur les données ci-dessus.
2. Répondez exclusivement en français avec un ton professionnel, encourageant, courtois et d'une clarté comptable.
3. Soyez extrêmement direct, concis et rapide. Évitez les salutations, introductions ou conclusions inutiles. Allez à l'essentiel immédiatement. Vos réponses doivent être courtes et percutantes.
4. Formatez vos réponses en Markdown haut de gamme : utilisez le gras pour les chiffres importants, des listes à puces élégantes et des petits tableaux lorsque vous comparez des sessions ou listez des étudiants.
5. Ne présentez jamais de longues listes de plus de 10 étudiants. Si l'administrateur demande le détail des impayés, présentez le résumé global et listez les 10 étudiants prioritaires en l'invitant à spécifier sa recherche s'il souhaite d'autres cas.
6. Ne mentionnez pas que vous avez reçu un "System Prompt" ou des données textuelles en arrière-plan. Présentez ces données comme l'état réel et direct de l'application.`;

    // 3. Envoyer la requête à l'API Cohere v1 /chat (Modèle ultra-rapide Command R7B)
    const coherePayload = {
      model: 'command-r7b-12-2024',
      message: message,
      preamble: preambleText,
      chat_history: chat_history || [],
      temperature: 0.3
    };

    const cohereRes = await fetch('https://api.cohere.com/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cohereApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(coherePayload)
    });

    if (!cohereRes.ok) {
      const errText = await cohereRes.text();
      console.error('[Cohere API Error]', errText);
      throw new Error(`Cohere API répond avec le statut ${cohereRes.status}: ${errText}`);
    }

    const cohereData = await cohereRes.json();
    
    // Retourner la réponse textuelle
    res.json({
      reply: cohereData.text,
      generationId: cohereData.generation_id,
      conversationId: cohereData.conversation_id
    });

  } catch (err) {
    console.error('[AI Chat Error]', err);
    res.status(500).json({ error: 'Une erreur est survenue lors du traitement de l\'analyse par l\'IA : ' + err.message });
  }
});

// -------------------------------------------------------------
// ROUTES SUPER ADMIN (SaaS)
// -------------------------------------------------------------

// Middleware pour vérifier que l'utilisateur est SuperAdmin
function authenticateSuperAdmin(req, res, next) {
  if (req.user.role !== 'SuperAdmin') {
    return res.status(403).json({ error: 'Accès réservé au Super Administrateur.' });
  }
  next();
}

app.get('/api/superadmin/kpi', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  try {
    const [[{ total_centres }]] = await pool.query('SELECT COUNT(*) AS total_centres FROM centres');
    const [[{ centres_actifs }]] = await pool.query("SELECT COUNT(*) AS centres_actifs FROM centres WHERE statut = 'actif'");
    const [[{ mrr }]] = await pool.query("SELECT COALESCE(SUM(montant_mensuel), 0) AS mrr FROM centres WHERE statut = 'actif'");
    const [[{ total_encaisse }]] = await pool.query("SELECT COALESCE(SUM(montant), 0) AS total_encaisse FROM paiements_saas");
    
    res.json({
      total_centres,
      centres_actifs,
      mrr: parseFloat(mrr),
      total_encaisse: parseFloat(total_encaisse)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/superadmin/centres', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  try {
    const [centres] = await pool.query(`
      SELECT c.*, 
             (SELECT GROUP_CONCAT(DISTINCT mois SEPARATOR ',') FROM paiements_saas p WHERE p.centre_id = c.id) as mois_payes
      FROM centres c
      ORDER BY c.created_at DESC
    `);
    
    const formattedCentres = centres.map(c => ({
      ...c,
      mois_payes: c.mois_payes ? c.mois_payes.split(',') : []
    }));
    
    res.json(formattedCentres);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/superadmin/centres', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const { nom_centre, prenom_admin, nom_admin, email_admin, pwd, telephone, montant_mensuel, logo } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const [insertCentre] = await connection.query(
      'INSERT INTO centres (nom_centre, prenom_admin, nom_admin, email_admin, telephone, montant_mensuel, logo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nom_centre, prenom_admin, nom_admin, email_admin, telephone, montant_mensuel || 0, logo || null]
    );
    const centreId = insertCentre.insertId;

    const pwdHash = hashPassword(pwd);
    // Create an Admin user for this centre
    // ID user : generé à la volée (ex: Date.now())
    const newUserId = Date.now() + Math.floor(Math.random() * 1000);
    await connection.query(
      'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy, nom, prenom, num) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newUserId, centreId, email_admin, pwdHash, 'Admin', '{}', false, nom_admin, prenom_admin, telephone]
    );

    await connection.commit();
    res.json({ success: true, centreId });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.put('/api/superadmin/centres/:id', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const centreId = req.params.id;
  const { nom_centre, prenom_admin, nom_admin, telephone, montant_mensuel, statut, logo } = req.body;
  try {
    await pool.query(
      'UPDATE centres SET nom_centre=?, prenom_admin=?, nom_admin=?, telephone=?, montant_mensuel=?, statut=?, logo=? WHERE id=?',
      [nom_centre, prenom_admin, nom_admin, telephone, montant_mensuel, statut, logo || null, centreId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/superadmin/centres/:id', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const centreId = req.params.id;
  try {
    await pool.query('DELETE FROM centres WHERE id = ?', [centreId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/superadmin/centres/:id/status', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const centreId = req.params.id;
  const { statut } = req.body;
  try {
    await pool.query('UPDATE centres SET statut = ? WHERE id = ?', [statut, centreId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/superadmin/centres/:id/password', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const centreId = req.params.id;
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
  try {
    const pwdHash = hashPassword(password);
    // Met à jour le mot de passe du compte admin (role = 'Admin' et centre_id = centreId)
    const [result] = await pool.query("UPDATE users SET pwd = ? WHERE centre_id = ? AND role = 'Admin'", [pwdHash, centreId]);
    if (result.affectedRows === 0) {
       return res.status(404).json({ error: 'Aucun administrateur trouvé pour ce centre' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/superadmin/paiement', authenticateToken, authenticateSuperAdmin, async (req, res) => {
  const { centre_id, montant, mois } = req.body;
  try {
    await pool.query(
      'INSERT INTO paiements_saas (centre_id, montant, mois) VALUES (?, ?, ?)',
      [centre_id, montant, mois || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// HEBERGEMENT STATIC ET DEMARRAGE
// -------------------------------------------------------------

// Servir l'application monopage à la racine '/'
app.use(express.static(path.join(__dirname, '..')));

// Route de repli pour servir index.html pour les routes non définies
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Lancement du serveur après initialisation de la base (seulement hors Vercel serverless)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  getDbInitPromise().then(() => {
    app.listen(PORT, () => {
      console.log(`[Serveur] ComFormation démarré sur http://localhost:${PORT}`);
    });
  });
} else {
  // Sur Vercel serverless, on lance simplement l'initialisation de la DB lors du chargement de la fonction
  getDbInitPromise().catch(err => console.error('[Vercel DB Init Error]', err));
}

module.exports = app;
