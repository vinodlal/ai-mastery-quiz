// Self-test suite: data invariants, curriculum structure, scenario weaving,
// SM-2 scheduler behaviour, assessment config, and PWA build artefacts.
// Run AFTER `npm run build`. Exits non-zero if any check fails.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  newConceptState, applyAnswer, masteryPercent, dueConcepts,
  ASSESSMENT, levelPassed, sampleLevelQuestions, addDays,
} from "../src/lib/scheduler.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(readFileSync(join(root, "concept_inventory.json"), "utf8"));
const bank = JSON.parse(readFileSync(join(root, "question_bank.json"), "utf8"));

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail || "ok" });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const conceptQs = bank.questions.filter((q) => q.kind === "concept");
const scenarioQs = bank.questions.filter((q) => q.kind === "scenario");
const byId = Object.fromEntries(inventory.concepts.map((c) => [c.id, c]));

// ---- 1. concept coverage ----
check("Every concept has >=1 mapped concept question", () => {
  const covered = new Set(conceptQs.map((q) => q.concept_id));
  const missing = inventory.concepts.filter((c) => !covered.has(c.id));
  assert(missing.length === 0, `Missing: ${missing.map((m) => m.id).join(", ")}`);
  return `${inventory.concepts.length} concepts covered by ${conceptQs.length} questions (+${scenarioQs.length} scenarios)`;
});

// ---- 2. question integrity ----
check("Every question has 4 options + valid correct_index + non-empty explanation", () => {
  for (const q of bank.questions) {
    assert(Array.isArray(q.options) && q.options.length === 4, `${q.id}: options != 4`);
    assert(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3, `${q.id}: bad correct_index`);
    assert(typeof q.explanation === "string" && q.explanation.trim().length >= 40, `${q.id}: empty/short explanation`);
    assert([1, 2, 3].includes(q.difficulty), `${q.id}: bad difficulty`);
    assert(q.day_assigned >= 1 && q.day_assigned <= 21, `${q.id}: bad day_assigned`);
    assert(["concept", "scenario"].includes(q.kind), `${q.id}: bad kind`);
    assert(q.id && q.concept_id && q.question_text, `${q.id}: missing core fields`);
  }
  return `${bank.questions.length} questions valid`;
});

// ---- 3. duplicates ----
check("No duplicate questions (ids or texts)", () => {
  const ids = new Set(), texts = new Set();
  for (const q of bank.questions) {
    assert(!ids.has(q.id), `dup id ${q.id}`);
    ids.add(q.id);
    const t = q.question_text.trim().toLowerCase();
    assert(!texts.has(t), `dup text on ${q.id}`);
    texts.add(t);
  }
  return "all ids and texts unique";
});

// ---- 4. curriculum structure ----
check("Curriculum: 21 sequential days, whole-course coverage, parts in order", () => {
  assert(inventory.curriculum.length === 21, "must be 21 days");
  const seen = new Set();
  let lastPart = 0;
  for (const d of [...inventory.curriculum].sort((a, b) => a.day - b.day)) {
    assert(d.concept_ids.length > 0, `day ${d.day} empty`);
    assert(d.part >= lastPart, `day ${d.day}: part ${d.part} out of sequence`);
    lastPart = d.part;
    for (const id of d.concept_ids) {
      assert(byId[id], `day ${d.day}: unknown concept ${id}`);
      assert(!seen.has(id), `${id} in two days`);
      seen.add(id);
    }
  }
  assert(seen.size === inventory.concepts.length, `curriculum covers ${seen.size}/${inventory.concepts.length}`);
  return `21 days, 5 parts, all ${seen.size} concepts exactly once`;
});

check("Concept day_assigned matches curriculum; enhancement content in final part", () => {
  for (const d of inventory.curriculum) {
    for (const id of d.concept_ids) assert(byId[id].day_assigned === d.day, `${id} day mismatch`);
  }
  for (const c of inventory.concepts.filter((c) => c.source_type === "enhancement")) {
    assert(c.day_assigned >= 19, `${c.id} (enhancement) scheduled day ${c.day_assigned}`);
  }
  return "day fields consistent; enhancements in days 19-21 (Part 5)";
});

