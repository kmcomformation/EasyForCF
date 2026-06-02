const { pool, hashPassword } = require('./db');
async function fixOrphans() {
  const connection = await pool.getConnection();
  try {
    const [centres] = await connection.query("SELECT id FROM centres WHERE nom_centre = 'ComFormation Default'");
    let defaultId = null;
    if (centres.length > 0) {
      defaultId = centres[0].id;
    } else {
       const [insertCentre] = await connection.query(
         'INSERT INTO centres (nom_centre, prenom_admin, nom_admin, email_admin, telephone, montant_mensuel) VALUES (?, ?, ?, ?, ?, ?)',
         ['ComFormation Default', 'Admin', 'Default', 'nassuf@gmail.com', '', 0]
       );
       defaultId = insertCentre.insertId;
    }

    const tables = ['users', 'sessions', 'formations', 'etudiants', 'paiements', 'depenses', 'disponibilites', 'backups'];
    for (const table of tables) {
      if (table === 'users') {
        await connection.query(`UPDATE users SET centre_id = ? WHERE centre_id IS NULL AND role != 'SuperAdmin'`, [defaultId]);
      } else {
        await connection.query(`UPDATE \`${table}\` SET centre_id = ? WHERE centre_id IS NULL`, [defaultId]);
      }
    }
    
    await connection.query("UPDATE users SET pwd = ? WHERE login = 'nassufsoule@gmail.com'", [hashPassword('nassuf2026')]);
    
    console.log("Orphans fixed. SuperAdmin password set.");
  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit(0);
  }
}
fixOrphans();
