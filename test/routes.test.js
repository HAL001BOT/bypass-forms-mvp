const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.DB_PATH = path.join(os.tmpdir(), `bypass-forms-test-${process.pid}.db`);
const { db, migrate } = require('../db');
migrate();

const app = require('../server');

function seedUser() {
  db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, role, full_name)
    VALUES (?, ?, ?, ?)
  `).run('admin', bcrypt.hashSync('bypass123!', 4), 'admin', 'Admin User');
}

function seedNamedUser(username, password, role) {
  db.prepare(`
    INSERT OR REPLACE INTO users (username, password_hash, role, full_name)
    VALUES (?, ?, ?, ?)
  `).run(username, bcrypt.hashSync(password, 4), role, `${role} User`);
}

async function loginAdmin(agent) {
  seedUser();
  await agent.post('/login').type('form').send({ username: 'admin', password: 'bypass123!' }).expect(302);
}

async function createSampleBypass(agent) {
  await agent.post('/bypasses').type('form').send({
    requested_at: '2026-06-04T13:00',
    requested_by: 'Admin User',
    area_unit: 'Unit 1',
    equipment_tag: 'ESD-101',
    system: ['ESD'],
    bypass_description: 'Bypass trip for proof test',
    reason: ['Proof Test'],
    hazard: ['Fire'],
    risk_classification: 'Class 2',
  }).expect(302);
  return db.prepare('SELECT * FROM bypass_forms ORDER BY id DESC LIMIT 1').get();
}

test('login and create bypass form', async () => {
  const agent = request.agent(app);
  await loginAdmin(agent);
  await agent.get('/bypasses').expect(200);
  await createSampleBypass(agent);

  const row = db.prepare('SELECT * FROM bypass_forms LIMIT 1').get();
  assert.equal(row.area_unit, 'Unit 1');
  assert.equal(row.status, 'draft');
});

test('trusts Render proxy for secure production cookies', () => {
  assert.equal(app.get('trust proxy'), 1);
});

test('admin can reset a user password from admin dashboard', async () => {
  seedNamedUser('operator-reset', 'oldpass123!', 'operator');
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get('operator-reset');

  const adminAgent = request.agent(app);
  await loginAdmin(adminAgent);
  await adminAgent.get('/admin/users').expect(200);
  await adminAgent
    .post(`/admin/users/${target.id}/password`)
    .type('form')
    .send({ password: 'newpass123!' })
    .expect(302);

  const operatorAgent = request.agent(app);
  await operatorAgent.post('/login').type('form').send({ username: 'operator-reset', password: 'newpass123!' }).expect(302);
  await operatorAgent.get('/bypasses').expect(200);
});

test('non-admin users cannot open admin dashboard', async () => {
  seedNamedUser('operator-denied', 'operator123!', 'operator');

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'operator-denied', password: 'operator123!' }).expect(302);
  await agent.get('/admin/users').expect(403);
});

test('exports bypass form as PDF', async () => {
  const agent = request.agent(app);
  await loginAdmin(agent);
  const form = await createSampleBypass(agent);

  const res = await agent.get(`/bypasses/${form.id}/pdf`).expect(200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.match(res.headers['content-disposition'], new RegExp(`${form.bypass_number}\\.pdf`));
  assert.equal(res.body.subarray(0, 4).toString(), '%PDF');
});

test('exports bypass dashboard as CSV', async () => {
  const agent = request.agent(app);
  await loginAdmin(agent);
  await createSampleBypass(agent);

  const res = await agent.get('/bypasses/export.csv').expect(200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text, /Bypass Number/);
  assert.match(res.text, /ESD-101/);
});
