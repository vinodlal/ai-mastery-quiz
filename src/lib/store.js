// Central app state hook: loads static data + IndexedDB progress, exposes actions.
// Course model v3: thematic PARTS (one per day, self-paced, NO calendar locking).
// `unlockedUpToPart` lives in IndexedDB (kv meta). Part N+1 unlocks only when
// Part N's Day Quiz scores >= the configurable pass threshold; otherwise the
// user stays on Part N and retries after re-reading Study Mode.
// SM-2 spaced repetition remains the separate "true mastery" measure.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import inventory from "../../concept_inventory.json";
import bank from "../../question_bank.json";
import {
  newConceptState, applyAnswer, dueConcepts, todayStr,
  applyLessonResult, DEFAULT_PASS_THRESHOLD,
} from "./scheduler.js";
import { kvGet, kvSet, getAll, putRecord, addRecord, clearStore, exportAll, importAll } from "./db.js";

export const CONCEPTS = inventory.concepts;
export const PARTS = [...inventory.curriculum].sort((a, b) => a.part - b.part);
export const TOTAL_PARTS = PARTS.length;
export const MODULES = inventory.meta.modules;
export const QUESTIONS = bank.questions;
export const conceptById = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
export const questionsByConcept = QUESTIONS.filter((q) => q.kind === "concept").reduce((m, q) => {
  (m[q.concept_id] ||= []).push(q);
  return m;
}, {});
export const questionById = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
export const partByNumber = Object.fromEntries(PARTS.map((p) => [p.part, p]));
export const moduleTitle = (m) => (MODULES.find((x) => x.module === m) || {}).title || "";

// Day Quiz for a part = its `quiz_questions`, one per topic, SAME order as
// Study Mode. No scenarios, no cross-part content in this quiz.
export function partQuizQuestions(part) {
  const p = partByNumber[part];
  if (!p) return [];
  return p.quiz_questions.map((qid) => questionById[qid]);
}

const DEFAULT_SETTINGS = { passThreshold: DEFAULT_PASS_THRESHOLD };
const DEFAULT_META = { unlockedUpToPart: 1, partScores: {}, studied: {}, dailyLog: {}, startedOn: null };

function normalizeMeta(raw) {
  const m = { ...DEFAULT_META, ...(raw || {}) };
  // migrate v2 (completedDays) installs: treat completed lessons as unlocked parts
  if (raw && raw.completedDays != null && raw.unlockedUpToPart == null) {
    m.unlockedUpToPart = Math.min(TOTAL_PARTS + 1, raw.completedDays + 1);
  }
  m.unlockedUpToPart = Math.max(1, Math.min(TOTAL_PARTS + 1, m.unlockedUpToPart));
  return m;
}

