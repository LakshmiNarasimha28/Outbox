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
  `user_id` VARCHAR(255) DEFAULT NULL,
  `user_email` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_idempotency_key` (`idempotency_key`),
  KEY `idx_status_scheduled` (`status`, `scheduled_at`),
  KEY `idx_recipient` (`recipient`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `slack_integrations` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(255) NOT NULL,
  `user_email` VARCHAR(255) DEFAULT NULL,
  `sender` VARCHAR(255) NOT NULL DEFAULT 'scheduler@outbox.labs',
  `team_id` VARCHAR(64) NOT NULL,
  `team_name` VARCHAR(255) NOT NULL,
  `channel_id` VARCHAR(64) DEFAULT NULL,
  `channel_name` VARCHAR(255) DEFAULT NULL,
  `encrypted_access_token` TEXT DEFAULT NULL,
  `encrypted_webhook_url` TEXT DEFAULT NULL,
  `scope` VARCHAR(255) DEFAULT NULL,
  `bot_user_id` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('ACTIVE', 'REVOKED', 'DISCONNECTED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_slack` (`user_id`),
  KEY `idx_sender_status` (`sender`, `status`),
  KEY `idx_user_status` (`user_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
