#!/usr/bin/env node
// Lifecycle guardrails. Run: node scripts/check-evidence.mjs
//
// Failure prevented (1): research happening mid-build. A spec must link a
// finished spike record; a plan must declare research_trigger, and link a
// finished record unless the trigger is `none`. A record dated after the
// document linking it means evidence was gathered after the decision.
//
// Failure prevented (2): real data leaking into git. The Wells CSV is real
// well data and *.db files hold seeded data; neither may be tracked.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const field = (text, name) => text.match(new RegExp(`^${name}:\\s*([^\\n#]*)`, 'm'))?.[1].trim() ?? '';
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const list = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md')) : []);

function checkEvidenceLink(docPath, docText) {
  const link = field(docText, 'evidence');
  if (!link) return errors.push(`${docPath}: missing evidence: link`);
  if (!existsSync(join(root, link))) return errors.push(`${docPath}: evidence ${link} does not exist`);
  const spike = read(link);
  if (!field(spike, 'decision')) errors.push(`${docPath}: evidence ${link} has no decision (not finished)`);
  const docDate = field(docText, 'date');
  const spikeDate = field(spike, 'date');
  if (!docDate || !spikeDate) return errors.push(`${docPath}: both it and ${link} need an ISO date:`);
  if (spikeDate > docDate) errors.push(`${docPath}: evidence ${link} (${spikeDate}) is dated after the document (${docDate})`);
}

for (const f of list('docs/specs')) {
  const path = `docs/specs/${f}`;
  checkEvidenceLink(path, read(path));
}

for (const f of list('docs/plans')) {
  const path = `docs/plans/${f}`;
  const text = read(path);
  const trigger = field(text, 'research_trigger');
  if (!trigger) errors.push(`${path}: missing research_trigger:`);
  else if (trigger !== 'none') checkEvidenceLink(path, text);
}

const tracked = execFileSync('git', ['ls-files', '--', '*.db', '*.csv', '*.sqlite', '.env'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (tracked.length) errors.push(`data files tracked in git: ${tracked.join(', ')}`);

if (errors.length) {
  console.error(`check-evidence: ${errors.length} problem(s)\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('check-evidence: ok');
