-- Schéma SQL pour ComFormation (MySQL / TiDB Cloud)

-- Table des utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  login VARCHAR(50) UNIQUE NOT NULL,
  pwd VARCHAR(255) NOT NULL DEFAULT '',
  role VARCHAR(20) NOT NULL,
  perms TEXT NULL,
  legacy BOOLEAN DEFAULT FALSE,
  nom VARCHAR(80) NULL,
  prenom VARCHAR(80) NULL,
  num VARCHAR(30) NULL
);

-- Table des sessions
CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  det VARCHAR(100) NOT NULL,
  closed BOOLEAN DEFAULT FALSE
);

-- Table des formations
CREATE TABLE IF NOT EXISTS formations (
  id BIGINT PRIMARY KEY,
  label VARCHAR(100) NOT NULL
);

-- Table des étudiants
CREATE TABLE IF NOT EXISTS etudiants (
  id BIGINT PRIMARY KEY,
  mat VARCHAR(30) UNIQUE NOT NULL,
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
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (formId) REFERENCES formations(id) ON DELETE SET NULL
);

-- Table des paiements
CREATE TABLE IF NOT EXISTS paiements (
  id BIGINT PRIMARY KEY,
  etuId BIGINT NULL,
  nom VARCHAR(200) NOT NULL,
  mat VARCHAR(20) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  sesId BIGINT NULL,
  formId BIGINT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  FOREIGN KEY (etuId) REFERENCES etudiants(id) ON DELETE CASCADE,
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL,
  FOREIGN KEY (formId) REFERENCES formations(id) ON DELETE SET NULL
);

-- Table des dépenses
CREATE TABLE IF NOT EXISTS depenses (
  id BIGINT PRIMARY KEY,
  lib VARCHAR(120) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  sesId BIGINT NULL,
  det TEXT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  updatedBy BIGINT NULL,
  updatedAt DATE NULL,
  FOREIGN KEY (sesId) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Table des disponibilités (Caisse)
CREATE TABLE IF NOT EXISTS disponibilites (
  id BIGINT PRIMARY KEY,
  responsable VARCHAR(100) NOT NULL,
  montant DECIMAL(15, 2) NOT NULL DEFAULT 0,
  detail TEXT NULL,
  date DATE NOT NULL,
  createdBy BIGINT NULL,
  createdAt DATE NULL,
  updatedBy BIGINT NULL
);

-- Table des sauvegardes (Backups)
CREATE TABLE IF NOT EXISTS backups (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  date VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL,
  data LONGTEXT NOT NULL
);
