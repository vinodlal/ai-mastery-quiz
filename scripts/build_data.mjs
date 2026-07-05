// Merges source + enhancement inventories, the sequential curriculum, per-concept
// questions and the cross-concept scenario bank into the two root deliverables:
// concept_inventory.json and question_bank.json.
// Day assignment comes from data/src/curriculum.json (institute-style sequential
// course). Answer options are deterministically shuffled (seeded by question id).
// Exits non-zero on any validation failure.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const srcInv = read("data/src/inventory.source.json");
const enhInv = read("data/src/inventory.enhancement.json");
const curriculum = read("data/src/curriculum.json");
const scenarios = read("data/src/scenarios.json");
const conceptQuestions = [1, 2, 3, 4].flatMap((n) => read(`data/src/questions.part${n}.json`));

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
const byId = Object.fromEntries(concepts.map((c) => [c.id, c]));

// ---- curriculum-driven day assignment ----
const dayOf = {};
const seen = new Set();
for (const d of curriculum.days) {
  if (!(d.day >= 1 && d.day <= 21)) errors.push(`Curriculum: bad day ${d.day}`);
  for (const id of d.concept_ids) {
    if (!byId[id]) errors.push(`Curriculum day ${d.day} references unknown concept ${id}`);
    if (seen.has(id)) errors.push(`Curriculum: ${id} assigned to more than one day`);
    seen.add(id);
    dayOf[id] = d.day;
  }
}
for (const c of concepts) {
  if (!seen.has(c.id)) errors.push(`Concept ${c.id} (${c.name}) missing from curriculum`);
  c.day_assigned = dayOf[c.id];
  c.part = (curriculum.days.find((d) => d.day === c.day_assigned) || {}).part;
}
// parts must be sequential day over day
let lastPart = 0;
for (const d of [...curriculum.days].sort((a, b) => a.day - b.day)) {
  if (d.part < lastPart) errors.push(`Curriculum: day ${d.day} part ${d.part} goes backwards`);
  lastPart = d.part;
}

// ---- deterministic option shuffle (seeded by question id) ----
function seededRand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function shuffleOptions(q) {
  const rand = seededRand(q.id);
  const idx = [0, 1, 2, 3];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  q.options = idx.map((i) => q.options[i]);
  q.correct_index = idx.indexOf(q.correct_index);
}

// ---- per-concept questions ----
for (const q of conceptQuestions) {
  const c = byId[q.concept_id];
  if (!c) { errors.push(`Question ${q.id} references unknown concept ${q.concept_id}`); continue; }
  q.kind = "concept";
  q.concept_ids = [q.concept_id];
  q.day_assigned = c.day_assigned;
  q.source_type = c.source_type;
  shuffleOptions(q);
}

// ---- scenarios (cross-concept) ----
for (const s of scenarios) {
  s.kind = "scenario";
  s.source_type = "scenario";
  s.concept_id = s.concept_ids[0]; // primary, for schema compatibility
  let maxDay = 0;
  for (const id of s.concept_ids) {
    const c = byId[id];
    if (!c) { errors.push(`Scenario ${s.id} references unknown concept ${id}`); continue; }
    maxDay = Math.max(maxDay, c.day_assigned);
  }
  if (s.concept_ids.length < 2) errors.push(`Scenario ${s.id} must link >=2 concepts`);
  if (s.day_assigned < maxDay) errors.push(`Scenario ${s.id} scheduled day ${s.day_assigned} before its concepts are taught (needs >= ${maxDay})`);
  shuffleOptions(s);
}
const questions = [...conceptQuestions, ...scenarios];

// ---- validations ----
const conceptIds = new Set();
for (const c of concepts) {
  if (conceptIds.has(c.id)) errors.push(`Duplicate concept id ${c.id}`);
  conceptIds.add(c.id);
  if (!c.name || !c.summary) errors.push(`Concept ${c.id} missing name/summary`);
  if (![1, 2, 3].includes(c.phase)) errors.push(`Concept ${c.id} bad phase`);
  if (!Array.isArray(c.sections) || c.sections.length === 0) errors.push(`Concept ${c.id} missing sections`);
}
const covered = new Set(conceptQuestions.map((q) => q.concept_id));
for (const c of concepts) if (!covered.has(c.id)) errors.push(`Concept ${c.id} (${c.name}) has NO mapped concept question`);

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
  if (!(q.day_assigned >= 1 && q.day_assigned <= 21)) errors.push(`${q.id}: bad day_assigned`);
  if (!q.question_text || q.question_text.trim().length < 10) errors.push(`${q.id}: missing question_text`);
}
for (let day = 1; day <= 21; day++) {
  if (!curriculum.days.some((d) => d.day === day && d.concept_ids.length > 0)) errors.push(`Day ${day} has no concepts assigned`);
}
// scenario weaving coverage: every day from 2..21 has at least one scenario
for (let day = 2; day <= 21; day++) {
  if (!scenarios.some((s) => s.day_assigned === day)) errors.push(`Day ${day} has no scenario woven in`);
}
// final-test pool sanity: 8 concept + 4 scenario questions per level
for (const d of [1, 2, 3]) {
  const cq = conceptQuestions.filter((q) => q.difficulty === d).length;
  const sq = scenarios.filter((s) => s.difficulty === d).length;
  if (cq < 8) errors.push(`Only ${cq} concept questions at difficulty ${d} (need >=8 for final)`);
  if (sq < 4) errors.push(`Only ${sq} scenarios at difficulty ${d} (need >=4 for final)`);
}

if (errors.length) {
  console.error(`BUILD FAILED — ${errors.length} error(s):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

writeFileSync(join(root, "concept_inventory.json"), JSON.stringify({
  meta: {
    ...srcInv.meta,
    enhancement_meta: enhInv.meta,
    total_concepts: concepts.length,
    course: curriculum.meta.parts,
  },
  curriculum: curriculum.days,
  concepts,
}, null, 2));
writeFileSync(join(root, "question_bank.json"), JSON.stringify({
  meta: {
    generated: srcInv.meta.generated,
    total_questions: questions.length,
    concept_questions: conceptQuestions.length,
    scenario_questions: scenarios.length,
  },
  questions,
}, null, 2));

const perDay = curriculum.days.map((d) => `${d.day}:${d.concept_ids.length}+${scenarios.filter((s) => s.day_assigned === d.day).length}s`).join(" ");
console.log(`OK: ${concepts.length} concepts, ${conceptQuestions.length} concept questions + ${scenarios.length} scenarios = ${questions.length} total.`);
console.log(`Per-day (concepts+scenarios): ${perDay}`);
console.log(`Scenario difficulty pools: d1=${scenarios.filter(s=>s.difficulty===1).length} d2=${scenarios.filter(s=>s.difficulty===2).length} d3=${scenarios.filter(s=>s.difficulty===3).length}`);