export function useAppState() {
  const [loaded, setLoaded] = useState(false);
  const [states, setStates] = useState({});
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [meta, setMeta] = useState(DEFAULT_META);
  const [sessions, setSessions] = useState([]);
  const today = todayStr();
  const statesLatest = useRef(states);
  statesLatest.current = states;

  useEffect(() => {
    (async () => {
      const [conceptRows, kvSettings, kvMeta, sessionRows] = await Promise.all([
        getAll("concepts"), kvGet("settings"), kvGet("meta"), getAll("sessions"),
      ]);
      setStates(Object.fromEntries(conceptRows.map((r) => [r.conceptId, r])));
      setSettings({ ...DEFAULT_SETTINGS, ...(kvSettings || {}) });
      setMeta(normalizeMeta(kvMeta));
      setSessions(sessionRows);
      setLoaded(true);
    })().catch((e) => { console.error("DB load failed", e); setLoaded(true); });
  }, []);

  const updateSettings = useCallback(async (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      kvSet("settings", next);
      return next;
    });
  }, []);

  // Answer any question. Scenario answers update every linked concept already
  // introduced; concept questions introduce + update their single concept.
  // context: 'lesson' | 'review' | 'final'
  const answerQuestion = useCallback(async (question, chosenIndex, context) => {
    const correct = chosenIndex === question.correct_index;
    const date = todayStr();
    const linked = question.kind === "scenario"
      ? question.concept_ids.filter((id) => {
          const s = statesLatest.current[id];
          return s && s.introduced;
        })
      : [question.concept_id];

    const updates = {};
    for (const id of linked) {
      const prev = statesLatest.current[id] || newConceptState(id);
      updates[id] = applyAnswer(prev, correct, date);
    }
    setStates((s) => ({ ...s, ...updates }));
    for (const st of Object.values(updates)) await putRecord("concepts", st);
    await addRecord("answers", {
      qid: question.id, conceptIds: linked, correct, chosenIndex, date, context,
      kind: question.kind, ts: Date.now(),
    });
    setMeta((m) => {
      const log = { ...(m.dailyLog[date] || { answers: 0, lessons: 0, reviewsDone: 0 }) };
      log.answers += 1;
      if (context === "review") log.reviewsDone += 1;
      const next = { ...m, startedOn: m.startedOn || date, dailyLog: { ...m.dailyLog, [date]: log } };
      kvSet("meta", next);
      return next;
    });
    return correct;
  }, []);

  const markStudied = useCallback(async (part) => {
    setMeta((m) => {
      const next = { ...m, studied: { ...m.studied, [part]: (m.studied[part] || 0) + 1 } };
      kvSet("meta", next);
      return next;
    });
  }, []);

  // Submit a Day Quiz result: unlocks the next part only on a passing score.
  // The UI outcome is computed synchronously — React runs setMeta updaters
  // AFTER this function returns, so the return value must not depend on them.
  const submitQuizResult = useCallback(async (part, correct, total) => {
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const passed = pct >= settings.passThreshold;
    const date = todayStr();
    setMeta((m) => {
      const r = applyLessonResult(m, part, correct, total, settings.passThreshold, TOTAL_PARTS);
      const log = { ...(r.meta.dailyLog[date] || { answers: 0, lessons: 0, reviewsDone: 0 }) };
      if (r.passed) log.lessons += 1;
      const next = { ...r.meta, dailyLog: { ...r.meta.dailyLog, [date]: log } };
      kvSet("meta", next);
      return next;
    });
    return { passed, pct };
  }, [settings.passThreshold]);

  const saveSession = useCallback(async (session) => {
    await putRecord("sessions", session);
    setSessions((s) => [...s.filter((x) => x.id !== session.id), session]);
  }, []);

  const resetProgress = useCallback(async () => {
    await Promise.all([clearStore("concepts"), clearStore("answers"), clearStore("sessions")]);
    await kvSet("meta", DEFAULT_META);
    setStates({}); setMeta(DEFAULT_META); setSessions([]);
  }, []);

  const doExport = useCallback(() => exportAll(), []);
  const doImport = useCallback(async (data) => {
    await importAll(data);
    const [conceptRows, kvSettings, kvMeta, sessionRows] = await Promise.all([
      getAll("concepts"), kvGet("settings"), kvGet("meta"), getAll("sessions"),
    ]);
    setStates(Object.fromEntries(conceptRows.map((r) => [r.conceptId, r])));
    setSettings({ ...DEFAULT_SETTINGS, ...(kvSettings || {}) });
    setMeta(normalizeMeta(kvMeta));
    setSessions(sessionRows);
  }, []);

  const derived = useMemo(() => {
    const due = dueConcepts(states, today);
    const unlocked = meta.unlockedUpToPart;
    const courseComplete = unlocked > TOTAL_PARTS;
    const currentPart = courseComplete ? TOTAL_PARTS : unlocked;
    const part = partByNumber[currentPart];
    const introduced = Object.values(states).filter((s) => s.introduced);
    const mastered = introduced.filter((s) => s.mastered);
    const activeDates = new Set(Object.entries(meta.dailyLog).filter(([, v]) => v.answers > 0).map(([d]) => d));
    let streak = 0;
    let cursor = new Date();
    if (!activeDates.has(todayStr(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (activeDates.has(todayStr(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return {
      today,
      unlockedUpToPart: unlocked,
      currentPart,
      courseComplete,
      part,
      lastScore: meta.partScores[currentPart],
      due,
      todayLog: meta.dailyLog[today] || { answers: 0, lessons: 0, reviewsDone: 0 },
      introducedCount: introduced.length,
      masteredCount: mastered.length,
      totalConcepts: CONCEPTS.length,
      totalParts: TOTAL_PARTS,
      streak,
    };
  }, [states, meta, today]);

  return {
    loaded, states, settings, meta, sessions, derived,
    answerQuestion, markStudied, submitQuizResult, saveSession,
    updateSettings, resetProgress, doExport, doImport,
  };
}
