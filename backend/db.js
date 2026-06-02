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
  database: (process.env.VERCEL && (!process.env.DB_NAME || process.env.DB_NAME === 'comformation_db')) ? 'comformation' : (process.env.DB_NAME || 'comformation_db'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Activer SSL si nécessaire (indispensable pour TiDB Cloud)
if (process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST.includes('tidbcloud.com'))) {
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

      // --- AUTOMATIC SAAS MIGRATIONS PART 1: ADD centre_id COLUMN ---
      console.log('[DB] Vérification/Ajout de la colonne centre_id...');
      const tablesToAlter = ['users', 'sessions', 'formations', 'etudiants', 'paiements', 'depenses', 'disponibilites', 'backups'];
      for (const table of tablesToAlter) {
        try {
          await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN centre_id BIGINT NULL`);
          console.log(`[DB Migration] Colonne centre_id ajoutée/vérifiée dans la table ${table}.`);
        } catch (err) {
          if (err.code !== 'ER_DUP_FIELDNAME' && err.errno !== 1060) {
            console.warn(`[DB Migration Warning] Impossible d'ajouter centre_id à ${table}:`, err.message);
          }
        }
      }

      // Seeder le Super Administrateur (SaaS)
      const SUPER_ADMIN_ID = 1716000000000;
      const [superAdminRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['nassufsoule@gmail.com']);
      if (superAdminRows.length === 0) {
        const superAdminPwdHash = hashPassword('Passer123');
        await connection.query(
          'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [SUPER_ADMIN_ID, null, 'nassufsoule@gmail.com', superAdminPwdHash, 'SuperAdmin', '{}', false]
        );
        console.log('[DB] Seeding : Super Administrateur créé (login: nassufsoule@gmail.com)');
      }

      // Créer un centre par défaut pour les anciens comptes s'il n'y en a pas
      let defaultCentreId = null;
      const [centreRows] = await connection.query('SELECT id FROM centres LIMIT 1');
      if (centreRows.length === 0) {
        const [insertCentre] = await connection.query(
          'INSERT INTO centres (nom_centre, prenom_admin, nom_admin, email_admin, telephone, montant_mensuel) VALUES (?, ?, ?, ?, ?, ?)',
          ['ComFormation Default', 'Admin', 'Default', 'nassuf@gmail.com', '', 0]
        );
        defaultCentreId = insertCentre.insertId;
        console.log('[DB] Seeding : Centre par défaut créé (ID: ' + defaultCentreId + ')');
      } else {
        defaultCentreId = centreRows[0].id;
      }

      // Seeder l'administrateur et l'employé par défaut s'ils n'existent pas
      // IDs fixes pour correspondre exactement aux IDs utilisés dans le frontend (IndexedDB)
      const ADMIN_ID = 1716000000001;
      const EMP_ID   = 1716000000002;

      const [adminRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['nassuf@gmail.com']);
      if (adminRows.length === 0) {
        const adminPwdHash = hashPassword('Passer123');
        await connection.query(
          'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [ADMIN_ID, defaultCentreId, 'nassuf@gmail.com', adminPwdHash, 'Admin', '{}', false]
        );
        console.log('[DB] Seeding : Administrateur par défaut créé (login: nassuf@gmail.com, ID: '+ADMIN_ID+')');
      }
      
      const [empRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['abdou@gmail.com']);
      if (empRows.length === 0) {
        const empPwdHash = hashPassword('Passer123');
        await connection.query(
          'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [EMP_ID, defaultCentreId, 'abdou@gmail.com', empPwdHash, 'User', '{}', false]
        );
        console.log('[DB] Seeding : Employé par défaut créé (login: abdou@gmail.com, ID: '+EMP_ID+')');
      }

      // --- AUTOMATIC SAAS MIGRATIONS PART 2 ---
      console.log('[DB] Lancement des migrations automatiques SaaS (Partie 2)...');
      
      // 2. Remplir les enregistrements orphelins (centre_id IS NULL) avec le centre par défaut
      for (const table of tablesToAlter) {
        try {
          const [res] = await connection.query(`UPDATE \`${table}\` SET centre_id = ? WHERE centre_id IS NULL`, [defaultCentreId]);
          if (res.affectedRows > 0) {
            console.log(`[DB Migration] ${res.affectedRows} enregistrements orphelins associés au centre par défaut dans ${table}.`);
          }
        } catch (err) {
          console.warn(`[DB Migration Warning] Impossible de mettre à jour ${table}:`, err.message);
        }
      }

      // Helper pour vérifier la présence d'un index
      const checkIndexExists = async (tbl, key) => {
        try {
          const [indexes] = await connection.query(`SHOW INDEX FROM \`${tbl}\``);
          return indexes.some(idx => idx.Key_name === key);
        } catch (e) {
          return false;
        }
      };

      // 3. Modifier la contrainte d'unicité de sessions.code
      const sessionsCodeExists = await checkIndexExists('sessions', 'code');
      if (sessionsCodeExists) {
        try {
          await connection.query('ALTER TABLE sessions DROP INDEX code');
          console.log('[DB Migration] Index unique global "code" supprimé de la table sessions.');
        } catch (err) {
          console.warn('[DB Migration Warning] Impossible de supprimer l\'index "code" de sessions:', err.message);
        }
      }

      const sessionsCompositeExists = await checkIndexExists('sessions', 'unique_centre_code');
      if (!sessionsCompositeExists) {
        try {
          await connection.query('ALTER TABLE sessions ADD UNIQUE KEY unique_centre_code (centre_id, code)');
          console.log('[DB Migration] Index unique composite "unique_centre_code" (centre_id, code) ajouté à la table sessions.');
        } catch (err) {
          console.warn('[DB Migration Warning] Impossible de créer l\'index composite sur sessions:', err.message);
        }
      }

      // 4. Modifier la contrainte d'unicité de etudiants.mat
      const etudiantsMatExists = await checkIndexExists('etudiants', 'mat');
      if (etudiantsMatExists) {
        try {
          await connection.query('ALTER TABLE etudiants DROP INDEX mat');
          console.log('[DB Migration] Index unique global "mat" supprimé de la table etudiants.');
        } catch (err) {
          console.warn('[DB Migration Warning] Impossible de supprimer l\'index "mat" de etudiants:', err.message);
        }
      }

      const etudiantsCompositeExists = await checkIndexExists('etudiants', 'unique_centre_mat');
      if (!etudiantsCompositeExists) {
        try {
          await connection.query('ALTER TABLE etudiants ADD UNIQUE KEY unique_centre_mat (centre_id, mat)');
          console.log('[DB Migration] Index unique composite "unique_centre_mat" (centre_id, mat) ajouté à la table etudiants.');
        } catch (err) {
          console.warn('[DB Migration Warning] Impossible de créer l\'index composite sur etudiants:', err.message);
        }
      }

      console.log('[DB] Migrations automatiques SaaS terminées avec succès.');
    } else {
      console.warn('[DB Warning] Fichier schema.sql introuvable.');
    }
  } catch (err) {
    console.error('[DB Error] Impossible d\'initialiser la base de données :', err.message);
  } finally {
    if (connection) connection.release();
  }
}

