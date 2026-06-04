const bcrypt = require('bcryptjs');
const { db, migrate } = require('../db');

migrate();

const defaultPass = process.env.SEED_DEFAULT_PASS || 'bypass123!';
const users = [
  ['admin', 'admin', 'EHS Admin'],
  ['supervisor', 'supervisor', 'Shift Supervisor'],
  ['engineer', 'engineer', 'Controls Engineer'],
  ['operator', 'operator', 'Field Operator'],
  ['viewer', 'viewer', 'Read Only Viewer'],
];

const insert = db.prepare(`
  INSERT INTO users (username, password_hash, role, full_name)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(username) DO UPDATE SET role = excluded.role, full_name = excluded.full_name
`);

for (const [username, role, fullName] of users) {
  insert.run(username, bcrypt.hashSync(defaultPass, 10), role, fullName);
}

console.log(`Seeded users with password: ${defaultPass}`);
