const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(dataDir, 'bypass-forms.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      full_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bypass_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bypass_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'active', 'restored', 'closed', 'cancelled')) DEFAULT 'draft',
      requested_at TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      area_unit TEXT NOT NULL,
      equipment_tag TEXT NOT NULL,
      cause_effect_ref TEXT,
      system_json TEXT NOT NULL DEFAULT '[]',
      system_other TEXT,
      bypass_description TEXT NOT NULL,
      reason_json TEXT NOT NULL DEFAULT '[]',
      reason_other TEXT,
      hazard_json TEXT NOT NULL DEFAULT '[]',
      hazard_other TEXT,
      consequence TEXT,
      risk_classification TEXT,
      process_conditions TEXT,
      other_active_bypasses TEXT,
      other_active_bypasses_details TEXT,
      compensating_measures TEXT,
      operating_restrictions TEXT,
      approvals_json TEXT NOT NULL DEFAULT '{}',
      applied_by TEXT,
      applied_at TEXT,
      verified_by TEXT,
      hmi_confirmed TEXT,
      shift_log_logged TEXT,
      review_frequency TEXT,
      responsible_person TEXT,
      shift_handover_required TEXT,
      removed_by TEXT,
      removed_at TEXT,
      function_verified TEXT,
      verification_method TEXT,
      measures_removed TEXT,
      closed_by TEXT,
      created_by INTEGER NOT NULL,
      updated_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES users(id),
      FOREIGN KEY(updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bypass_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bypass_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      changed_by INTEGER NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(bypass_id) REFERENCES bypass_forms(id),
      FOREIGN KEY(changed_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bypass_status ON bypass_forms(status);
    CREATE INDEX IF NOT EXISTS idx_bypass_area ON bypass_forms(area_unit);
    CREATE INDEX IF NOT EXISTS idx_bypass_requested_at ON bypass_forms(requested_at);
    CREATE INDEX IF NOT EXISTS idx_bypass_audit_form ON bypass_audit(bypass_id);
  `);
}

function nextBypassNumber() {
  const year = new Date().getFullYear();
  const prefix = `BYP-${year}-`;
  const row = db.prepare(`
    SELECT bypass_number
    FROM bypass_forms
    WHERE bypass_number LIKE ?
    ORDER BY bypass_number DESC
    LIMIT 1
  `).get(`${prefix}%`);
  const last = row?.bypass_number ? Number(row.bypass_number.slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}

function audit(bypassId, action, detail, userId) {
  db.prepare(`
    INSERT INTO bypass_audit (bypass_id, action, detail, changed_by)
    VALUES (?, ?, ?, ?)
  `).run(bypassId, action, detail ? JSON.stringify(detail) : null, userId);
}

module.exports = { db, migrate, nextBypassNumber, audit };
