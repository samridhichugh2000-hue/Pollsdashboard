import { getDb } from './client'

export async function runMigrations() {
  const db = getDb()
  // Add subject column if not exists (safe to run multiple times)
  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN subject TEXT`)
  } catch {
    // Column already exists — ignore
  }
}

export async function initializeDatabase() {
  await getDb().executeMultiple(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      department TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      source TEXT NOT NULL,
      email_thread_id TEXT,
      draft_email_body TEXT,
      questions TEXT,
      deadline DATETIME,
      ms_form_id TEXT,
      ms_form_link TEXT,
      rms_task_id TEXT,
      rms_news_id TEXT,
      status TEXT NOT NULL DEFAULT 'DETECTED',
      sent_at DATETIME,
      reminder_at DATETIME,
      reminder_sent_at DATETIME,
      approved_at DATETIME,
      closed_at DATETIME,
      results_uploaded_at DATETIME,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poll_approvals (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id),
      action TEXT NOT NULL,
      notes TEXT,
      actioned_by TEXT,
      actioned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poll_responses (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id),
      response_data TEXT,
      is_actionable INTEGER DEFAULT 0,
      email_response TEXT,
      email_sent_at DATETIME,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      auth_provider TEXT NOT NULL DEFAULT 'email',
      password_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      poll_id TEXT,
      action TEXT NOT NULL,
      performed_by TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
}
