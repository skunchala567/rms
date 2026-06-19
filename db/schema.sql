-- Stay Back Route Management System - Database Schema (MySQL / MariaDB)
-- The database itself is created by the app (db/database.js); this file only
-- defines the tables. Statements are split on ';' and run individually.

-- ---------------------------------------------------------------------------
-- Users (role-based authentication)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  role          VARCHAR(80) NOT NULL,
  status        ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  role_key    VARCHAR(80) NOT NULL UNIQUE,
  role_name   VARCHAR(150) NOT NULL,
  is_system   TINYINT(1) NOT NULL DEFAULT 0,
  status      ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS role_permissions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  role_key    VARCHAR(80) NOT NULL,
  page_key    VARCHAR(80) NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_role_page (role_key, page_key),
  CONSTRAINT fk_role_perm_role FOREIGN KEY (role_key) REFERENCES roles(role_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Buses (Bus Master)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS buses (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  bus_number       VARCHAR(50) NOT NULL UNIQUE,
  route_number     VARCHAR(50) NOT NULL,
  seating_capacity INT NOT NULL DEFAULT 0,
  gps_link         VARCHAR(500),
  driver_name      VARCHAR(150),
  driver_mobile    VARCHAR(30),
  status           ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_buses_route (route_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Students (Student Master)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  student_code  VARCHAR(50) NOT NULL UNIQUE,
  name          VARCHAR(150) NOT NULL,
  class         VARCHAR(30),
  section       VARCHAR(30),
  category      VARCHAR(50),
  parent_name   VARCHAR(150),
  parent_mobile VARCHAR(30),
  route_number  VARCHAR(50),
  status        ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_students_route (route_number),
  INDEX idx_students_class (class),
  INDEX idx_students_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 5 PM Trip assignments (per trip date)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_assignments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  student_id   INT NOT NULL,
  trip_date    DATE NOT NULL,
  route_number VARCHAR(50),
  bus_id       INT,
  assigned_by  INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_student_date (student_id, trip_date),
  INDEX idx_trip_date (trip_date),
  CONSTRAINT fk_trip_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_trip_bus FOREIGN KEY (bus_id) REFERENCES buses(id) ON DELETE SET NULL,
  CONSTRAINT fk_trip_user FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Route replacement audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_replacement_log (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  old_route       VARCHAR(50) NOT NULL,
  new_route       VARCHAR(50) NOT NULL,
  affected_count  INT NOT NULL DEFAULT 0,
  updated_by      INT,
  updated_by_name VARCHAR(150),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_repl_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- WhatsApp notification log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  student_id        INT,
  student_name      VARCHAR(150) NOT NULL,
  mobile            VARCHAR(30),
  bus_number        VARCHAR(50),
  tracking_link     VARCHAR(500),
  message           TEXT,
  status            ENUM('Sent', 'Failed', 'Pending') NOT NULL DEFAULT 'Pending',
  provider_response TEXT,
  sent_by           INT,
  sent_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_sent_at (sent_at),
  INDEX idx_notif_status (status),
  CONSTRAINT fk_notif_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  CONSTRAINT fk_notif_user FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Student dropdown settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  type       ENUM('class', 'section', 'category', 'route') NOT NULL,
  value      VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status     ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_student_setting (type, value),
  INDEX idx_student_settings_type_status (type, status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
