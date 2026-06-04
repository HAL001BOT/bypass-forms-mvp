const { migrate, seedDefaultUsers } = require('../db');

migrate();

const defaultPass = process.env.SEED_DEFAULT_PASS || 'bypass123!';
seedDefaultUsers(defaultPass);

console.log(`Seeded users with password: ${defaultPass}`);
