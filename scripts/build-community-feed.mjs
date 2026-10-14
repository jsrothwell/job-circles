// Merges profiles/community/*.json into the single feed the site reads:
//   node scripts/build-community-feed.mjs
import { readdir, readFile, writeFile } from 'node:fs/promises';

const DIR = 'profiles/community';
const OUT = 'profiles/community.json';

let files = [];
try { files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort(); } catch {}

const profiles = [];
for (const f of files) {
  try { profiles.push(JSON.parse(await readFile(`${DIR}/${f}`, 'utf8'))); }
  catch (e) { console.warn(`Skipping ${f}: ${e.message}`); }
}

await writeFile(OUT, JSON.stringify(profiles, null, 2) + '\n');
console.log(`Wrote ${profiles.length} profile(s) to ${OUT}`);
