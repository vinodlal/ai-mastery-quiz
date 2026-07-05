// Central app state hook: loads static data + IndexedDB progress, exposes actions.
// Course model: sequential lessons (day 1..21). Each lesson = Study -> Quiz.
// Completing a lesson unlocks the next — fully self-paced (several per calendar
// day is fine). SM-2 review scheduling stays calendar-based.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import inventory from "../../concept_inventory.json";
import bank from "../../question_bank.json";
import { newConceptState, applyAnswer, dueConcepts, todayStr } from "./scheduler.js";
import { kvGet, kvSet, getAll, putRecord, addRecord, clearStore, exportAll, importAll } from "./db.js";

export const CONCEPTS = inventory.concepts;
export const CURRICULUM = [...inventory.curriculum].sort((a, b) => a.day - b.day);
export const COURSE_PARTS = inventory.meta.course;
export const QUESTIONS = bank.questions;
export const conceptById = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
export const questionsByConcept = QUESTIONS.filter((q) => q.kind === "concept").reduce((m, q) => {
  (m[q.concept_id] ||= []).push(q);
  return m;
}, {});
export const scenariosByDay = QUESTIONS.filter((q) => q.kind === "scenario").reduce((m, q) => {
  (m[q.day_assigned] ||= []).push(q);
  return m;
}, {});
export const dayByNumber = Object.fromEntries(CURRICULUM.map((d) => [d.day, d]));
export const partTitle = (p) => (COURSE_PARTS.find((x) => x.part === p) || {}).title || "";

// Lesson quiz = the day's concept questions in curriculum order, then the day's scenarios.
export function lessonQuestions(day) {
  const d = dayByNumber[day];
  if (!d) return [];
  const conceptQs = d.concept_ids.map((id) => questionsByConcept[id][0]);
  return [...conceptQs, ...(scenariosByDay[day] || [])];
}

const DEFAULT_META = { completedDays: 0, studied: {}, dailyLog: {}, startedOn: null };

export function useAppState() {
  const [loaded, setLoaded] = useState(false);
  const [states, setStates] = useState({});
  const [meta, setMeta] = useState(DEFAULT_META);
  const [sessions, setSessions] = useState([]);
  const today = todayStr();
  const statesLatest = useRef(states);
  statesLatest.current = states;

  useEffect(() => {
    (async () => {
      const [conceptRows, kvMeta, sessionRows] = await Promise.all([
        getAll("concepts"), kvGet("meta"), getAll("sessions"),
      ]);
      setStates(Object.fromEntries(conceptRows.map((r) => [r.conceptId, r])));
      setMeta({ ...DEFAULT_META, ...(kvMeta || {}) });
      setSessions(sessionRows);
      setLoaded(true);
    })().catch((e) => { console.error("DB load failed", e); setLoaded(true); });
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

  const markStudied = useCallback(async (day) => {
    setMeta((m) => {
      if (m.studied[day]) return m;
      const next = { ...m, studied: { ...m.studied, [day]: true } };
      kvSet("meta", next);
      return next;
    });
  }, []);

  // Completing the CURRENT day's lesson quiz unlocks the next day.
  const completeLesson = useCallback(async (day) => {
    const date = todayStr();
    setMeta((m) => {
      if (day !== m.completedDays + 1) return m; // only the current lesson advances
      const log = { ...(m.dailyLog[date] || { answers: 0, lessons: 0, reviewsDone: 0 }) };
      log.lessons += 1;
      const next = {
        ...m,
        completedDays: m.completedDays + 1,
        dailyLog: { ...m.dailyLog, [date]: log },
      };
      kvSet("meta", next);
      return next;
    });
  }, []);

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
    const [conceptRows, kvMeta, sessionRows] = await Promise.all([
      getAll("concepts"), kvGet("meta"), getAll("sessions"),
    ]);
    setStates(Object.fromEntries(conceptRows.map((r) => [r.conceptId, r])));
    setMeta({ ...DEFAULT_META, ...(kvMeta || {}) });
    setSessions(sessionRows);
  }, []);

  const derived = useMemo(() => {
    const due = dueConcepts(states, today);
    const currentDay = Math.min(21, meta.completedDays + 1);
    const courseComplete = meta.completedDays >= 21;
    const lesson = dayByNumber[currentDay];
    const introduced = Object.values(states).filter((s) => s.introduced);
    const mastered = introduced.filter((s) => s.mastered);
    // activity streak: consecutive calendar days (ending today/yesterday) with answers
    const activeDates = new Set(Object.entries(meta.dailyLog).filter(([, v]) => v.answers > 0).map(([d]) => d));
    let streak = 0;
    let cursor = new Date();
    if (!activeDates.has(todayStr(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (activeDates.has(todayStr(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return {
      today,
      currentDay,
      courseComplete,
      lesson,
      lessonStudied: !!meta.studied[currentDay],
      due,
      todayLog: meta.dailyLog[today] || { answers: 0, lessons: 0, reviewsDone: 0 },
      introducedCount: introduced.length,
      masteredCount: mastered.length,
      totalConcepts: CONCEPTS.length,
      streak,
    };
  }, [states, meta, today]);

  return {
    loaded, states, meta, sessions, derived,
    answerQuestion, markStudied, completeLesson, saveSession,
    resetProgress, doExport, doImport,
  };
}
