const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'massiv.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

function initDb() {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      socials TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crew_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crew (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT,
      phone TEXT,
      email TEXT,
      location TEXT,
      day_rate REAL DEFAULT 0,
      notes TEXT,
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      group_name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      title TEXT NOT NULL,
      category_id INTEGER,
      status TEXT DEFAULT 'development',
      client_budget REAL DEFAULT 0,
      agreed_budget REAL DEFAULT 0,
      notes TEXT,
      shoot_date TEXT,
      shoot_days INTEGER DEFAULT 1,
      shoot_location TEXT,
      treatment_approved INTEGER DEFAULT 0,
      budget_approved INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (category_id) REFERENCES project_categories(id)
    );

    CREATE TABLE IF NOT EXISTS project_phases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      phase_name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      assigned_crew_id INTEGER,
      due_date TEXT,
      notes TEXT,
      status TEXT DEFAULT 'todo',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_crew_id) REFERENCES crew(id)
    );

    CREATE TABLE IF NOT EXISTS revision_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crew_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      crew_id INTEGER NOT NULL,
      role_on_project TEXT,
      days INTEGER DEFAULT 1,
      rate_per_day REAL DEFAULT 0,
      paid_status TEXT DEFAULT 'unpaid',
      payment_date TEXT,
      payment_amount REAL DEFAULT 0,
      payment_method TEXT,
      payment_notes TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (crew_id) REFERENCES crew(id)
    );

    CREATE TABLE IF NOT EXISTS client_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      method TEXT DEFAULT 'bank_transfer',
      notes TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      category_id INTEGER,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    );

    CREATE TABLE IF NOT EXISTS project_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crew_debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      date_incurred DATE DEFAULT CURRENT_DATE,
      status TEXT DEFAULT 'unpaid',
      payment_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (crew_id) REFERENCES crew(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      client_name TEXT,
      shoot_days INTEGER DEFAULT 1,
      shoot_location TEXT,
      status TEXT DEFAULT 'draft',
      vat_enabled INTEGER DEFAULT 0,
      vat_rate REAL DEFAULT 18,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS budget_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      budget_id INTEGER NOT NULL,
      section TEXT NOT NULL,
      position_label TEXT,
      description TEXT,
      crew_id INTEGER,
      days REAL DEFAULT 1,
      rate REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,
      FOREIGN KEY (crew_id) REFERENCES crew(id) ON DELETE SET NULL
    );
  `);

  const insertRole = db.prepare('INSERT OR IGNORE INTO crew_roles (name, is_default) VALUES (?, 1)');
  [
    'Director','DOP','Camera Operator','Camera Assistant','Gaffer','Photographer',
    'Editor','Colorist','VFX Artist','Makeup Artist','Hair Stylist','Scenographer',
    'Casting Director','Producer','Production Assistant','Driver','Retoucher','DIT Operator'
  ].forEach(r => insertRole.run(r));

  const insertCat = db.prepare('INSERT OR IGNORE INTO project_categories (name, group_name, is_default) VALUES (?, ?, 1)');
  [
    ['Music Video','Video Production'],['TV Commercial','Video Production'],
    ['Corporate Video / Brand Film','Video Production'],['Documentary / Short Film','Video Production'],
    ['Social Media Video Content','Video Production'],['Event Videography','Video Production'],
    ['Real Estate / Property Video','Video Production'],['Product Demo Video','Video Production'],
    ['Event Photography','Photography'],['Portrait / Editorial Photography','Photography'],
    ['Commercial / Product Photography','Photography'],['Real Estate Photography','Photography'],
    ['Fashion Photography','Photography'],
    ['Video Editing','Post Production'],['Color Grading','Post Production'],
    ['VFX / Motion Graphics','Post Production'],['Podcast / Audio Production','Post Production'],
    ['Audio Mixing & Mastering','Post Production'],['Subtitling & Localization','Post Production'],
    ['Branding & Identity','Branding & Digital'],['Social Media Content Management','Branding & Digital'],
    ['Graphic Design','Branding & Digital'],['Web Design','Branding & Digital'],
    ['Photo Retouching','Photography'],['Photo Editing & Culling','Photography'],
    ['2D / 3D Animation','Animation & Motion'],
  ].forEach(([name, group]) => insertCat.run(name, group));

  const insertExpCat = db.prepare('INSERT OR IGNORE INTO expense_categories (name, is_default) VALUES (?, 1)');
  ['Fuel','Catering','Accommodation','Equipment Rental','Props','Permits','Transportation','Location Fees','Miscellaneous']
    .forEach(c => insertExpCat.run(c));

  db.exec(`
    CREATE TABLE IF NOT EXISTS asset_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'Rental House',
      phone TEXT,
      email TEXT,
      location TEXT,
      notes TEXT,
      archived INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS asset_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS asset_provider_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      daily_rate REAL DEFAULT 0,
      notes TEXT,
      UNIQUE(provider_id, item_id),
      FOREIGN KEY (provider_id) REFERENCES asset_providers(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES asset_items(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name_manual TEXT,
      category_id INTEGER,
      category_name_manual TEXT,
      note TEXT,
      contacted_at DATE DEFAULT CURRENT_DATE,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES project_categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      title TEXT NOT NULL,
      event_type TEXT DEFAULT 'shoot',
      start_date DATE NOT NULL,
      end_date DATE,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      notes TEXT,
      color TEXT DEFAULT '#0a0a0a',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_task_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL,
      phase_name TEXT NOT NULL,
      task_title TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(category_name, phase_name, task_title)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_tasks_category ON custom_task_suggestions(category_name);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      token TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      project_id INTEGER NULL,
      description TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collection_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      url TEXT NULL,
      title TEXT NULL,
      note_text TEXT NULL,
      thumbnail_url TEXT NULL,
      source TEXT NULL,
      tags TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_collections_project ON collections(project_id);
    CREATE INDEX IF NOT EXISTS idx_collection_cards_collection ON collection_cards(collection_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_tax_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      invoice_number TEXT,
      invoice_total REAL,
      tax_rate_applied REAL,
      tax_amount REAL,
      tax_status TEXT DEFAULT 'unpaid',
      paid_date TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT NOT NULL,
      unit TEXT DEFAULT 'Shërbim',
      default_price REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT,
      project_id INTEGER,
      estimate_id INTEGER,
      client_id INTEGER,
      client_name TEXT DEFAULT '',
      client_nr_unik TEXT DEFAULT '',
      client_address TEXT DEFAULT '',
      issue_date TEXT,
      due_date TEXT,
      description TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      currency TEXT DEFAULT 'EUR',
      language TEXT DEFAULT 'sq',
      subtotal REAL DEFAULT 0,
      invoice_discount REAL DEFAULT 0,
      discount_type TEXT DEFAULT 'amount',
      total_after_discount REAL DEFAULT 0,
      tax_enabled INTEGER DEFAULT 0,
      tax_rate_applied REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      amount_due REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      line_no INTEGER DEFAULT 1,
      code TEXT,
      description TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      qty REAL DEFAULT 1,
      price REAL DEFAULT 0,
      line_discount_pct REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);

  // Default tax settings — INSERT OR IGNORE so existing values are never overwritten
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '18')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_label', 'Tax')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_enabled', '1')").run();

  // Profile setup — seed as incomplete for new installs; existing users get the wizard once
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('profile_completed', '0')").run();

  // Invoice defaults — seed counter at 34 (last issued was 33/25)
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_next_num', '34')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_last_year', '25')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_language', 'sq')").run();

  // vault_meta: single-row table for ZK password vault parameters
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vault_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        salt TEXT NOT NULL,
        sentinel_cipher TEXT NOT NULL,
        sentinel_iv TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (_) {}

  // Schema migrations — safe to run on every boot
  [
    'ALTER TABLE crew ADD COLUMN is_company INTEGER DEFAULT 0',
    'ALTER TABLE crew ADD COLUMN service_type TEXT',
    'ALTER TABLE tasks ADD COLUMN is_locked INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0',
    'ALTER TABLE projects ADD COLUMN duplicated_from INTEGER',
    'ALTER TABLE projects ADD COLUMN location_name TEXT',
    'ALTER TABLE projects ADD COLUMN location_lat REAL',
    'ALTER TABLE projects ADD COLUMN location_lng REAL',
    'ALTER TABLE budgets ADD COLUMN show_providers INTEGER DEFAULT 0',
    'ALTER TABLE expenses ADD COLUMN submitted_by TEXT',
    'ALTER TABLE expenses ADD COLUMN invoice_image_path TEXT',
    "ALTER TABLE expenses ADD COLUMN source TEXT DEFAULT 'admin'",
    "ALTER TABLE expenses ADD COLUMN status TEXT DEFAULT 'confirmed'",
    'ALTER TABLE expenses ADD COLUMN category_text TEXT',
    'ALTER TABLE projects ADD COLUMN shoot_start_time TEXT',
    'ALTER TABLE projects ADD COLUMN shoot_end_time TEXT',
    'ALTER TABLE projects ADD COLUMN deadline TEXT',
    'ALTER TABLE collections ADD COLUMN archived INTEGER DEFAULT 0',
    'ALTER TABLE collections ADD COLUMN kind TEXT NULL',
    'ALTER TABLE collections ADD COLUMN sort_order INTEGER NULL',
    'ALTER TABLE collection_cards ADD COLUMN sort_order INTEGER NULL',
    'ALTER TABLE budget_lines ADD COLUMN discount REAL DEFAULT 0',
    'ALTER TABLE calendar_events ADD COLUMN task_id INTEGER',
    'ALTER TABLE calendar_events ADD COLUMN standalone_task_id INTEGER',
    'ALTER TABLE mind_accounts ADD COLUMN password_cipher TEXT',
    'ALTER TABLE mind_accounts ADD COLUMN password_iv TEXT',
    "ALTER TABLE mind_accounts ADD COLUMN auth_method TEXT DEFAULT 'password'",
    'ALTER TABLE client_payments ADD COLUMN invoice_id INTEGER',
  ].forEach(sql => { try { db.exec(sql); } catch (_) {} });

  // collection_share_links table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS collection_share_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_share_links_token ON collection_share_links(token);
      CREATE INDEX IF NOT EXISTS idx_share_links_collection ON collection_share_links(collection_id);
    `);
  } catch (_) {}

  // Backfill kind for collections (runs every boot; WHERE kind IS NULL makes it a no-op after first run)
  try {
    db.exec("UPDATE collections SET kind = 'project' WHERE project_id IS NOT NULL AND kind IS NULL");
    db.exec("UPDATE collections SET kind = 'studio' WHERE project_id IS NULL AND kind IS NULL");
  } catch (_) {}

  // Backfill sort_order (runs every boot; WHERE IS NULL makes it a no-op after first run)
  try {
    db.exec('UPDATE collections SET sort_order = id WHERE sort_order IS NULL');
    db.exec('UPDATE collection_cards SET sort_order = id WHERE sort_order IS NULL');
  } catch (_) {}

  // Clean up empty auto-created project collections (project_id set, 0 cards)
  try {
    db.exec(`
      DELETE FROM collections
      WHERE project_id IS NOT NULL
        AND (SELECT COUNT(*) FROM collection_cards WHERE collection_id = collections.id) = 0
    `);
  } catch (_) {}

  // Backfill: any existing expense with no status gets confirmed
  try {
    db.exec("UPDATE expenses SET status = 'confirmed' WHERE status IS NULL");
  } catch (_) {}

  // Backfill client_payments.invoice_id by matching the legacy note string that
  // the mark-paid endpoint generates ("Invoice {number} - {client name}").
  // The invoice_id IS NULL guard makes this a no-op on every later boot.
  try {
    const invoices = db.prepare(
      "SELECT id, invoice_number, project_id, client_name FROM invoices WHERE invoice_number IS NOT NULL AND invoice_number != '' AND project_id IS NOT NULL"
    ).all();
    const findPayment = db.prepare(
      "SELECT id FROM client_payments WHERE project_id = ? AND status = 'received' AND invoice_id IS NULL AND notes = ?"
    );
    const linkPayment = db.prepare('UPDATE client_payments SET invoice_id = ? WHERE id = ?');
    for (const inv of invoices) {
      const noteStr = `Invoice ${inv.invoice_number} - ${(inv.client_name || '').trim()}`.trim();
      const pay = findPayment.get(inv.project_id, noteStr);
      if (pay) linkPayment.run(inv.id, pay.id);
    }
  } catch (_) {}

  // Session cleanup — drop any sessions whose expiry is already in the past
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  } catch (_) {}

  // Indexes — created only if missing
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mind_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      platform TEXT NOT NULL,
      username TEXT,
      url TEXT,
      notes TEXT,
      has_payment INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      billing_cycle TEXT DEFAULT 'monthly',
      renewal_date TEXT,
      currency TEXT DEFAULT 'EUR',
      archived INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch (_) {}

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
    CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
    CREATE INDEX IF NOT EXISTS idx_client_payments_project ON client_payments(project_id);
    CREATE INDEX IF NOT EXISTS idx_client_payments_status_date ON client_payments(status, date);
    CREATE INDEX IF NOT EXISTS idx_crew_assignments_project ON crew_assignments(project_id);
    CREATE INDEX IF NOT EXISTS idx_crew_assignments_crew ON crew_assignments(crew_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_date);
    CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_lines(budget_id);
    CREATE INDEX IF NOT EXISTS idx_status_history_project ON project_status_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS standalone_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      notes TEXT,
      due_date TEXT,
      priority TEXT DEFAULT 'normal',
      done INTEGER DEFAULT 0,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_standalone_tasks_done ON standalone_tasks(done);
  `);

  // ── Pitches (presentation builder) ──
  // Ordering: creates, then alters, then backfills, then indexes, then seeds.

  // Creates
  db.exec(`
    CREATE TABLE IF NOT EXISTS presentations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      category TEXT,
      status TEXT DEFAULT 'draft',
      accent_color TEXT DEFAULT '#723CEB',
      is_template INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS presentation_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      presentation_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE
    );
  `);

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_presentations_slug ON presentations(slug);
    CREATE INDEX IF NOT EXISTS idx_presentation_sections_presentation ON presentation_sections(presentation_id);
  `);

  // Seeds — templates are inserted exactly once; user edits to them must
  // survive every boot, so the guard key is checked before touching anything.
  try {
    const seeded = db.prepare("SELECT value FROM settings WHERE key = 'pitches_templates_seeded'").get();
    if (!seeded) {
      const templates = require('./pitch-templates');
      const insertPres = db.prepare(
        "INSERT INTO presentations (title, category, accent_color, is_template, status) VALUES (?, ?, ?, 1, 'draft')"
      );
      const insertSection = db.prepare(
        'INSERT INTO presentation_sections (presentation_id, type, sort_order, content) VALUES (?, ?, ?, ?)'
      );
      const seedAll = db.transaction(() => {
        templates.forEach(tpl => {
          const r = insertPres.run(tpl.title, tpl.category, tpl.accent_color);
          tpl.sections.forEach((s, i) => insertSection.run(r.lastInsertRowid, s.type, i, JSON.stringify(s.content)));
        });
        db.prepare("INSERT INTO settings (key, value) VALUES ('pitches_templates_seeded', '1')").run();
      });
      seedAll();
    }
  } catch (err) {
    console.error('Pitch template seeding failed:', err.message);
  }

  // Password migration — run once on boot
  migratePassword();
}

function migratePassword() {
  const bcrypt = require('bcryptjs');
  const pw = db.prepare("SELECT value FROM settings WHERE key = 'password'").get();
  if (pw) {
    const hash = bcrypt.hashSync(pw.value, 10);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hash', ?)").run(hash);
    db.prepare("DELETE FROM settings WHERE key = 'password'").run();
    console.log('INFO: Plaintext password migrated to bcrypt hash.');
    return;
  }
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").get();
  if (!existing) {
    const hash = bcrypt.hashSync('massiv2026', 10);
    db.prepare("INSERT INTO settings (key, value) VALUES ('password_hash', ?)").run(hash);
    console.warn('WARNING: No password found. Default password "massiv2026" set. Change it in Settings immediately.');
  }
}

module.exports = { db, initDb };
