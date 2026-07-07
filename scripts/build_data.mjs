// Builds the two root deliverables from data/src/:
//   concept_inventory.json — concepts + thematic gated curriculum (parts with
//     ordered `topics` and matching ordered `quiz_questions`)
//   question_bank.json     — per-concept questions + scenario bank
// Part assignment comes from data/src/curriculum.json (thematic clusters,
// foundational-first). Scenarios get min_part_required = highest part among
// their linked concepts. Answer options are deterministically shuffled
// (seeded by question id). Exits non-zero on any validation failure.
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
const questionByConcept = {};
for (const q of conceptQuestions) {
  if (questionByConcept[q.concept_id]) errors.push(`Concept ${q.concept_id} has more than one question (${q.id})`);
  questionByConcept[q.concept_id] = q;
}

// ---- thematic part assignment ----
const partOf = {};
const seen = new Set();
const parts = [...curriculum.parts].sort((a, b) => a.part - b.part);
parts.forEach((p, i) => {
  if (p.part !== i + 1) errors.push(`Parts must be sequential 1..N (found ${p.part} at position ${i + 1})`);
  if (!p.title || !p.theme) errors.push(`Part ${p.part} missing title/theme`);
  if (!Array.isArray(p.topics) || p.topics.length === 0) errors.push(`Part ${p.part} has no topics`);
  for (const id of p.topics) {
    if (!byId[id]) errors.push(`Part ${p.part} references unknown concept ${id}`);
    if (seen.has(id)) errors.push(`Concept ${id} appears in more than one part`);
    seen.add(id);
    partOf[id] = p.part;
  }
});
for (const c of concepts) {
  if (!seen.has(c.id)) errors.push(`Concept ${c.id} (${c.name}) missing from curriculum`);
  c.part_assigned = partOf[c.id];
  c.day_assigned = partOf[c.id]; // kept for backwards compatibility: 1 part = 1 day
}
// modules must cover parts contiguously and in order
let lastEnd = 0;
for (const m of curriculum.meta.modules) {
  if (m.parts[0] !== lastEnd + 1) errors.push(`Module ${m.module} does not start at part ${lastEnd + 1}`);
  lastEnd = m.parts[1];
}
if (lastEnd !== parts.length) errors.push(`Modules cover ${lastEnd} parts but there are ${parts.length}`);

// ---- per-part ordered quiz list: one question per topic, SAME order ----
for (const p of parts) {
  p.quiz_questions = p.topics.map((id) => {
    const q = questionByConcept[id];
    if (!q) errors.push(`Part ${p.part}: topic ${id} has no question`);
    return q ? q.id : null;
  });
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
  q.part_assigned = c.part_assigned;
  q.day_assigned = c.part_assigned;
  q.source_type = c.source_type;
  shuffleOptions(q);
}

// ---- scenario bank (cross-concept, gated by min_part_required) ----
for (const s of scenarios) {
  s.kind = "scenario";
  s.source_type = "scenario";
  s.concept_id = s.concept_ids[0];
  if (!Array.isArray(s.concept_ids) || s.concept_ids.length < 2) errors.push(`Scenario ${s.id} must link >=2 concepts`);
  const partsTouched = new Set();
  let minPart = 0;
  for (const id of s.concept_ids) {
    const c = byId[id];
    if (!c) { errors.push(`Scenario ${s.id} references unknown concept ${id}`); continue; }
    partsTouched.add(c.part_assigned);
    minPart = Math.max(minPart, c.part_assigned);
  }
  s.min_part_required = minPart;
  s.day_assigned = minPart;
  s.part_assigned = minPart;
  s.spans_parts = [...partsTouched].sort((a, b) => a - b);
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
}
const covered = new Set(conceptQuestions.map((q) => q.concept_id));
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
  if (!q.question_text || q.question_text.trim().length < 10) errors.push(`${q.id}: missing question_text`);
}
// scenario bank must sustain a scenario-driven Final Level 3 and weaving pools
const scenD3 = scenarios.filter((s) => s.difficulty === 3).length;
if (scenD3 < 8) errors.push(`Only ${scenD3} difficulty-3 scenarios (need >=8: Level 3 draws primarily from the scenario bank)`);
for (const d of [1, 2]) {
  const n = scenarios.filter((s) => s.difficulty === d).length;
  if (n < 2) errors.push(`Only ${n} difficulty-${d} scenarios (need >=2 for level weaving)`);
}
for (const d of [1, 2, 3]) {
  const n = conceptQuestions.filter((q) => q.difficulty === d).length;
  if (n < 8) errors.push(`Only ${n} concept questions at difficulty ${d}`);
}
// scenarios must become eligible at some point (min_part within course)
for (const s of scenarios) {
  if (!(s.min_part_required >= 1 && s.min_part_required <= parts.length)) errors.push(`${s.id}: bad min_part_required`);
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
    total_parts: parts.length,
    modules: curriculum.meta.modules,
  },
  curriculum: parts,
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

console.log(`OK: ${concepts.length} concepts in ${parts.length} thematic parts (${curriculum.meta.modules.length} modules); ${conceptQuestions.length} concept questions + ${scenarios.length} scenarios.`);
console.log(`Part sizes: ${parts.map((p) => `${p.part}:${p.topics.length}`).join(" ")}`);
console.log(`Scenario min_part spread: ${scenarios.map((s) => s.min_part_required).sort((a, b) => a - b).join(",")}`);
console.log(`Scenario difficulty pools: d1=${scenarios.filter(s=>s.difficulty===1).length} d2=${scenarios.filter(s=>s.difficulty===2).length} d3=${scenD3}`);
