// Fast local regression copies only. Production source retains a fixed three-second policy.
const fs = require('node:fs'), path = require('node:path');
module.exports = directory => {
  const file = path.join(directory, 'jobs-access.js'), source = fs.readFileSync(file, 'utf8');
  if (!source.includes('intervalMs: 3000')) throw Error('production access interval changed');
  fs.writeFileSync(file, source.replace('intervalMs: 3000', 'intervalMs: 100'));
};
