// Self-test suite v3: data invariants, thematic gated curriculum, Study/Quiz
// order matching, unlock gating, scenario min_part gating, scenario-driven
// Final Level 3, SM-2 behaviour, assessment config, and PWA build artefacts.
// Run AFTER `npm run build`. Exits non-zero if any check fails.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  newConceptState, applyAnswer, masteryPercent, dueConcepts,
  ASSESSMENT, levelPassed, sampleLevelQuestions,
  applyLessonResult, eligibleScenarios, pickSessionScenarios,
  DEFAULT_PASS_THRESHOLD, SCENARIO_WEAVE_MIN_PARTS,
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

const parts = [...inventory.curriculum].sort((a, b) => a.part - b.part);
const conceptQs = bank.questions.filter((q) => q.kind === "concept");
const scenarioQs = bank.questions.filter((q) => q.kind === "scenario");
const byId = Object.fromEntries(inventory.concepts.map((c) => [c.id, c]));
const qById = Object.fromEntries(bank.questions.map((q) => [q.id, q]));

// ---- data invariants ----
check("Every concept has >=1 mapped concept question", () => {
  const covered = new Set(conceptQs.map((q) => q.concept_id));
  const missing = inventory.concepts.filter((c) => !covered.has(c.id));
  assert(missing.length === 0, `Missing: ${missing.map((m) => m.id).join(", ")}`);
  return `${inventory.concepts.length} concepts covered by ${conceptQs.length} questions (+${scenarioQs.length} scenarios)`;
});

check("Every question has 4 options + valid correct_index + non-empty explanation", () => {
  for (const q of bank.questions) {
    assert(Array.isArray(q.options) && q.options.length === 4, `${q.id}: options != 4`);
    assert(Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index <= 3, `${q.id}: bad correct_index`);
    assert(typeof q.explanation === "string" && q.explanation.trim().length >= 40, `${q.id}: empty/short explanation`);
    assert([1, 2, 3].includes(q.difficulty), `${q.id}: bad difficulty`);
    assert(["concept", "scenario"].includes(q.kind), `${q.id}: bad kind`);
  }
  return `${bank.questions.length} questions valid`;
});

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

// ---- thematic gated curriculum ----
check("Curriculum: sequential parts, modules contiguous, whole-course coverage exactly once", () => {
  const seen = new Set();
  parts.forEach((p, i) => {
    assert(p.part === i + 1, `part numbering gap at ${p.part}`);
    assert(p.topics.length > 0, `part ${p.part} empty`);
    for (const id of p.topics) {
      assert(byId[id], `part ${p.part}: unknown ${id}`);
      assert(!seen.has(id), `${id} in two parts`);
      seen.add(id);
    }
  });
  assert(seen.size === inventory.concepts.length, `parts cover ${seen.size}/${inventory.concepts.length}`);
  let lastEnd = 0;
  for (const m of inventory.meta.modules) {
    assert(m.parts[0] === lastEnd + 1, `module ${m.module} gap`);
    lastEnd = m.parts[1];
  }
  assert(lastEnd === parts.length, "modules don't span all parts");
  return `${parts.length} parts in ${inventory.meta.modules.length} modules, all ${seen.size} concepts exactly once`;
});

check("Study Mode and Day Quiz topic order match EXACTLY (per part)", () => {
  for (const p of parts) {
    assert(Array.isArray(p.quiz_questions) && p.quiz_questions.length === p.topics.length,
      `part ${p.part}: quiz_questions length ${p.quiz_questions.length} != topics ${p.topics.length}`);
    p.topics.forEach((topicId, i) => {
      const q = qById[p.quiz_questions[i]];
      assert(q, `part ${p.part}: missing question ${p.quiz_questions[i]}`);
      assert(q.kind === "concept", `part ${p.part}: quiz slot ${i} is not a concept question`);
      assert(q.concept_id === topicId,
        `part ${p.part} position ${i + 1}: quiz asks ${q.concept_id} but study shows ${topicId}`);
    });
  }
  return "every part: one question per topic, identical order, no scenarios in Day Quizzes";
});

