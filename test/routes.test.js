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

test('login and create bypass form', async () => {
  seedUser();
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'admin', password: 'bypass123!' }).expect(302);
  await agent.get('/bypasses').expect(200);
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

  const row = db.prepare('SELECT * FROM bypass_forms LIMIT 1').get();
  assert.equal(row.area_unit, 'Unit 1');
  assert.equal(row.status, 'draft');
});
