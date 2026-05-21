const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const { pool, initializeDatabase, hashPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'comformation_secret_jwt_token_2026_cf6';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Limite élevée pour pouvoir envoyer les photos des étudiants
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Whitelist des colonnes valides pour chaque table SQL pour éviter toute injection ou erreur de champ
const VALID_COLUMNS = {
  users: ['id', 'login', 'pwd', 'role', 'perms', 'legacy', 'nom', 'prenom', 'num'],
  sessions: ['id', 'code', 'det', 'closed'],
  formations: ['id', 'label'],
  etudiants: ['id', 'mat', 'nom', 'prenom', 'contact', 'cout', 'date', 'echeance', 'sesId', 'formId', 'photo', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  paiements: ['id', 'etuId', 'nom', 'mat', 'montant', 'date', 'sesId', 'formId', 'createdBy', 'createdAt'],
  depenses: ['id', 'lib', 'montant', 'date', 'sesId', 'det', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'],
  disponibilites: ['id', 'responsable', 'montant', 'detail', 'date', 'createdBy', 'createdAt', 'updatedBy'],
  backups: ['id', 'name', 'date', 'type', 'data']
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

// Connexion avec email et mot de passe (mécanisme ComFormation)
app.post('/api/login', async (req, res) => {
  const { email, pwd } = req.body;

  if (!email || !pwd) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  try {
    // Récupérer l'utilisateur correspondant à l'email (login)
    const [users] = await pool.query('SELECT * FROM users WHERE login = ?', [email]);
    
    if (users.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects. Accès refusé.' });
    }
    
    const u = users[0];
    if (!verifyPassword(pwd, u.pwd)) {
      return res.status(401).json({ error: 'Identifiants incorrects. Accès refusé.' });
    }

    // Générer le JWT
    const token = jwt.sign(
      { id: u.id, login: u.login, role: u.role },
      JWT_SECRET,
      { expiresIn: '30d' } // Session valide 30 jours
    );

    // Retourner le token et l'utilisateur
    res.json({
      token,
      user: {
        id: u.id,
        login: u.login,
        role: u.role,
        perms: u.perms ? (typeof u.perms === 'string' ? JSON.parse(u.perms) : u.perms) : {}
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
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé.' });
    }
    const u = rows[0];
    res.json({
      id: u.id,
      login: u.login,
      role: u.role,
      perms: u.perms ? JSON.parse(u.perms) : {}
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

  // Sécurité: Vérifier que la table demandée est autorisée
  if (!VALID_COLUMNS[table]) {
    return res.status(400).json({ error: `Table '${table}' non autorisée.` });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (action === 'CREATE') {
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
      
      // Ajouter l'ID à la fin pour la clause WHERE
      values.push(recordId);

      const updateClauses = fields.map(col => `\`${col}\` = ?`).join(', ');
      const sql = `UPDATE \`${table}\` SET ${updateClauses} WHERE id = ?`;
      await connection.query(sql, values);

    } else if (action === 'DELETE') {
      // Suppression de l'enregistrement
      await connection.query(`DELETE FROM \`${table}\` WHERE id = ?`, [recordId]);
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
    const [users] = await pool.query('SELECT id, login, pwd, role, perms, legacy, nom, prenom, num FROM users');
    const [sessions] = await pool.query('SELECT * FROM sessions');
    const [formations] = await pool.query('SELECT * FROM formations');
    const [etudiants] = await pool.query('SELECT * FROM etudiants');
    const [paiements] = await pool.query('SELECT * FROM paiements');
    const [depenses] = await pool.query('SELECT * FROM depenses');
    const [disponibilites] = await pool.query('SELECT * FROM disponibilites');
    const [backups] = await pool.query('SELECT id, name, date, type, data FROM backups');

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
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    await connection.query('DELETE FROM paiements');
    await connection.query('DELETE FROM etudiants');
    await connection.query('DELETE FROM depenses');
    await connection.query('DELETE FROM disponibilites');
    await connection.query('DELETE FROM sessions');
    await connection.query('DELETE FROM formations');
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
  initializeDatabase().then(() => {
    app.listen(PORT, () => {
      console.log(`[Serveur] ComFormation démarré sur http://localhost:${PORT}`);
    });
  });
} else {
  // Sur Vercel serverless, on lance simplement l'initialisation de la DB lors du chargement de la fonction
  initializeDatabase().catch(err => console.error('[Vercel DB Init Error]', err));
}

module.exports = app;