// ---- unlock gating (pure-logic unit tests) ----
check("Parts unlock strictly in order via pass gate (>= threshold), never by skipping", () => {
  let meta = { unlockedUpToPart: 1, partScores: {} };
  // failing score does NOT unlock
  let r = applyLessonResult(meta, 1, 7, 10, 80, parts.length); // 70%
  assert(!r.passed && r.meta.unlockedUpToPart === 1, "70% must not unlock part 2");
  assert(r.meta.partScores[1] === 70, "score must be recorded");
  // passing score unlocks exactly the next part
  r = applyLessonResult(r.meta, 1, 9, 10, 80, parts.length); // 90%
  assert(r.passed && r.meta.unlockedUpToPart === 2, "90% must unlock part 2");
  // passing a NON-frontier part must not skip ahead
  r = applyLessonResult(r.meta, 5, 10, 10, 80, parts.length);
  assert(r.meta.unlockedUpToPart === 2, "passing part 5 while on part 2 must not unlock anything");
  // retaking an already-passed part must not re-lock
  r = applyLessonResult(r.meta, 1, 2, 10, 80, parts.length);
  assert(r.meta.unlockedUpToPart === 2, "failing a retake of part 1 must not re-lock");
  // boundary: exactly threshold passes
  r = applyLessonResult({ unlockedUpToPart: 2, partScores: {} }, 2, 8, 10, 80, parts.length);
  assert(r.passed && r.meta.unlockedUpToPart === 3, "exactly 80% must pass");
  // custom threshold respected
  r = applyLessonResult({ unlockedUpToPart: 2, partScores: {} }, 2, 8, 10, 90, parts.length);
  assert(!r.passed, "80% must fail a 90% threshold");
  // completing the last part finishes the course
  r = applyLessonResult({ unlockedUpToPart: parts.length, partScores: {} }, parts.length, 10, 10, 80, parts.length);
  assert(r.meta.unlockedUpToPart === parts.length + 1, "passing the last part completes the course");
  return `gate verified at threshold ${DEFAULT_PASS_THRESHOLD}% (configurable); no skipping, no re-locking`;
});

// ---- scenario bank gating ----
check("Scenario bank: cross-part, min_part_required = highest referenced part", () => {
  for (const s of scenarioQs) {
    assert(Array.isArray(s.concept_ids) && s.concept_ids.length >= 2, `${s.id}: needs >=2 concepts`);
    const maxPart = Math.max(...s.concept_ids.map((id) => byId[id].part_assigned));
    assert(s.min_part_required === maxPart, `${s.id}: min_part_required ${s.min_part_required} != max part ${maxPart}`);
  }
  const crossPart = scenarioQs.filter((s) => new Set(s.concept_ids.map((id) => byId[id].part_assigned)).size >= 2).length;
  return `${scenarioQs.length} scenarios tagged; ${crossPart} span multiple parts`;
});

check("No scenario ever appears before its min_part_required is met (weaving gate)", () => {
  // below 3 unlocked parts: nothing is woven at all
  assert(eligibleScenarios(bank.questions, 1).length === 0, "unlocked=1 must weave nothing");
  assert(eligibleScenarios(bank.questions, 2).length === 0, "unlocked=2 must weave nothing");
  // at every unlock level, every eligible scenario's topics are already studied
  for (let unlocked = 3; unlocked <= parts.length + 1; unlocked++) {
    for (const s of eligibleScenarios(bank.questions, unlocked)) {
      assert(s.min_part_required < unlocked,
        `unlocked=${unlocked}: ${s.id} (needs part ${s.min_part_required}) served too early`);
    }
  }
  // session picker: 1-2 scenarios, all eligible
  for (const unlocked of [3, 10, parts.length + 1]) {
    const picked = pickSessionScenarios(bank.questions, unlocked);
    assert(picked.length <= 2, "must weave at most 2");
    for (const s of picked) assert(s.min_part_required < unlocked, `picker leaked ${s.id}`);
  }
  const atEnd = eligibleScenarios(bank.questions, parts.length + 1).length;
  assert(atEnd === scenarioQs.length, `all scenarios must be eligible after the course (${atEnd}/${scenarioQs.length})`);
  return `weaving starts at ${SCENARIO_WEAVE_MIN_PARTS}+ unlocked parts; studied-topics-only at every level`;
});

