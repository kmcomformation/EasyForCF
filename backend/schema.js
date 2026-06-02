// Schema SQL exported as JS string to guarantee Vercel bundling
module.exports = `-- Schéma SQL pour ComFormation (MySQL / TiDB Cloud)

-- Table des centres de formation (SaaS)
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
);

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  login VARCHAR(50) UNIQUE NOT NULL,
  pwd VARCHAR(255) NOT NULL DEFAULT '',
  role VARCHAR(20) NOT NULL,
  perms TEXT NULL,
  legacy BOOLEAN DEFAULT FALSE,
  nom VARCHAR(80) NULL,
  prenom VARCHAR(80) NULL,
  num VARCHAR(30) NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
);

-- Table des sessions
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  code VARCHAR(20) NOT NULL,
  det VARCHAR(100) NOT NULL,
  closed BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE,
  UNIQUE(centre_id, code)
);

-- Table des formations
CREATE TABLE IF NOT EXISTS formations (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  label VARCHAR(100) NOT NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
);

-- Table des étudiants
CREATE TABLE IF NOT EXISTS etudiants (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  mat VARCHAR(30) NOT NULL,
  nom VARCHAR(80) NOT NULL,
  prenom VARCHAR(80) NOT NULL,
  contact VARCHAR(30) NULL,
  cout DECIMAL(15, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  echeance DATE NULL,
  sesId BIGINT NULL,
  formId BIGINT NULL,
  photo LONGTEXT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  updatedBy BIGINT NULL,
  updatedAt DATE NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE,
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (formId) REFERENCES formations(id) ON DELETE SET NULL,
  UNIQUE(centre_id, mat)
);

-- Table des paiements
CREATE TABLE IF NOT EXISTS paiements (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  etuId BIGINT NULL,
  nom VARCHAR(200) NOT NULL,
  mat VARCHAR(20) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  sesId BIGINT NULL,
  formId BIGINT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE,
  FOREIGN KEY (etuId) REFERENCES etudiants(id) ON DELETE CASCADE,
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (formId) REFERENCES formations(id) ON DELETE SET NULL
);

-- Table des dépenses
CREATE TABLE IF NOT EXISTS depenses (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  lib VARCHAR(120) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  sesId BIGINT NULL,
  det TEXT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  updatedBy BIGINT NULL,
  updatedAt DATE NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE,
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Table des disponibilités (Caisse)
CREATE TABLE IF NOT EXISTS disponibilites (
  id BIGINT PRIMARY KEY,
  centre_id BIGINT NULL,
  responsable VARCHAR(100) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  detail TEXT NULL,
  date DATE NOT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  updatedBy BIGINT NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
);

-- Table des sauvegardes (Backups)
CREATE TABLE IF NOT EXISTS backups (
  id VARCHAR(50) PRIMARY KEY,
  centre_id BIGINT NULL,
  name VARCHAR(255) NOT NULL,
  date VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL,
  data LONGTEXT NOT NULL,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
);

-- Table des paiements SaaS (Super Admin suit qui a payé)
CREATE TABLE IF NOT EXISTS paiements_saas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  centre_id BIGINT NOT NULL,
  montant DECIMAL(15, 2) NOT NULL,
  date_paiement TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (centre_id) REFERENCES centres(id) ON DELETE CASCADE
);
`;
