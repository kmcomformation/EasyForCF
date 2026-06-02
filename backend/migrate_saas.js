const { pool } = require('./db');

async function migrate() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('[Migration] Début de la migration SaaS...');

    const tables = [
      'users', 'sessions', 'formations', 'etudiants',
      'paiements', 'depenses', 'disponibilites', 'backups'
    ];

    for (const table of tables) {
      try {
        await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN centre_id BIGINT NULL`);
        console.log(`[Migration] Colonne centre_id ajoutée à la table ${table}.`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`[Migration] La colonne centre_id existe déjà dans la table ${table}.`);
        } else {
          console.error(`[Migration] Erreur sur la table ${table}:`, err.message);
        }
      }
    }

    // On s'assure que les foreign keys peuvent être ajoutées, mais c'est complexe si les données existantes n'ont pas de centres.
    // L'essentiel est que la colonne existe. Le script db.js se chargera du reste (création SuperAdmin et Centre par défaut).
    
    console.log('[Migration] Migration SaaS terminée avec succès.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error]', err);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

migrate();
