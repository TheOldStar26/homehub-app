import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const read = path => readFileSync(path, 'utf8');
function files(dir = '.') { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? files(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
for (const file of files()) {
  if (/\.(js|ts)$/.test(file)) execFileSync(process.execPath, ['--input-type=module','--check'], {input:read(file)});
  if (!/\.(js|ts|sql|json|md)$/.test(file) || file.includes('/tools/check-release')) continue;
  const source = read(file);
  assert.ok(!/-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/.test(source), `Private key in ${file}`);
  assert.ok(!/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(source), `Embedded JWT in ${file}`);
  assert.ok(!/(?:schedulerToken|privateKey)\s*=\s*['"][A-Za-z0-9_-]{20,}['"]/.test(source), `Embedded secret in ${file}`);
}
assert.equal(read('calendar/model.js'), read('supabase/functions/homehub-reminder-sender/model.js'), 'Browser/sender rules differ');
const worker = read('sw.js');
const paths = JSON.parse(worker.match(/const FILES=(\[.*?\]);/s)[1].replaceAll("'", '"'));
for (const path of paths) assert.ok(existsSync(path || 'index.html'), `Missing PWA asset ${path}`);
assert.match(read('production-app.js'), /ejshqohrnsdmzinvqqzz\.supabase\.co/);
assert.match(read('supabase/migrations/202610120001_secure_reminder_scheduler.sql'), /revoke all on function.*from public, anon, authenticated/);
console.log('Release checks passed: JS syntax, PWA assets, shared scheduling rules, target and secret scan.');
