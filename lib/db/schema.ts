import { getDb } from './client'

export async function runMigrations() {
  const db = getDb()

  // Regular poll templates (recurring polls with pre-approved drafts)
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS regular_polls (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        frequency TEXT NOT NULL DEFAULT 'monthly',
        scheduled_day INTEGER NOT NULL DEFAULT 1,
        department TEXT NOT NULL,
        subject TEXT NOT NULL,
        draft_email_body TEXT NOT NULL,
        questions TEXT NOT NULL,
        recipients TEXT NOT NULL,
        ms_form_link TEXT,
        next_run_date DATE NOT NULL,
        last_run_date DATE,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // Add subject column if not exists (safe to run multiple times)
  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN subject TEXT`)
  } catch { /* already exists */ }

  // Store the email addresses a poll was released to (JSON array string)
  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN release_emails TEXT`)
  } catch { /* already exists */ }

  // Store the Graph message ID of the release email so results can be sent as a reply
  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN release_message_id TEXT`)
  } catch { /* already exists */ }

  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN second_reminder_sent_at DATETIME`)
  } catch { /* already exists */ }

  try {
    await db.execute(`ALTER TABLE polls ADD COLUMN closure_alert_sent_at DATETIME`)
  } catch { /* already exists */ }

  // One-time approval tokens sent via email
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS poll_approval_tokens (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES polls(id),
        token TEXT UNIQUE NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME
      )
    `)
  } catch { /* already exists */ }

  // Email attachments persisted per poll, so they survive from approval through to release
  // (previously they lived only in browser memory and were lost between the two steps).
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS poll_attachments (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES polls(id),
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        content_bytes TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // Feedback / suggestions collected per poll
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS feedback_items (
        id TEXT PRIMARY KEY,
        poll_id TEXT REFERENCES polls(id),
        poll_title TEXT,
        type TEXT,
        summary TEXT,
        detail TEXT,
        submitted_by TEXT,
        department TEXT,
        owner TEXT,
        status TEXT DEFAULT 'Open',
        due_date TEXT,
        submitted_date TEXT DEFAULT CURRENT_TIMESTAMP,
        rms_task_id TEXT,
        task_pending INTEGER DEFAULT 0,
        followup_done INTEGER DEFAULT 0,
        category TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // AI draft audit trail
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        poll_id TEXT,
        type TEXT,
        prompt TEXT,
        generated_content TEXT,
        model_version TEXT,
        accepted_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // Closure / resolution tracking per feedback item
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS closure_items (
        id TEXT PRIMARY KEY,
        poll_id TEXT REFERENCES polls(id),
        feedback_id TEXT REFERENCES feedback_items(id),
        summary TEXT,
        status TEXT,
        email_sent INTEGER DEFAULT 0,
        happy_with_solution INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // Manually-maintained KPI counts (process improvements, RMS improvements, etc.)
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS kpi_data (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        process_improvements INTEGER DEFAULT 0,
        rms_improvements INTEGER DEFAULT 0,
        policy_announced INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }

  // Seed kpi_data singleton row if missing
  try {
    await db.execute(`INSERT OR IGNORE INTO kpi_data (id) VALUES ('singleton')`)
  } catch { /* already exists */ }

  // Add auto_approve column to regular_polls
  try {
    await db.execute(`ALTER TABLE regular_polls ADD COLUMN auto_approve INTEGER DEFAULT 0`)
  } catch { /* already exists */ }

  // Employee master cache — email is primary key (bulk API doesn't return emp_codes)
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS employees (
        email_address TEXT PRIMARY KEY,
        emp_code TEXT,
        first_name TEXT,
        last_name TEXT,
        manager_name TEXT,
        department_name TEXT,
        designation_name TEXT,
        synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  } catch { /* already exists */ }
  // Migrate old emp_code-keyed table to email-keyed
  try {
    const cols = await db.execute(`PRAGMA table_info(employees)`)
    const firstName = (cols.rows[0] as unknown as { name?: string; 1?: string })[1] as string
    if (firstName === 'emp_code') {
      await db.execute(`DROP TABLE employees`)
      await db.execute(`
        CREATE TABLE employees (
          email_address TEXT PRIMARY KEY,
          emp_code TEXT,
          first_name TEXT,
          last_name TEXT,
          manager_name TEXT,
          department_name TEXT,
          designation_name TEXT,
          synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `)
    }
  } catch { /* already migrated */ }
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

    CREATE TABLE IF NOT EXISTS poll_approval_tokens (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id),
      token TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME
    );
  `)
}