// Fonction de seeding à la demande pour l'auto-guérison
async function seedDefaultUsers() {
  let connection;
  try {
    connection = await pool.getConnection();
    const SUPER_ADMIN_ID = 1716000000000;
    const ADMIN_ID = 1716000000001;
    const EMP_ID   = 1716000000002;

    const [superAdminRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['nassufsoule@gmail.com']);
    if (superAdminRows.length === 0) {
      const superAdminPwdHash = hashPassword('Passer123');
      await connection.query(
        'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [SUPER_ADMIN_ID, null, 'nassufsoule@gmail.com', superAdminPwdHash, 'SuperAdmin', '{}', false]
      );
    }

    let defaultCentreId = null;
    const [centreRows] = await connection.query('SELECT id FROM centres LIMIT 1');
    if (centreRows.length > 0) {
      defaultCentreId = centreRows[0].id;
    } else {
       const [insertCentre] = await connection.query(
         'INSERT INTO centres (nom_centre, prenom_admin, nom_admin, email_admin, telephone, montant_mensuel) VALUES (?, ?, ?, ?, ?, ?)',
         ['ComFormation Default', 'Admin', 'Default', 'nassuf@gmail.com', '', 0]
       );
       defaultCentreId = insertCentre.insertId;
    }

    const [adminRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['nassuf@gmail.com']);
    if (adminRows.length === 0) {
      const adminPwdHash = hashPassword('Passer123');
      await connection.query(
        'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [ADMIN_ID, defaultCentreId, 'nassuf@gmail.com', adminPwdHash, 'Admin', '{}', false]
      );
      console.log('[DB] Seeding (On-Demand) : Administrateur créé.');
    }
    
    const [empRows] = await connection.query('SELECT * FROM users WHERE login = ?', ['abdou@gmail.com']);
    if (empRows.length === 0) {
      const empPwdHash = hashPassword('Passer123');
      await connection.query(
        'INSERT INTO users (id, centre_id, login, pwd, role, perms, legacy) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [EMP_ID, defaultCentreId, 'abdou@gmail.com', empPwdHash, 'User', '{}', false]
      );
      console.log('[DB] Seeding (On-Demand) : Employé créé.');
    }
    return true;
  } catch (err) {
    console.error('[DB Error] Seeding à la demande échoué :', err.message);
    return false;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initializeDatabase,
  hashPassword,
  seedDefaultUsers
};
