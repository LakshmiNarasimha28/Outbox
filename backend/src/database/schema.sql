-- Outbox Labs Email Job Scheduler Schema
-- Engine: MySQL 8.0+
-- Table: email_jobs

CREATE TABLE IF NOT EXISTS `email_jobs` (
  `id` VARCHAR(36) NOT NULL,
  `recipient` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body` MEDIUMTEXT NOT NULL,
  `sender` VARCHAR(255) NOT NULL DEFAULT 'scheduler@outbox.labs',
  `scheduled_at` DATETIME(3) NOT NULL,
  `status` ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `idempotency_key` VARCHAR(255) DEFAULT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `max_attempts` INT UNSIGNED NOT NULL DEFAULT 3,
  `last_attempt_at` DATETIME(3) DEFAULT NULL,
  `sent_at` DATETIME(3) DEFAULT NULL,
  `failed_at` DATETIME(3) DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `ethereal_message_id` VARCHAR(255) DEFAULT NULL,
  `ethereal_preview_url` TEXT DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_idempotency_key` (`idempotency_key`),
  KEY `idx_status_scheduled` (`status`, `scheduled_at`),
  KEY `idx_recipient` (`recipient`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
