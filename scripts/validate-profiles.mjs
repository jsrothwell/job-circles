// Validates profile changes in a pull request.
//
//   BASE_SHA=<sha> PR_AUTHOR=<login> node scripts/validate-profiles.mjs [dir]
//
// Rules:
//   - every added or modified profile must pass profiles/schema.json;
//   - the file name must be <id>.json and the profile must name its owner in `github`;
//   - the profile owner may change anything except vouches from other people;
//   - anyone else may only add, edit or remove their own vouch;
//   - only the owner may delete a profile.
// Maintainers can still merge a PR that fails these checks (e.g. moderation).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const DIR = (process.argv[2] || 'profiles/community').replace(/\/$/, '');
const { BASE_SHA, PR_AUTHOR } = process.env;
if (!BASE_SHA || !PR_AUTHOR) {
  console.error('BASE_SHA and PR_AUTHOR must be set');
  process.exit(2);
}
const author = PR_AUTHOR.toLowerCase();

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(JSON.parse(readFileSync('profiles/schema.json', 'utf8')));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const errors = [];
const fail = (file, msg) => errors.push({ file, msg });

function readAtBase(file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${BASE_SHA}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return null; }
}

// Stable stringify so key order doesn't count as a change.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const vouchMap = (p) => new Map((p?.vouches || []).map((v) => [String(v.vouched_by_github).toLowerCase(), canonical(v)]));
const withoutVouches = (p) => { const { vouches, updated, ...rest } = p || {}; return canonical(rest); };

const changes = git('diff', '--name-status', '--no-renames', `${BASE_SHA}...HEAD`, '--', DIR)
  .trim().split('\n').filter(Boolean)
  .map((line) => { const [status, file] = line.split('\t'); return { status: status[0], file }; })
  .filter(({ file }) => file.endsWith('.json'));

if (!changes.length) console.log(`No profile changes under ${DIR}/.`);

for (const { status, file } of changes) {
  const before = readAtBase(file);
  const owner = String(before?.github || '').toLowerCase();

  if (status === 'D') {
    if (owner !== author) fail(file, `Only @${before?.github || 'the profile owner'} can delete this profile.`);
    continue;
  }

  let after;
  try { after = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { fail(file, `Not valid JSON: ${e.message}`); continue; }

  if (!validateSchema(after)) {
    for (const e of validateSchema.errors) fail(file, `Schema: ${e.instancePath || '(root)'} ${e.message}${e.params?.additionalProperty ? ` (“${e.params.additionalProperty}”)` : ''}`);
  }
  if (basename(file) !== `${after.id}.json`) fail(file, `File name must be "${after.id}.json" to match the profile id.`);
  if (!after.github) { fail(file, 'Profiles must include the owner\'s "github" username.'); continue; }
  if (after.id !== String(after.github).toLowerCase()) fail(file, `"id" must be the lowercase GitHub username ("${String(after.github).toLowerCase()}").`);

  const newOwner = String(after.github).toLowerCase();
  if (before && owner && newOwner !== owner) fail(file, 'The "github" owner of an existing profile cannot be changed.');

  const oldV = vouchMap(before), newV = vouchMap(after);
  const touched = [...new Set([...oldV.keys(), ...newV.keys()])].filter((k) => oldV.get(k) !== newV.get(k));

  for (const k of newV.keys()) if (k === newOwner) fail(file, 'You cannot vouch for yourself.');

  if (author === newOwner) {
    // Owners may remove vouches, but not add or edit them.
    const forged = touched.filter((k) => newV.has(k));
    if (forged.length) fail(file, `Vouches must be added by the person vouching. Ask ${forged.map((k) => '@' + k).join(', ')} to open their own pull request.`);
  } else {
    if (!before) { fail(file, `New profiles must be submitted by their owner, @${after.github}.`); continue; }
    if (withoutVouches(before) !== withoutVouches(after)) fail(file, `Only @${after.github} can edit this profile. Vouchers may only change their own vouch.`);
    const others = touched.filter((k) => k !== author);
    if (others.length) fail(file, `You can only add or change your own vouch (vouched_by_github: "${PR_AUTHOR}").`);
  }
}

for (const { file, msg } of errors) console.log(`::error file=${file}::${msg}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log(`${changes.length} profile change(s) passed.`);