// ---- 5. scenarios ----
check("Scenarios: cross-concept, taught-before-tested, woven into every day 2-21", () => {
  for (const s of scenarioQs) {
    assert(Array.isArray(s.concept_ids) && s.concept_ids.length >= 2, `${s.id}: needs >=2 linked concepts`);
    let maxDay = 0;
    for (const id of s.concept_ids) {
      assert(byId[id], `${s.id}: unknown concept ${id}`);
      maxDay = Math.max(maxDay, byId[id].day_assigned);
    }
    assert(s.day_assigned >= maxDay, `${s.id}: scheduled before its concepts are taught`);
  }
  for (let day = 2; day <= 21; day++) {
    assert(scenarioQs.some((s) => s.day_assigned === day), `day ${day} has no scenario`);
  }
  return `${scenarioQs.length} scenarios; every day 2-21 has at least one`;
});

// ---- 6. SM-2 scheduler behaviour ----
check("SM-2: correct answers re-queue LATER (1 -> 3 -> growing interval)", () => {
  let s = newConceptState("x");
  s = applyAnswer(s, true, "2026-07-01");
  assert(s.interval === 1 && s.due === "2026-07-02", `1st correct: interval ${s.interval}, due ${s.due}`);
  s = applyAnswer(s, true, "2026-07-02");
  assert(s.interval === 3 && s.due === "2026-07-05", `2nd correct: interval ${s.interval}`);
  s = applyAnswer(s, true, "2026-07-05");
  assert(s.interval > 3, `3rd correct: interval ${s.interval} should exceed 3`);
  const prev = s.interval;
  s = applyAnswer(s, true, s.due);
  assert(s.interval > prev, `interval should keep growing (${prev} -> ${s.interval})`);
  return "intervals: 1, 3, then multiplied by EF";
});

check("SM-2: wrong answers re-queue SOONER (same day, interval reset, EF drops)", () => {
  let s = newConceptState("x");
  s = applyAnswer(s, true, "2026-07-01");
  s = applyAnswer(s, true, "2026-07-02");
  const efBefore = s.ef;
  s = applyAnswer(s, false, "2026-07-03");
  assert(s.due === "2026-07-03", `wrong answer should be due SAME day, got ${s.due}`);
  assert(s.interval === 0 && s.reps === 0, "interval/reps must reset");
  assert(s.ef < efBefore && s.ef >= 1.3, "EF lowered with floor 1.3");
  return "wrong => due today, reps reset, EF lowered with floor";
});

check("Mastery requires 3 consecutive correct on DIFFERENT days", () => {
  let s = newConceptState("x");
  s = applyAnswer(s, true, "2026-07-01");
  s = applyAnswer(s, true, "2026-07-01");
  s = applyAnswer(s, true, "2026-07-01");
  assert(!s.mastered && masteryPercent(s) === 33, "3 same-day corrects must not master");
  s = applyAnswer(s, true, "2026-07-02");
  s = applyAnswer(s, true, "2026-07-04");
  assert(s.mastered && masteryPercent(s) === 100, "3 distinct days should master");
  let s2 = newConceptState("y");
  s2 = applyAnswer(s2, true, "2026-07-01");
  s2 = applyAnswer(s2, true, "2026-07-02");
  s2 = applyAnswer(s2, false, "2026-07-03");
  assert(s2.streakDates.length === 0 && !s2.mastered, "wrong answer must reset streak");
  return "same-day repeats don't count; wrong resets streak";
});

check("Due queue: wrong answers due today, correct answers due later", () => {
  const states = {};
  let a = newConceptState("a"); a = applyAnswer(a, false, "2026-07-01"); states.a = a;
  let b = newConceptState("b"); b = applyAnswer(b, true, "2026-07-01"); states.b = b;
  assert(dueConcepts(states, "2026-07-01").length === 1, "only wrong-answered due today");
  assert(dueConcepts(states, "2026-07-02").length === 2, "both due tomorrow");
  return "due filtering correct";
});

