// Self-test suite: data invariants, SM-2 scheduler behaviour, curriculum
// coverage, assessment config, and PWA build artefacts.
// Run AFTER `npm run build`. Exits non-zero if any check fails.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  newConceptState, applyAnswer, masteryPercent, dueConcepts, nextNewConcepts,
  ASSESSMENT, levelPassed, sampleQuestions, addDays,
} from "../src/lib/scheduler.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(readFileSync(join(root, "concept_inventory.json"), "utf8"));
const bank = JSON.parse(readFileSync(join(root, "question_bank.json"), "utf8"));

const results = [];
function check(name, fn) {
  try {
    const detail = fn(); // throw on failure; return detail string
    results.push({ name, pass: true, detail: detail || "ok" });
  } catch (e) {
    results.push({ name, pass: false, detail: e.message });
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ---- 1. concept coverage ----
check("Every concept has >=1 mapped question", () => {
  const covered = new Set(bank.questions.map((q) => q.concept_id));
  const missing = inventory.concepts.filter((c) => !covered.has(c.id));
  assert(missing.length === 0, `Missing: ${missing.map((m) => m.id).join(", ")}`);
  return `${inventory.concepts.length} concepts, all covered by ${bank.questions.length} questions`;
});

// ---- 2. question integrity ----
check("Every question has 4 options + valid correct_index + non-empty explanation", () => {
  for (const q of bank.questions) {
    assert(Array.isArray(q.options) && q.options.length === 4, `${q.id}: options != 4`);
    assert(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3, `${q.id}: bad correct_index`);
    assert(typeof q.explanation === "string" && q.explanation.trim().length >= 40, `${q.id}: empty/short explanation`);
    assert([1, 2, 3].includes(q.difficulty), `${q.id}: bad difficulty`);
    assert(q.day_assigned >= 1 && q.day_assigned <= 21, `${q.id}: bad day_assigned`);
    assert(["source", "enhancement"].includes(q.source_type), `${q.id}: bad source_type`);
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

// ---- 4. curriculum days ----
check("Curriculum days 1-21 each have content", () => {
  const days = {};
  for (const c of inventory.concepts) days[c.day_assigned] = (days[c.day_assigned] || 0) + 1;
  for (let d = 1; d <= 21; d++) assert(days[d] > 0, `day ${d} empty`);
  return Object.entries(days).map(([d, n]) => `${d}:${n}`).join(" ");
});

check("Difficulty bands match curriculum phases (1-7 =>1, 8-14 =>2, 15-21 =>3)", () => {
  for (const q of bank.questions) {
    const band = q.day_assigned <= 7 ? 1 : q.day_assigned <= 14 ? 2 : 3;
    assert(q.difficulty === band, `${q.id}: day ${q.day_assigned} but difficulty ${q.difficulty}`);
  }
  return "all questions in-band";
});

check("Enhancement concepts scheduled in expert phase (days 15-21)", () => {
  for (const c of inventory.concepts.filter((c) => c.source_type === "enhancement")) {
    assert(c.day_assigned >= 15, `${c.id} scheduled day ${c.day_assigned}`);
  }
  return "all enhancement content in days 15-21";
});

// ---- 5. SM-2 scheduler behaviour ----
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
  assert(s.interval > prev, `4th correct: interval should keep growing (${prev} -> ${s.interval})`);
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
  assert(s.ef < efBefore, `EF should drop (${efBefore} -> ${s.ef})`);
  assert(s.ef >= 1.3, "EF floor 1.3");
  return "wrong => due today, reps reset, EF lowered with floor";
});

check("Mastery requires 3 consecutive correct on DIFFERENT days", () => {
  // 3 corrects on the SAME day must NOT master
  let s = newConceptState("x");
  s = applyAnswer(s, true, "2026-07-01");
  s = applyAnswer(s, true, "2026-07-01");
  s = applyAnswer(s, true, "2026-07-01");
  assert(!s.mastered, "3 same-day corrects must not master");
  assert(masteryPercent(s) === 33, `expected 33%, got ${masteryPercent(s)}`);
  // different days -> mastered
  s = applyAnswer(s, true, "2026-07-02");
  assert(!s.mastered && masteryPercent(s) === 67, "2 distinct days = 67%");
  s = applyAnswer(s, true, "2026-07-04");
  assert(s.mastered && masteryPercent(s) === 100, "3 distinct days should master");
  // a wrong answer breaks the streak for a fresh concept
  let s2 = newConceptState("y");
  s2 = applyAnswer(s2, true, "2026-07-01");
  s2 = applyAnswer(s2, true, "2026-07-02");
  s2 = applyAnswer(s2, false, "2026-07-03");
  assert(s2.streakDates.length === 0 && !s2.mastered, "wrong answer must reset streak");
  s2 = applyAnswer(s2, true, "2026-07-03");
  s2 = applyAnswer(s2, true, "2026-07-04");
  assert(!s2.mastered, "only 2 distinct days since reset");
  s2 = applyAnswer(s2, true, "2026-07-05");
  assert(s2.mastered, "3 distinct days after reset should master");
  return "same-day repeats don't count; wrong resets streak";
});

check("Due queue and new-concept queue behave correctly", () => {
  const states = {};
  let a = newConceptState(inventory.concepts[0].id);
  a = applyAnswer(a, false, "2026-07-01"); // due same day
  states[a.conceptId] = a;
  let b = newConceptState(inventory.concepts[1].id);
  b = applyAnswer(b, true, "2026-07-01"); // due 07-02
  states[b.conceptId] = b;
  assert(dueConcepts(states, "2026-07-01").length === 1, "only the wrong-answered concept due today");
  assert(dueConcepts(states, "2026-07-02").length === 2, "both due tomorrow");
  const next5 = nextNewConcepts(inventory.concepts, states, 5);
  assert(next5.length === 5, "should offer 5 new");
  assert(!next5.some((c) => states[c.id]), "new list must exclude introduced");
  const order = next5.map((c) => c.day_assigned);
  assert([...order].sort((x, y) => x - y).join() === order.join(), "new concepts served in curriculum-day order");
  return "due filtering + curriculum-ordered new queue";
});

// ---- 6. assessment ----
check("Assessment: 3 levels x 10 min = 30 min; thresholds 90/85/80", () => {
  assert(ASSESSMENT.levels.length === 3, "3 levels");
  assert(ASSESSMENT.levels.reduce((n, l) => n + l.minutes, 0) === 30, "total 30 min");
  assert(ASSESSMENT.levels[0].passPct === 90 && ASSESSMENT.levels[1].passPct === 85 && ASSESSMENT.levels[2].passPct === 80, "thresholds");
  assert(ASSESSMENT.levels[0].difficulty === 1 && ASSESSMENT.levels[2].difficulty === 3, "level->difficulty mapping");
  return "config correct";
});

check("Assessment: pass-threshold math at boundaries", () => {
  const [l1, l2, l3] = ASSESSMENT.levels;
  assert(levelPassed(l1, 11, 12) === true, "11/12 = 91.7% passes L1 (90%)");
  assert(levelPassed(l1, 10, 12) === false, "10/12 = 83.3% fails L1");
  assert(levelPassed(l2, 11, 12) === true, "11/12 passes L2 (85%)");
  assert(levelPassed(l2, 10, 12) === false, "10/12 = 83.3% fails L2");
  assert(levelPassed(l3, 10, 12) === true, "10/12 = 83.3% passes L3 (80%)");
  assert(levelPassed(l3, 9, 12) === false, "9/12 = 75% fails L3");
  assert(levelPassed(l3, 0, 0) === false, "0/0 must not pass");
  return "boundary cases correct";
});

check("Assessment: question pools are sufficient and level 3 includes enhancement content", () => {
  for (const l of ASSESSMENT.levels) {
    const pool = bank.questions.filter((q) => q.difficulty === l.difficulty);
    assert(pool.length >= l.questions, `L${l.level} pool ${pool.length} < ${l.questions}`);
    const sampled = sampleQuestions(bank.questions, l.difficulty, l.questions);
    assert(sampled.length === l.questions, `L${l.level} sample size`);
    assert(new Set(sampled.map((q) => q.id)).size === l.questions, `L${l.level} sample has dups`);
  }
  const l3pool = bank.questions.filter((q) => q.difficulty === 3);
  assert(l3pool.some((q) => q.source_type === "enhancement"), "L3 pool must include enhancement questions");
  const enhShare = l3pool.filter((q) => q.source_type === "enhancement").length / l3pool.length;
  return `pools ok; L3 pool is ${Math.round(enhShare * 100)}% enhancement content`;
});

// ---- 7. PWA build artefacts ----
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
  for (const i of m.icons) assert(existsSync(join(root, "dist", i.src)), `icon file ${i.src} missing`);
  return `${m.name} — ${m.icons.length} icons present`;
});

check("Service worker generated and precaches the full app (offline-capable)", () => {
  const swPath = join(root, "dist", "sw.js");
  assert(existsSync(swPath), "dist/sw.js missing");
  const sw = readFileSync(swPath, "utf8");
  assert(sw.includes("precacheAndRoute") || sw.includes("precache"), "no precache logic in sw.js");
  assert(existsSync(join(root, "dist", "index.html")), "dist/index.html missing");
  assert(sw.includes("index.html"), "index.html not in precache manifest");
  // every built asset should be precached
  assert(sw.includes(".js") && sw.includes(".css"), "js/css not precached");
  assert(existsSync(join(root, "dist", "icons", "apple-touch-icon.png")), "apple-touch-icon missing");
  return "sw.js precaches index.html + assets; apple-touch-icon present";
});

check("iOS installability tags present in built index.html", () => {
  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  assert(html.includes("apple-mobile-web-app-capable"), "apple-mobile-web-app-capable meta missing");
  assert(html.includes("apple-touch-icon"), "apple-touch-icon link missing");
  assert(html.includes("viewport-fit=cover"), "viewport-fit=cover missing (safe areas)");
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
