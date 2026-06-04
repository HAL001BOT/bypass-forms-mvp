const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { db, migrate, nextBypassNumber, audit, seedDefaultUsersIfEmpty } = require('./db');

migrate();
seedDefaultUsersIfEmpty(process.env.SEED_DEFAULT_PASS || 'bypass123!');

const app = express();
const PORT = process.env.PORT || 3010;
const isProd = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-bypass-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

const STATUS_OPTIONS = ['draft', 'submitted', 'active', 'restored', 'closed', 'cancelled'];
const SYSTEM_OPTIONS = ['DCS', 'PLC', 'ESD', 'Other'];
const REASON_OPTIONS = ['Maintenance', 'Calibration', 'Proof Test', 'Startup', 'Shutdown', 'Troubleshooting', 'Repair', 'Other'];
const HAZARD_OPTIONS = ['Overpressure', 'High Level', 'Low Flow', 'Fire', 'Gas Release', 'Equipment Damage', 'Other'];
const PROCESS_OPTIONS = ['Stable', 'Startup', 'Shutdown', 'Abnormal', 'Maintenance'];
const RISK_OPTIONS = ['Class 1', 'Class 2', 'Class 3', 'Class 4'];
const APPROVAL_ROLES = [
  'Requestor',
  'Shift Supervisor',
  'Operations Manager',
  'Instrument / Controls Engineer',
  'Process Engineer',
  'Process Safety / HSE',
];

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function auth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  return next();
}

function canEdit(user, form) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'supervisor' || user.role === 'engineer') return form.status !== 'closed';
  if (user.role === 'operator') return form.status === 'draft' && form.created_by === user.id;
  return false;
}

function canTransition(user, form) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'supervisor' || user.role === 'engineer') return true;
  return user.role === 'operator' && form.status === 'draft' && form.created_by === user.id;
}

function hydrateForm(row) {
  if (!row) return null;
  return {
    ...row,
    system: parseJson(row.system_json, []),
    reason: parseJson(row.reason_json, []),
    hazard: parseJson(row.hazard_json, []),
    approvals: parseJson(row.approvals_json, {}),
  };
}

function templateData(extra = {}) {
  return {
    statusOptions: STATUS_OPTIONS,
    systemOptions: SYSTEM_OPTIONS,
    reasonOptions: REASON_OPTIONS,
    hazardOptions: HAZARD_OPTIONS,
    processOptions: PROCESS_OPTIONS,
    riskOptions: RISK_OPTIONS,
    approvalRoles: APPROVAL_ROLES,
    ...extra,
  };
}

function buildPayload(body) {
  const approvals = {};
  for (const role of APPROVAL_ROLES) {
    const key = role.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    approvals[key] = {
      role,
      name: String(body[`approval_${key}_name`] || '').trim(),
      signed_at: String(body[`approval_${key}_signed_at`] || '').trim(),
    };
  }

  return {
    requested_at: String(body.requested_at || '').trim(),
    requested_by: String(body.requested_by || '').trim(),
    area_unit: String(body.area_unit || '').trim(),
    equipment_tag: String(body.equipment_tag || '').trim(),
    cause_effect_ref: String(body.cause_effect_ref || '').trim(),
    system_json: JSON.stringify(normalizeList(body.system)),
    system_other: String(body.system_other || '').trim(),
    bypass_description: String(body.bypass_description || '').trim(),
    reason_json: JSON.stringify(normalizeList(body.reason)),
    reason_other: String(body.reason_other || '').trim(),
    hazard_json: JSON.stringify(normalizeList(body.hazard)),
    hazard_other: String(body.hazard_other || '').trim(),
    consequence: String(body.consequence || '').trim(),
    risk_classification: String(body.risk_classification || '').trim(),
    process_conditions: String(body.process_conditions || '').trim(),
    other_active_bypasses: String(body.other_active_bypasses || '').trim(),
    other_active_bypasses_details: String(body.other_active_bypasses_details || '').trim(),
    compensating_measures: String(body.compensating_measures || '').trim(),
    operating_restrictions: String(body.operating_restrictions || '').trim(),
    approvals_json: JSON.stringify(approvals),
    applied_by: String(body.applied_by || '').trim(),
    applied_at: String(body.applied_at || '').trim(),
    verified_by: String(body.verified_by || '').trim(),
    hmi_confirmed: String(body.hmi_confirmed || '').trim(),
    shift_log_logged: String(body.shift_log_logged || '').trim(),
    review_frequency: String(body.review_frequency || '').trim(),
    responsible_person: String(body.responsible_person || '').trim(),
    shift_handover_required: String(body.shift_handover_required || '').trim(),
    removed_by: String(body.removed_by || '').trim(),
    removed_at: String(body.removed_at || '').trim(),
    function_verified: String(body.function_verified || '').trim(),
    verification_method: String(body.verification_method || '').trim(),
    measures_removed: String(body.measures_removed || '').trim(),
    closed_by: String(body.closed_by || '').trim(),
  };
}

