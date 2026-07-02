-- SBSEPS default MariaDB schema for Linux deployments.
-- Run as a MariaDB administrator:
--   sudo mariadb < schema.sql

CREATE DATABASE IF NOT EXISTS SBSEPS
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'seguridadinf'@'localhost' IDENTIFIED BY 'seguridadinf';
CREATE USER IF NOT EXISTS 'seguridadinf'@'%' IDENTIFIED BY 'seguridadinf';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON SBSEPS.* TO 'seguridadinf'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON SBSEPS.* TO 'seguridadinf'@'%';

FLUSH PRIVILEGES;

USE SBSEPS;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(80) PRIMARY KEY,
    description VARCHAR(255),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'auditor',
    password_hash VARCHAR(200) NOT NULL,
    password_salt VARCHAR(80) NOT NULL,
    active TINYINT DEFAULT 1,
    must_change_password TINYINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(80) PRIMARY KEY,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS controls (
    id VARCHAR(30) PRIMARY KEY,
    excel_index INT DEFAULT 0,
    category VARCHAR(255),
    subcategory VARCHAR(255),
    control_text TEXT,
    requirement_text TEXT,
    ev_source TEXT,
    normative VARCHAR(80),
    control_type VARCHAR(255),
    domain TEXT,
    default_score VARCHAR(20) DEFAULT '',
    default_state VARCHAR(40) DEFAULT 'Por evaluar',
    default_comment TEXT,
    default_evidence TEXT,
    topic VARCHAR(255),
    priority VARCHAR(40) DEFAULT 'Media',
    rec_action_short TEXT,
    rec_action_detail TEXT,
    timeframe VARCHAR(80),
    risk_weight DECIMAL(8,2) DEFAULT 0,
    phase VARCHAR(255),
    active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluations (
    id VARCHAR(80) PRIMARY KEY,
    company_name VARCHAR(150) NOT NULL,
    evaluator_name VARCHAR(150) NOT NULL,
    evaluation_date VARCHAR(20) NOT NULL,
    compliance_pct DECIMAL(5,2) DEFAULT 0.00,
    total_controls INT DEFAULT 0,
    compliant_controls INT DEFAULT 0,
    partial_controls INT DEFAULT 0,
    non_compliant_controls INT DEFAULT 0,
    na_controls INT DEFAULT 0,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_evaluations_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluation_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    evaluation_id VARCHAR(80) NOT NULL,
    control_id VARCHAR(30) NOT NULL,
    score VARCHAR(20) DEFAULT '',
    state VARCHAR(40) DEFAULT 'Por evaluar',
    comment TEXT,
    evidence TEXT,
    evidence_file_path VARCHAR(500),
    evidence_file_name VARCHAR(255),
    CONSTRAINT fk_items_evaluation FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
    CONSTRAINT fk_items_control FOREIGN KEY (control_id) REFERENCES controls(id),
    UNIQUE KEY uq_eval_control (evaluation_id, control_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_evaluation_items_control ON evaluation_items(control_id);
CREATE INDEX idx_evaluations_date ON evaluations(evaluation_date);

CREATE TABLE IF NOT EXISTS update_packages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(80) NOT NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT,
    package_file_path VARCHAR(500),
    package_file_name VARCHAR(255),
    checksum_sha256 VARCHAR(80),
    status VARCHAR(30) DEFAULT 'pendiente',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    applied_at TIMESTAMP NULL,
    CONSTRAINT fk_updates_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (version, description)
VALUES ('001_initial_sbseps', 'Initial SBSEPS schema with users, roles, controls and evaluations');

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
('company_name', 'Corporacion CFC S.A.'),
('legal_representative', 'Representante Legal'),
('logo_url', 'CFC.png');
