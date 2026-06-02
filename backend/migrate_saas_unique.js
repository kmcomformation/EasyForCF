const { pool } = require('./db');

async function runMigration() {
  let connection;
  try {
    connection = await pool.getConnection();
    console.log('[Migration] Connection successful. Starting SaaS Unique Constraints Migration...');

    // 1. Find default centre ID
    const [centreRows] = await connection.query('SELECT id FROM centres ORDER BY id ASC LIMIT 1');
    if (centreRows.length === 0) {
      console.error('[Migration Error] No centre found in database. Please run seed or start server first.');
      process.exit(1);
    }
    const defaultCentreId = centreRows[0].id;
    console.log(`[Migration] Default Centre ID: ${defaultCentreId}`);

    // 2. Fix NULL centre_id for all tables
    const tables = ['users', 'sessions', 'formations', 'etudiants', 'paiements', 'depenses', 'disponibilites', 'backups'];
    for (const table of tables) {
      const [res] = await connection.query(`UPDATE \`${table}\` SET centre_id = ? WHERE centre_id IS NULL`, [defaultCentreId]);
      if (res.affectedRows > 0) {
        console.log(`[Migration] Updated ${res.affectedRows} orphaned records in table '${table}' to centre_id = ${defaultCentreId}`);
      }
    }

    // Helper function to check if index exists
    const hasIndex = async (table, keyName) => {
      const [indexes] = await connection.query(`SHOW INDEX FROM \`${table}\``);
      return indexes.some(idx => idx.Key_name === keyName);
    };

    // 3. Drop global unique constraint on sessions.code and add composite index
    console.log('[Migration] Modifying sessions table constraints...');
    const hasSessionsCodeIndex = await hasIndex('sessions', 'code');
    if (hasSessionsCodeIndex) {
      await connection.query('ALTER TABLE sessions DROP INDEX code');
      console.log('[Migration] Dropped global unique index on sessions(code).');
    } else {
      console.log('[Migration] Global unique index on sessions(code) not found or already dropped.');
    }

    const hasSessionsCompositeIndex = await hasIndex('sessions', 'unique_centre_code') || await hasIndex('sessions', 'centre_id'); // check if it exists in another name
    // Let's add it if unique_centre_code doesn't exist
    const hasSpecificComposite = await hasIndex('sessions', 'unique_centre_code');
    if (!hasSpecificComposite) {
      try {
        await connection.query('ALTER TABLE sessions ADD UNIQUE KEY unique_centre_code (centre_id, code)');
        console.log('[Migration] Added composite unique index unique_centre_code (centre_id, code).');
      } catch (err) {
        console.error('[Migration Error] Failed to add sessions composite key:', err.message);
      }
    } else {
      console.log('[Migration] Composite unique index on sessions (centre_id, code) already exists.');
    }

    // 4. Drop global unique constraint on etudiants.mat and add composite index
    console.log('[Migration] Modifying etudiants table constraints...');
    const hasEtudiantsMatIndex = await hasIndex('etudiants', 'mat');
    if (hasEtudiantsMatIndex) {
      await connection.query('ALTER TABLE etudiants DROP INDEX mat');
      console.log('[Migration] Dropped global unique index on etudiants(mat).');
    } else {
      console.log('[Migration] Global unique index on etudiants(mat) not found or already dropped.');
    }

    const hasEtudiantsComposite = await hasIndex('etudiants', 'unique_centre_mat');
    if (!hasEtudiantsComposite) {
      try {
        await connection.query('ALTER TABLE etudiants ADD UNIQUE KEY unique_centre_mat (centre_id, mat)');
        console.log('[Migration] Added composite unique index unique_centre_mat (centre_id, mat).');
      } catch (err) {
        console.error('[Migration Error] Failed to add etudiants composite key:', err.message);
      }
    } else {
      console.log('[Migration] Composite unique index on etudiants (centre_id, mat) already exists.');
    }

    console.log('[Migration] Unique constraints migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error] Migration failed:', err);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

runMigration();