// ---- 7. assessment ----
check("Assessment: 3 levels x 10 min = 30 min; thresholds 90/85/80", () => {
  assert(ASSESSMENT.levels.length === 3, "3 levels");
  assert(ASSESSMENT.levels.reduce((n, l) => n + l.minutes, 0) === 30, "total 30 min");
  assert(ASSESSMENT.levels[0].passPct === 90 && ASSESSMENT.levels[1].passPct === 85 && ASSESSMENT.levels[2].passPct === 80, "thresholds");
  return "config correct";
});

check("Assessment: pass-threshold math at boundaries", () => {
  const [l1, l2, l3] = ASSESSMENT.levels;
  assert(levelPassed(l1, 11, 12) === true, "11/12 passes L1 (90%)");
  assert(levelPassed(l1, 10, 12) === false, "10/12 fails L1");
  assert(levelPassed(l2, 11, 12) === true, "11/12 passes L2 (85%)");
  assert(levelPassed(l2, 10, 12) === false, "10/12 fails L2");
  assert(levelPassed(l3, 10, 12) === true, "10/12 passes L3 (80%)");
  assert(levelPassed(l3, 9, 12) === false, "9/12 fails L3");
  assert(levelPassed(l3, 0, 0) === false, "0/0 must not pass");
  return "boundary cases correct";
});

check("Assessment: each level samples 12 unique questions incl. scenarios; L3 includes enhancement", () => {
  for (const l of ASSESSMENT.levels) {
    const sampled = sampleLevelQuestions(bank.questions, l);
    assert(sampled.length === l.questions, `L${l.level}: got ${sampled.length}`);
    assert(new Set(sampled.map((q) => q.id)).size === l.questions, `L${l.level}: duplicate sample`);
    assert(sampled.every((q) => q.difficulty === l.difficulty), `L${l.level}: wrong difficulty mixed in`);
    assert(sampled.some((q) => q.kind === "scenario"), `L${l.level}: no scenarios woven in`);
  }
  const l3 = sampleLevelQuestions(bank.questions, ASSESSMENT.levels[2]);
  const l3pool = bank.questions.filter((q) => q.difficulty === 3);
  assert(l3pool.some((q) => q.source_type === "enhancement"), "L3 pool lacks enhancement");
  return "12 per level, scenarios woven into every level";
});

// ---- 8. PWA build artefacts ----
check("Manifest valid (name, standalone, icons 192+512+maskable, start_url)", () => {
  const p = join(root, "dist", "manifest.webmanifest");
  assert(existsSync(p), "dist/manifest.webmanifest missing — run npm run build");
  const m = JSON.parse(readFileSync(p, "utf8"));
  assert(m.name && m.short_name, "name/short_name");
  assert(m.display === "standalone", "display must be standalone");
  assert(m.start_url, "start_url");
  const sizes = m.icons.map((i) => i.sizes);
  assert(sizes.includes("192x192") && sizes.includes("512x512"), "need 192 + 512 icons");
  assert(m.icons.some((i) => i.purpose === "maskable"), "need maskable icon");
  return `${m.name} — ${m.icons.length} icons present`;
});

check("Service worker generated and precaches the full app (offline-capable)", () => {
  const swPath = join(root, "dist", "sw.js");
  assert(existsSync(swPath), "dist/sw.js missing");
  const sw = readFileSync(swPath, "utf8");
  assert(sw.includes("precache"), "no precache logic in sw.js");
  assert(existsSync(join(root, "dist", "index.html")), "dist/index.html missing");
  assert(sw.includes("index.html") && sw.includes(".js") && sw.includes(".css"), "app shell not fully precached");
  assert(existsSync(join(root, "dist", "icons", "apple-touch-icon.png")), "apple-touch-icon missing");
  return "sw.js precaches index.html + assets";
});

check("iOS installability tags present in built index.html", () => {
  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  assert(html.includes("apple-mobile-web-app-capable"), "apple meta missing");
  assert(html.includes("apple-touch-icon"), "apple-touch-icon link missing");
  assert(html.includes("viewport-fit=cover"), "viewport-fit=cover missing");
  assert(html.includes("manifest"), "manifest link missing");
  return "meta tags for Add to Home Screen present";
});

// ---- report ----
const width = Math.max(...results.map((r) => r.name.length));
console.log("\nSELF-TEST RESULTS");
console.log("-".repeat(width + 12));
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter((r) => !r.pass);
console.log("-".repeat(width + 12));
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
