const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration du pool MySQL / TiDB
const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'comformation_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Activer SSL si nécessaire (indispensable pour TiDB Cloud sur Render)
if (process.env.DB_SSL === 'true') {
  dbConfig.ssl = {
    rejectUnauthorized: false // Permet les connexions SSL sécurisées sans erreur de certificat auto-signé
  };
}

const pool = mysql.createPool(dbConfig);

// Fonction de hachage djb2 identique au frontend
function hashPassword(pwd) {
  let hash = 5381;
  const salt = 'CF@2025!';
  const str = salt + pwd + salt.split('').reverse().join('');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return 'h' + Math.abs(hash).toString(36) + str.length.toString(36);
}

// Initialisation et bootstrapping automatique de la base de données
async function initializeDatabase() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('[DB] Connexion réussie à MySQL/TiDB !');

    // Lire schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sqlSchema = fs.readFileSync(schemaPath, 'utf8');
      
      // Séparer les requêtes de schema.sql (en enlevant les lignes vides et commentaires)
      const queries = sqlSchema
        .split(';')
        .map(q => q.trim())
        .filter(q => q.length > 0 && !q.startsWith('--'));

      console.log('[DB] Initialisation des tables...');
      for (const query of queries) {
        await connection.query(query);
      }
      console.log('[DB] Tables vérifiées/créées avec succès.');

      // Seeder l'administrateur et l'employé par défaut s'ils n'existent pas
      // IDs fixes pour correspondre exactement aux IDs utilisés dans le frontend (IndexedDB)
      const ADMIN_ID = 1716000000001;
      const EMP_ID   = 1716000000002;

      const [adminRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['nassuf@gmail.com']);
      if (adminRows.length === 0) {
        const adminPwdHash = hashPassword('Passer123');
        await connection.query(
          'INSERT INTO users (id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?)',
          [ADMIN_ID, 'nassuf@gmail.com', adminPwdHash, 'Admin', '{}', false]
        );
        console.log('[DB] Seeding : Administrateur par défaut créé (login: nassuf@gmail.com, ID: '+ADMIN_ID+')');
      }
      
      const [empRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['abdou@gmail.com']);
      if (empRows.length === 0) {
        const empPwdHash = hashPassword('Passer123');
        await connection.query(
          'INSERT INTO users (id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?)',
          [EMP_ID, 'abdou@gmail.com', empPwdHash, 'User', '{}', false]
        );
        console.log('[DB] Seeding : Employé par défaut créé (login: abdou@gmail.com, ID: '+EMP_ID+')');
      }
    } else {
      console.warn('[DB Warning] Fichier schema.sql introuvable.');
    }
  } catch (err) {
    console.error('[DB Error] Impossible d\'initialiser la base de données :', err.message);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
  hashPassword
};
