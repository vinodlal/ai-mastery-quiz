// Simplified SM-2 spaced repetition + mastery tracking.
// Pure functions — no browser APIs — so the same module runs in the app and
// in the Node self-test suite (scripts/validate.mjs).

export const DEFAULT_NEW_PER_DAY = 5;
export const MASTERY_STREAK = 3; // consecutive correct answers on DIFFERENT days

export function todayStr(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayStr(dt);
}

export function newConceptState(conceptId) {
  return {
    conceptId,
    introduced: false,
    introducedOn: null,
    ef: 2.5,          // easiness factor
    interval: 0,       // days
    reps: 0,           // consecutive correct count (any day)
    due: null,         // date string when review is due
    streakDates: [],   // distinct dates of the current consecutive-correct run
    mastered: false,
    masteredOn: null,
    attempts: 0,
    corrects: 0,
    lastAnswered: null,
  };
}

// Apply an answer to a concept's scheduler state. Returns a NEW state object.
// correct: boolean; date: 'YYYY-MM-DD' of the answer.
export function applyAnswer(state, correct, date) {
  const s = { ...state, streakDates: [...state.streakDates] };
  s.attempts += 1;
  s.lastAnswered = date;
  if (!s.introduced) { s.introduced = true; s.introducedOn = date; }

  if (correct) {
    s.corrects += 1;
    // SM-2 quality 5 for correct
    s.ef = Math.max(1.3, s.ef + 0.1 - (5 - 5) * (0.08 + (5 - 5) * 0.02));
    s.reps += 1;
    if (s.reps === 1) s.interval = 1;
    else if (s.reps === 2) s.interval = 3;
    else s.interval = Math.round(s.interval * s.ef);
    s.due = addDays(date, s.interval);
    // mastery streak: only count distinct days
    if (!s.streakDates.includes(date)) s.streakDates.push(date);
    if (!s.mastered && s.streakDates.length >= MASTERY_STREAK) {
      s.mastered = true;
      s.masteredOn = date;
    }
  } else {
    // SM-2 quality 2 for wrong: EF drops, repetition resets, re-queue sooner
    s.ef = Math.max(1.3, s.ef + 0.1 - (5 - 2) * (0.08 + (5 - 2) * 0.02));
    s.reps = 0;
    s.interval = 0;
    s.due = date; // re-queued the SAME day — wrong answers come back sooner
    s.streakDates = []; // mastery streak broken (mastered flag is kept once earned)
  }
  return s;
}

// Mastery progress 0..100 for a concept.
export function masteryPercent(state) {
  if (!state || !state.introduced) return 0;
  if (state.mastered) return 100;
  return Math.round((state.streakDates.length / MASTERY_STREAK) * 100);
}

// Concepts due for review on `date` (introduced, due <= date, not answered-correct-today-and-rescheduled).
export function dueConcepts(states, date) {
  return Object.values(states).filter(
    (s) => s.introduced && s.due && s.due <= date
  );
}

// Next N new (never-introduced) concepts in curriculum order.
export function nextNewConcepts(concepts, states, n) {
  const ordered = [...concepts].sort(
    (a, b) => a.day_assigned - b.day_assigned || a.id.localeCompare(b.id)
  );
  return ordered.filter((c) => !states[c.id] || !states[c.id].introduced).slice(0, n);
}

// Course day = number of days on which the daily goal was completed, +1 (cap 21).
export function courseDay(completedDays) {
  return Math.min(21, (completedDays || 0) + 1);
}

// ---- Final assessment ----
export const ASSESSMENT = {
  totalMinutes: 30,
  levels: [
    { level: 1, name: "Recall", difficulty: 1, minutes: 10, questions: 12, passPct: 90 },
    { level: 2, name: "Applied", difficulty: 2, minutes: 10, questions: 12, passPct: 85 },
    { level: 3, name: "Expert & Integration", difficulty: 3, minutes: 10, questions: 12, passPct: 80 },
  ],
};

// Deterministic-ish sample without replacement.
export function sampleQuestions(questions, difficulty, n, rand = Math.random) {
  const pool = questions.filter((q) => q.difficulty === difficulty);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

export function levelPassed(levelCfg, correct, total) {
  if (total === 0) return false;
  return (correct / total) * 100 >= levelCfg.passPct;
}

// Per-concept proficiency for the final report: correct/attempts across all history,
// blended with mastery state. Returns 0..100.
export function proficiencyPercent(state) {
  if (!state || state.attempts === 0) return 0;
  const acc = (state.corrects / state.attempts) * 100;
  const mastery = masteryPercent(state);
  return Math.round(0.6 * acc + 0.4 * mastery);
}
