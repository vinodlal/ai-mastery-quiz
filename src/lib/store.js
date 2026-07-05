// Central app state hook: loads static data + IndexedDB progress, exposes actions.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import inventory from "../../concept_inventory.json";
import bank from "../../question_bank.json";
import {
  newConceptState, applyAnswer, dueConcepts, nextNewConcepts,
  todayStr, courseDay, DEFAULT_NEW_PER_DAY,
} from "./scheduler.js";
import { kvGet, kvSet, getAll, putRecord, addRecord, clearStore, exportAll, importAll } from "./db.js";

export const CONCEPTS = inventory.concepts;
export const QUESTIONS = bank.questions;
export const conceptById = Object.fromEntries(CONCEPTS.map((c) => [c.id, c]));
export const questionsByConcept = QUESTIONS.reduce((m, q) => {
  (m[q.concept_id] ||= []).push(q);
  return m;
}, {});

const DEFAULT_SETTINGS = { newPerDay: DEFAULT_NEW_PER_DAY };
const DEFAULT_META = { completedDays: 0, dailyLog: {}, startedOn: null };

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
      setMeta({ ...DEFAULT_META, ...(kvMeta || {}) });
      setSessions(sessionRows);
      setLoaded(true);
    })().catch((e) => { console.error("DB load failed", e); setLoaded(true); });
  }, []);

  const persistMeta = useCallback(async (next) => {
    setMeta(next);
    await kvSet("meta", next);
  }, []);

  const updateSettings = useCallback(async (patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      kvSet("settings", next);
      return next;
    });
  }, []);

  // Answer a question. context: 'daily' | 'review' | 'final'
  const answerQuestion = useCallback(async (question, chosenIndex, context) => {
    const correct = chosenIndex === question.correct_index;
    const date = todayStr();
    const prev = states[question.concept_id] || newConceptState(question.concept_id);
    const isNewIntro = !prev.introduced;
    const next = applyAnswer(prev, correct, date);
    setStates((s) => ({ ...s, [question.concept_id]: next }));
    await putRecord("concepts", next);
    await addRecord("answers", {
      qid: question.id, conceptId: question.concept_id, correct,
      chosenIndex, date, context, ts: Date.now(),
    });

    // update daily log
    setMeta((m) => {
      const log = { ...(m.dailyLog[date] || { newDone: 0, reviewsDone: 0, goalMet: false, dayNumber: courseDay(m.completedDays) }) };
      if (context === "daily" && isNewIntro) log.newDone += 1;
      if (context === "review") log.reviewsDone += 1;
      const next2 = {
        ...m,
        startedOn: m.startedOn || date,
        dailyLog: { ...m.dailyLog, [date]: log },
      };
      kvSet("meta", next2);
      return next2;
    });
    return correct;
  }, [states]);

  // Called after quiz/review sessions to check + record daily-goal completion.
  const checkDailyGoal = useCallback(async () => {
    const date = todayStr();
    let result = false;
    setMeta((m) => {
      const log = m.dailyLog[date];
      if (!log || log.goalMet) { result = !!(log && log.goalMet); return m; }
      const due = dueConcepts(statesLatest.current, date).length;
      const newTarget = Math.min(
        settings.newPerDay,
        nextNewConcepts(CONCEPTS, statesLatest.current, settings.newPerDay).length + log.newDone
      );
      const goalMet = due === 0 && log.newDone >= newTarget;
      if (!goalMet) return m;
      result = true;
      const next = {
        ...m,
        completedDays: m.completedDays + 1,
        dailyLog: { ...m.dailyLog, [date]: { ...log, goalMet: true } },
      };
      kvSet("meta", next);
      return next;
    });
    return result;
  }, [settings.newPerDay]);

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
    setMeta({ ...DEFAULT_META, ...(kvMeta || {}) });
    setSessions(sessionRows);
  }, []);

  const derived = useMemo(() => {
    const due = dueConcepts(states, today);
    const todayLog = meta.dailyLog[today] || { newDone: 0, reviewsDone: 0, goalMet: false };
    const newRemaining = Math.max(0, settings.newPerDay - todayLog.newDone);
    const newList = nextNewConcepts(CONCEPTS, states, newRemaining);
    const introduced = Object.values(states).filter((s) => s.introduced);
    const mastered = introduced.filter((s) => s.mastered);
    return {
      today,
      day: courseDay(meta.completedDays),
      due,
      newList,
      todayLog,
      introducedCount: introduced.length,
      masteredCount: mastered.length,
      totalConcepts: CONCEPTS.length,
    };
  }, [states, meta, settings.newPerDay, today]);

  return {
    loaded, states, settings, meta, sessions, derived,
    answerQuestion, checkDailyGoal, saveSession, updateSettings,
    resetProgress, doExport, doImport,
  };
}