function validatePayload(payload) {
  const missing = [];
  for (const key of ['requested_at', 'requested_by', 'area_unit', 'equipment_tag', 'bypass_description']) {
    if (!payload[key]) missing.push(key);
  }
  if (!parseJson(payload.system_json, []).length) missing.push('system');
  if (!parseJson(payload.reason_json, []).length) missing.push('reason');
  if (!parseJson(payload.hazard_json, []).length) missing.push('hazard');
  return missing;
}

function statusStats() {
  const counts = Object.fromEntries(STATUS_OPTIONS.map((s) => [s, 0]));
  for (const row of db.prepare('SELECT status, COUNT(*) c FROM bypass_forms GROUP BY status').all()) {
    counts[row.status] = row.c;
  }
  return {
    total: db.prepare('SELECT COUNT(*) c FROM bypass_forms').get().c,
    active: counts.active || 0,
    submitted: counts.submitted || 0,
    restored: counts.restored || 0,
    counts,
  };
}

app.get('/', (req, res) => res.redirect(req.session.user ? '/bypasses' : '/login'));

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).render('login', { error: 'Invalid username or password.' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
  return res.redirect('/bypasses');
});

app.post('/logout', auth, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/bypasses', auth, (req, res) => {
  const filters = {
    status: STATUS_OPTIONS.includes(req.query.status) ? req.query.status : '',
    area: String(req.query.area || '').trim(),
  };
  const where = [];
  const params = [];
  if (filters.status) {
    where.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.area) {
    where.push('b.area_unit LIKE ?');
    params.push(`%${filters.area}%`);
  }
  const sql = `
    SELECT b.*, u.username AS created_by_name
    FROM bypass_forms b
    JOIN users u ON u.id = b.created_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY b.requested_at DESC, b.id DESC
  `;
  const forms = db.prepare(sql).all(...params);
  res.render('bypasses', templateData({ forms, filters, stats: statusStats() }));
});

app.get('/bypasses/new', auth, (req, res) => {
  const now = new Date().toISOString().slice(0, 16);
  const form = hydrateForm({
    bypass_number: nextBypassNumber(),
    status: 'draft',
    requested_at: now,
    requested_by: req.session.user.full_name || req.session.user.username,
    area_unit: '',
    equipment_tag: '',
    system_json: '[]',
    reason_json: '[]',
    hazard_json: '[]',
    approvals_json: '{}',
  });
  res.render('bypass-form', templateData({ form, action: '/bypasses', error: null }));
});

app.post('/bypasses', auth, (req, res) => {
  const payload = buildPayload(req.body);
  const errors = validatePayload(payload);
  const form = hydrateForm({ bypass_number: nextBypassNumber(), status: 'draft', ...payload });
  if (errors.length) {
    return res.status(400).render('bypass-form', templateData({ form, action: '/bypasses', error: 'Required fields are missing.' }));
  }
  const columns = Object.keys(payload);
  const info = db.prepare(`
    INSERT INTO bypass_forms (bypass_number, status, ${columns.join(', ')}, created_by, updated_by)
    VALUES (?, 'draft', ${columns.map(() => '?').join(', ')}, ?, ?)
  `).run(nextBypassNumber(), ...columns.map((k) => payload[k]), req.session.user.id, req.session.user.id);
  audit(info.lastInsertRowid, 'created', { status: 'draft' }, req.session.user.id);
  return res.redirect(`/bypasses/${info.lastInsertRowid}`);
});

