// Merges source + enhancement inventories and question parts into the two
// root deliverables: concept_inventory.json and question_bank.json.
// Assigns curriculum days (phase 1 -> days 1-7, phase 2 -> 8-14, phase 3 -> 15-21),
// deterministically shuffles answer options (seeded by question id), and
// validates every invariant. Exits non-zero on any validation failure.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const srcInv = read("data/src/inventory.source.json");
const enhInv = read("data/src/inventory.enhancement.json");
const questions = [1, 2, 3, 4].flatMap((n) => read(`data/src/questions.part${n}.json`));

const errors = [];

// ---- merge concepts ----
const concepts = [
  ...srcInv.concepts.map((c) => ({ ...c, source_type: "source" })),
  ...enhInv.concepts.map((c) => ({ ...c, source_type: "enhancement" })),
];
for (const c of concepts) {
  const upd = enhInv.source_updates[c.id];
  if (upd) c.update_2026 = upd;
}

// ---- assign days: within each phase, round-robin across its 7 days ----
const phaseDays = { 1: [1, 2, 3, 4, 5, 6, 7], 2: [8, 9, 10, 11, 12, 13, 14], 3: [15, 16, 17, 18, 19, 20, 21] };
for (const phase of [1, 2, 3]) {
  const group = concepts.filter((c) => c.phase === phase);
  group.forEach((c, i) => { c.day_assigned = phaseDays[phase][i % 7]; });
}

// ---- deterministic option shuffle (seeded by question id) ----
function seededRand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));
for (const q of questions) {
  const c = byId[q.concept_id];
  if (!c) { errors.push(`Question ${q.id} references unknown concept ${q.concept_id}`); continue; }
  q.day_assigned = c.day_assigned;
  q.source_type = c.source_type;
  const rand = seededRand(q.id);
  const idx = [0, 1, 2, 3];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  q.options = idx.map((i) => q.options[i]);
  q.correct_index = idx.indexOf(q.correct_index);
}

// ---- validations ----
const conceptIds = new Set();
for (const c of concepts) {
  if (conceptIds.has(c.id)) errors.push(`Duplicate concept id ${c.id}`);
  conceptIds.add(c.id);
  if (!c.name || !c.summary) errors.push(`Concept ${c.id} missing name/summary`);
  if (![1, 2, 3].includes(c.phase)) errors.push(`Concept ${c.id} bad phase`);
  if (!(c.day_assigned >= 1 && c.day_assigned <= 21)) errors.push(`Concept ${c.id} bad day`);
  if (!Array.isArray(c.sections) || c.sections.length === 0) errors.push(`Concept ${c.id} missing sections`);
}
const covered = new Set(questions.map((q) => q.concept_id));
for (const c of concepts) if (!covered.has(c.id)) errors.push(`Concept ${c.id} (${c.name}) has NO mapped question`);

const qIds = new Set(); const qTexts = new Set();
for (const q of questions) {
  if (qIds.has(q.id)) errors.push(`Duplicate question id ${q.id}`);
  qIds.add(q.id);
  const norm = q.question_text.trim().toLowerCase();
  if (qTexts.has(norm)) errors.push(`Duplicate question text: ${q.id}`);
  qTexts.add(norm);
  if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`${q.id}: needs exactly 4 options`);
  if (new Set(q.options.map((o) => o.trim())).size !== 4) errors.push(`${q.id}: duplicate options`);
  if (!(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3)) errors.push(`${q.id}: bad correct_index`);
  if (!q.explanation || q.explanation.trim().length < 40) errors.push(`${q.id}: missing/short explanation`);
  if (![1, 2, 3].includes(q.difficulty)) errors.push(`${q.id}: bad difficulty`);
  const c = byId[q.concept_id];
  if (c && q.difficulty !== c.phase) errors.push(`${q.id}: difficulty ${q.difficulty} != concept phase ${c.phase}`);
  if (!q.question_text || q.question_text.trim().length < 10) errors.push(`${q.id}: missing question_text`);
  if (!["source", "enhancement"].includes(q.source_type)) errors.push(`${q.id}: bad source_type`);
}
for (let day = 1; day <= 21; day++) {
  const n = concepts.filter((c) => c.day_assigned === day).length;
  if (n === 0) errors.push(`Day ${day} has no concepts assigned`);
}
// final-test pool sanity: enough questions per level
const lvl = (d) => questions.filter((q) => q.difficulty === d).length;
if (lvl(1) < 10 || lvl(2) < 10 || lvl(3) < 10) errors.push(`Insufficient questions per difficulty: ${lvl(1)}/${lvl(2)}/${lvl(3)}`);

if (errors.length) {
  console.error(`BUILD FAILED — ${errors.length} error(s):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

writeFileSync(join(root, "concept_inventory.json"), JSON.stringify({
  meta: { ...srcInv.meta, enhancement_meta: enhInv.meta, total_concepts: concepts.length },
  concepts,
}, null, 2));
writeFileSync(join(root, "question_bank.json"), JSON.stringify({
  meta: { generated: srcInv.meta.generated, total_questions: questions.length },
  questions,
}, null, 2));

const perDay = {};
for (const c of concepts) perDay[c.day_assigned] = (perDay[c.day_assigned] || 0) + 1;
console.log(`OK: ${concepts.length} concepts (${srcInv.concepts.length} source + ${enhInv.concepts.length} enhancement), ${questions.length} questions.`);
console.log(`Per-day concept counts: ${Object.entries(perDay).map(([d, n]) => `${d}:${n}`).join(" ")}`);
console.log(`Difficulty counts: d1=${lvl(1)} d2=${lvl(2)} d3=${lvl(3)}`);
