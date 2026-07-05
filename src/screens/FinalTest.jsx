import React, { useEffect, useMemo, useRef, useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { QUESTIONS, CONCEPTS, conceptById } from "../lib/store.js";
import { ASSESSMENT, sampleLevelQuestions, levelPassed, proficiencyPercent } from "../lib/scheduler.js";

// 30-minute final assessment: 3 progressive levels, 10 minutes each.
// L1 recall (pass >=90%), L2 applied (>=85%), L3 expert incl. enhancement (>=80%).
export default function FinalTest({ app }) {
  const [stage, setStage] = useState("intro"); // intro | level | between | report
  const [levelIdx, setLevelIdx] = useState(0);
  const [levelQs, setLevelQs] = useState([]);
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState([]); // booleans for current level
  const [levelResults, setLevelResults] = useState([]); // {level, correct, total, passed, timedOut}
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef(null);
  const answersRef = useRef([]);

  const cfg = ASSESSMENT.levels[levelIdx];

  function startLevel(idx) {
    const c = ASSESSMENT.levels[idx];
    const qs = sampleLevelQuestions(QUESTIONS, c);
    setLevelIdx(idx);
    setLevelQs(qs);
    setQi(0);
    setAnswers([]);
    answersRef.current = [];
    setSecondsLeft(c.minutes * 60);
    setStage("level");
  }

  // countdown
  useEffect(() => {
    if (stage !== "level") return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [stage, levelIdx]);

  // time expiry -> score level (unanswered count as wrong)
  useEffect(() => {
    if (stage === "level" && secondsLeft === 0) finishLevel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, stage]);

  function finishLevel(timedOut = false) {
    clearInterval(timerRef.current);
    const c = ASSESSMENT.levels[levelIdx];
    const got = answersRef.current.filter(Boolean).length;
    const total = c.questions; // unanswered = wrong
    const passed = levelPassed(c, got, total);
    const result = { level: c.level, name: c.name, correct: got, total, passed, timedOut, passPct: c.passPct };
    const nextResults = [...levelResults, result];
    setLevelResults(nextResults);
    if (passed && levelIdx < ASSESSMENT.levels.length - 1) {
      setStage("between");
    } else {
      finishTest(nextResults);
    }
  }

  async function finishTest(results) {
    const flagged = CONCEPTS.filter((c) => {
      const s = app.states[c.id];
      return s && s.introduced && proficiencyPercent(s) < 80;
    }).map((c) => c.id);
    await app.saveSession({
      id: `final-${Date.now()}`,
      type: "final",
      date: app.derived.today,
      levels: results,
      passedAll: results.length === 3 && results.every((r) => r.passed),
      flagged,
    });
    setStage("report");
  }

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  if (stage === "intro") {
    const prior = app.sessions.filter((s) => s.type === "final").sort((a, b) => (a.id < b.id ? 1 : -1));
    return (
      <div className="screen">
        <header className="apphead"><h1>Final Test</h1><span className="subtitle">30-minute assessment</span></header>
        <div className="card">
          <h3>Three progressive levels</h3>
          <table className="leveltable">
            <thead><tr><th>Level</th><th>Focus</th><th>Time</th><th>Pass</th></tr></thead>
            <tbody>
              {ASSESSMENT.levels.map((l) => (
                <tr key={l.level}>
                  <td>{l.level}</td><td>{l.name}</td><td>{l.minutes} min</td><td>{l.passPct}%+</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="csec">
            {ASSESSMENT.levels.map((l) => l.questions).join(" + ")} questions — each level mixes topic questions with 🧩 cross-concept scenarios.
            Each level must be passed to unlock the next. The timer keeps running while you read explanations.
            Unanswered questions count as wrong when time runs out.
          </p>
          {!app.derived.courseComplete && (
            <p className="update-note">You're on lesson {app.derived.currentDay} of 21 — you can take the test now, but it's designed for after the course.</p>
          )}
          <button className="btn btn-primary" onClick={() => { setLevelResults([]); startLevel(0); }}>Start Level 1</button>
        </div>
        {prior.length > 0 && (
          <div className="card">
            <h3>Previous attempts</h3>
            <ul className="concept-list">
              {prior.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <span className="cname">{s.date} — {s.passedAll ? "✅ passed all levels" : `stopped at L${s.levels.length}`}</span>
                  <span className="csec">{s.levels.map((l) => `L${l.level}: ${l.correct}/${l.total}`).join("  ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (stage === "between") {
    const last = levelResults[levelResults.length - 1];
    return (
      <div className="screen">
        <header className="apphead"><h1>Final Test</h1></header>
        <div className="card center-text">
          <h2>Level {last.level} passed ✅</h2>
          <p className="bigscore">{last.correct} / {last.total}</p>
          <p>{Math.round((last.correct / last.total) * 100)}% — needed {last.passPct}%.</p>
          <button className="btn btn-primary" onClick={() => startLevel(levelIdx + 1)}>
            Start Level {ASSESSMENT.levels[levelIdx + 1].level}: {ASSESSMENT.levels[levelIdx + 1].name}
          </button>
        </div>
      </div>
    );
  }

  if (stage === "report") {
    const passedAll = levelResults.length === 3 && levelResults.every((r) => r.passed);
    const introduced = CONCEPTS.map((c) => ({ c, s: app.states[c.id] }))
      .filter((x) => x.s && x.s.introduced)
      .map((x) => ({ ...x, prof: proficiencyPercent(x.s) }))
      .sort((a, b) => a.prof - b.prof);
    const flagged = introduced.filter((x) => x.prof < 80);
    return (
      <div className="screen">
        <header className="apphead"><h1>Final Report</h1></header>
        <div className="card center-text">
          <h2>{passedAll ? "🎓 Assessment passed!" : "Assessment ended"}</h2>
          {levelResults.map((r) => (
            <div key={r.level} className={`level-result ${r.passed ? "lr-pass" : "lr-fail"}`}>
              <span>L{r.level} {r.name}{r.timedOut ? " ⏰" : ""}</span>
              <span>{r.correct}/{r.total} ({Math.round((r.correct / r.total) * 100)}%) — need {r.passPct}% — {r.passed ? "PASS" : "FAIL"}</span>
            </div>
          ))}
          {!passedAll && <p className="csec">Review the flagged concepts below, then retake the test.</p>}
        </div>
        <div className="card">
          <h3>⚠️ Below 80% proficiency ({flagged.length})</h3>
          {flagged.length === 0 ? <p>Nothing flagged — every studied concept is at 80%+ 🎉</p> : (
            <ul className="progress-list">
              {flagged.map(({ c, prof }) => (
                <li key={c.id}>
                  <div className="prow-top"><span className="cname">{c.name}</span><span className="pct pct-low">{prof}%</span></div>
                  <div className="bar bar-thin"><div className="bar-fill" style={{ width: `${prof}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3>Per-concept proficiency</h3>
          <ul className="progress-list">
            {introduced.map(({ c, prof }) => (
              <li key={c.id}>
                <div className="prow-top"><span className="cname">{c.name}</span><span className={`pct ${prof < 80 ? "pct-low" : ""}`}>{prof}%</span></div>
                <div className="bar bar-thin"><div className="bar-fill" style={{ width: `${prof}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="btnrow">
          <button className="btn btn-primary" onClick={() => { setStage("intro"); setLevelResults([]); }}>Done</button>
        </div>
      </div>
    );
  }

  // stage === "level"
  const q = levelQs[qi];
  return (
    <div className="screen">
      <header className="apphead testhead">
        <h1>Level {cfg.level}: {cfg.name}</h1>
        <span className={`timer ${secondsLeft <= 60 ? "timer-low" : ""}`} role="timer">{mmss}</span>
      </header>
      <QuestionCard
        key={q.id}
        question={q}
        index={qi}
        total={levelQs.length}
        onAnswered={async (idx) => {
          const ok = idx === q.correct_index;
          answersRef.current = [...answersRef.current, ok];
          setAnswers(answersRef.current);
          await app.answerQuestion(q, idx, "final");
        }}
        onNext={() => {
          if (qi + 1 >= levelQs.length) finishLevel(false);
          else setQi(qi + 1);
        }}
        nextLabel={qi + 1 >= levelQs.length ? "Finish level" : "Next"}
      />
    </div>
  );
}