// ---- SM-2 (true mastery, unchanged and separate from the gate) ----
check("SM-2 mastery tracking unchanged: intervals grow, wrong re-queues same day, 3 distinct days to master", () => {
  let s = newConceptState("x");
  s = applyAnswer(s, true, "2026-07-01");
  assert(s.interval === 1 && s.due === "2026-07-02", "1st correct -> 1 day");
  s = applyAnswer(s, true, "2026-07-02");
  assert(s.interval === 3, "2nd correct -> 3 days");
  s = applyAnswer(s, false, "2026-07-05");
  assert(s.due === "2026-07-05" && s.reps === 0, "wrong -> due same day");
  let m = newConceptState("y");
  m = applyAnswer(m, true, "2026-07-01");
  m = applyAnswer(m, true, "2026-07-01");
  m = applyAnswer(m, true, "2026-07-01");
  assert(!m.mastered && masteryPercent(m) === 33, "same-day repeats don't master");
  m = applyAnswer(m, true, "2026-07-02");
  m = applyAnswer(m, true, "2026-07-03");
  assert(m.mastered, "3 distinct days master");
  const states = { a: applyAnswer(newConceptState("a"), false, "2026-07-01") };
  assert(dueConcepts(states, "2026-07-01").length === 1, "due queue works");
  return "true mastery % logic intact (separate from the unlock gate)";
});

// ---- assessment ----
check("Assessment: 3 levels x 10 min = 30 min; thresholds 90/85/80; boundary math", () => {
  assert(ASSESSMENT.levels.length === 3 && ASSESSMENT.levels.reduce((n, l) => n + l.minutes, 0) === 30, "config");
  const [l1, l2, l3] = ASSESSMENT.levels;
  assert(l1.passPct === 90 && l2.passPct === 85 && l3.passPct === 80, "thresholds");
  assert(levelPassed(l1, 11, 12) && !levelPassed(l1, 10, 12), "L1 boundary");
  assert(levelPassed(l3, 10, 12) && !levelPassed(l3, 9, 12), "L3 boundary");
  assert(!levelPassed(l3, 0, 0), "0/0 fails");
  return "config + boundaries correct";
});

check("Final Test Level 3 draws PRIMARILY from the scenario bank", () => {
  for (let trial = 0; trial < 5; trial++) {
    const l3 = sampleLevelQuestions(bank.questions, ASSESSMENT.levels[2]);
    assert(l3.length === 12, "L3 must have 12 questions");
    const scen = l3.filter((q) => q.kind === "scenario").length;
    assert(scen >= 7, `L3 sampled only ${scen} scenarios — must be scenario-driven (majority)`);
    assert(new Set(l3.map((q) => q.id)).size === 12, "L3 duplicates");
    assert(l3.every((q) => q.difficulty === 3), "L3 wrong difficulty");
  }
  for (const l of ASSESSMENT.levels.slice(0, 2)) {
    const sampled = sampleLevelQuestions(bank.questions, l);
    assert(sampled.length === l.questions, `L${l.level} size`);
    assert(sampled.some((q) => q.kind === "scenario"), `L${l.level} should weave scenarios`);
  }
  return "L3 majority-scenario across trials; L1-2 weave scenarios";
});

// ---- PWA build artefacts ----
check("Manifest valid (name, standalone, icons 192+512+maskable, start_url)", () => {
  const p = join(root, "dist", "manifest.webmanifest");
  assert(existsSync(p), "dist/manifest.webmanifest missing — run npm run build");
  const m = JSON.parse(readFileSync(p, "utf8"));
  assert(m.name && m.short_name && m.display === "standalone" && m.start_url, "manifest fields");
  const sizes = m.icons.map((i) => i.sizes);
  assert(sizes.includes("192x192") && sizes.includes("512x512"), "icons");
  assert(m.icons.some((i) => i.purpose === "maskable"), "maskable icon");
  return `${m.name} — ${m.icons.length} icons`;
});

check("Service worker precaches the full app; iOS install tags present", () => {
  const sw = readFileSync(join(root, "dist", "sw.js"), "utf8");
  assert(sw.includes("precache") && sw.includes("index.html") && sw.includes(".js") && sw.includes(".css"), "precache");
  const html = readFileSync(join(root, "dist", "index.html"), "utf8");
  assert(html.includes("apple-mobile-web-app-capable") && html.includes("apple-touch-icon") && html.includes("viewport-fit=cover"), "iOS tags");
  return "offline-capable + Add to Home Screen ready";
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
