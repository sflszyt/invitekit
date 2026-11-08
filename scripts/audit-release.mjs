import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { wedding } from '../public/content.js';
import { animalCharmsConfig } from '../public/animal-charms.config.js';

// Check the complete candidate payload, including files not staged yet.
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean))];
assert.ok(files.length > 20, 'Run in the repository root');
const forbidden = /(?:^|\/)(?:private|artifacts|node_modules|\.local-state|\.test-state|\.wrangler|\.build-check|archive|releases)(?:\/|$)|\.(?:sqlite(?:-wal|-shm)?|db|zip|log|mp3|wav|jpg|jpeg|png|webp)$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /[A-Za-z]:[\\/]Users[\\/][^\s'"/\\]+[\\/]/,
];
for (const file of files) {
  assert.ok(!forbidden.test(file), `Private/runtime/unreviewed media in release: ${file}`);
  assert.ok(!/(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.dev\.vars$/.test(file) || file.endsWith('.example'), `Environment file in release: ${file}`);
  if (extname(file) === '.woff2') continue;
  const source = readFileSync(file, 'utf8');
  for (const pattern of secretPatterns) assert.ok(!pattern.test(source), `Potential credential or machine path in ${file}`);
}

const deployment = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
assert.equal(deployment.vars.ENVIRONMENT, 'production');
assert.equal(deployment.vars.RSVP_ENABLED, 'false');
assert.equal(deployment.vars.PUBLIC_RSVP_ENABLED, 'false');
assert.equal(deployment.vars.PUBLIC_ORIGIN, 'https://invite.example.com');
for (const key of ['ADMIN_EMAILS','CF_ACCESS_TEAM_DOMAIN','CF_ACCESS_AUD']) assert.equal(deployment.vars[key], '');
assert.equal(deployment.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000000');
assert.equal(deployment.account_id, undefined);
assert.equal(deployment.routes, undefined);
assert.equal(deployment.workers_dev, false);
assert.equal(deployment.preview_urls, false);
assert.ok(!wedding.music?.src && wedding.music?.autoplay !== true, 'Default demo must not ship a recording');
assert.equal(animalCharmsConfig.enabled, false);
assert.deepEqual(animalCharmsConfig.pets, []);
for (const photo of Object.values(wedding.photos)) assert.ok(existsSync(join('public',photo.src)), `Missing demo illustration ${photo.src}`);

let references = 0;
for (const file of readdirSync('public').filter(file => /\.(?:html|css|js)$/.test(file))) {
  const source = readFileSync(join('public', file),'utf8');
  for (const match of source.matchAll(/(?:["'(])((?:\/assets|\/vendor)\/[\w./-]+\.(?:svg|woff2|js|jpg|jpeg|png|webp|mp3|wav))(?:[?][^"')\s]*)?(?=["')\s])/g)) {
    assert.ok(existsSync(join('public',match[1])), `Missing static asset in ${file}: ${match[1]}`);
    references++;
  }
}
console.log(`Release audit passed: ${files.length} candidate files; ${references} static asset references; disabled production template and neutral demo defaults.`);