app.get('/bypasses/:id', auth, (req, res) => {
  const form = hydrateForm(db.prepare('SELECT * FROM bypass_forms WHERE id = ?').get(req.params.id));
  if (!form) return res.status(404).send('Bypass form not found.');
  const audits = db.prepare(`
    SELECT a.*, u.username
    FROM bypass_audit a
    JOIN users u ON u.id = a.changed_by
    WHERE a.bypass_id = ?
    ORDER BY a.changed_at DESC, a.id DESC
  `).all(form.id);
  res.render('bypass-detail', templateData({ form, audits, permissions: { canEdit: canEdit(req.session.user, form), canTransition: canTransition(req.session.user, form) } }));
});

app.get('/bypasses/:id/edit', auth, (req, res) => {
  const form = hydrateForm(db.prepare('SELECT * FROM bypass_forms WHERE id = ?').get(req.params.id));
  if (!form) return res.status(404).send('Bypass form not found.');
  if (!canEdit(req.session.user, form)) return res.status(403).send('This bypass form is locked for your role.');
  res.render('bypass-form', templateData({ form, action: `/bypasses/${form.id}`, error: null }));
});

app.post('/bypasses/:id', auth, (req, res) => {
  const current = hydrateForm(db.prepare('SELECT * FROM bypass_forms WHERE id = ?').get(req.params.id));
  if (!current) return res.status(404).send('Bypass form not found.');
  if (!canEdit(req.session.user, current)) return res.status(403).send('This bypass form is locked for your role.');
  const payload = buildPayload(req.body);
  const errors = validatePayload(payload);
  const form = hydrateForm({ ...current, ...payload });
  if (errors.length) {
    return res.status(400).render('bypass-form', templateData({ form, action: `/bypasses/${current.id}`, error: 'Required fields are missing.' }));
  }
  const columns = Object.keys(payload);
  db.prepare(`
    UPDATE bypass_forms
    SET ${columns.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(...columns.map((k) => payload[k]), req.session.user.id, current.id);
  audit(current.id, 'updated', null, req.session.user.id);
  res.redirect(`/bypasses/${current.id}`);
});

app.post('/bypasses/:id/transition', auth, (req, res) => {
  const form = hydrateForm(db.prepare('SELECT * FROM bypass_forms WHERE id = ?').get(req.params.id));
  if (!form) return res.status(404).send('Bypass form not found.');
  if (!canTransition(req.session.user, form)) return res.status(403).send('Not allowed.');
  const target = String(req.body.status || '');
  const allowed = {
    draft: ['submitted', 'cancelled'],
    submitted: ['active', 'draft', 'cancelled'],
    active: ['restored', 'cancelled'],
    restored: ['closed', 'active'],
    closed: ['draft'],
    cancelled: ['draft'],
  };
  if (!allowed[form.status]?.includes(target)) return res.status(400).send('Invalid transition.');
  db.prepare('UPDATE bypass_forms SET status = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(target, req.session.user.id, form.id);
  audit(form.id, 'status_changed', { from: form.status, to: target }, req.session.user.id);
  res.redirect(`/bypasses/${form.id}`);
});

app.get('/bypasses/export.csv', auth, (_req, res) => {
  const rows = db.prepare(`
    SELECT bypass_number, status, requested_at, requested_by, area_unit, equipment_tag, risk_classification, responsible_person
    FROM bypass_forms
    ORDER BY requested_at DESC, id DESC
  `).all();
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Bypass Number', 'Status', 'Requested At', 'Requested By', 'Area / Unit', 'Equipment Tag', 'Risk', 'Responsible Person'];
  const csv = [header.map(escape).join(','), ...rows.map((r) => Object.values(r).map(escape).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="bypass-forms.csv"');
  res.send(csv);
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Bypass Forms running on http://localhost:${PORT}`));
}

module.exports = app;
