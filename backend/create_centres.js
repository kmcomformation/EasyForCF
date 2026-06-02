const { pool } = require('./db');

async function createTables() {
  let connection;
  try {
    connection = await pool.getConnection();
    
    await connection.query(`
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
    console.log("Table centres créée ou vérifiée.");
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS paiements_saas (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        centre_id BIGINT NOT NULL,
        montant DECIMAL(15, 2) NOT NULL,
        date_paiement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
      )
    `);
    console.log("Table paiements_saas créée ou vérifiée.");

    process.exit(0);
  } catch (err) {
    console.error("Erreur:", err);
    process.exit(1);
  } finally {
    if (connection) connection.release();
  }
}

createTables();
