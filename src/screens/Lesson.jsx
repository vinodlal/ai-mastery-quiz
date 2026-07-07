import React, { useRef, useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { PARTS, conceptById, partQuizQuestions, moduleTitle } from "../lib/store.js";

// Gated lesson flow for the current part:
// Syllabus -> Study Mode (tap through topic cards; "Start Quiz" only after the
// last card) -> Day Quiz (exactly those topics, same order, no scenarios) ->
// pass (>= threshold) unlocks the next part, fail loops back to Study Mode.
export default function Lesson({ app, go }) {
  const { derived, settings } = app;
  const [phase, setPhase] = useState("overview"); // overview | study | quiz | result
  const [cardIdx, setCardIdx] = useState(0);
  const [qs, setQs] = useState([]);
  const [i, setI] = useState(0);
  const [results, setResults] = useState([]);
  // Score is read synchronously from this ref at submit time — React state
  // updates lag behind async persistence, and a fast "Next" tap must not
  // lose points (same pattern as FinalTest's answersRef).
  const resultsRef = useRef([]);
  const [activePart, setActivePart] = useState(null);
  const [outcome, setOutcome] = useState(null);

  const part = phase === "overview" ? derived.part : (activePart || derived.part);

  if (derived.courseComplete && phase === "overview") {
    return (
      <div className="screen">
        <header className="apphead"><h1>Course</h1><span className="subtitle">all {derived.totalParts} parts passed</span></header>
        <div className="card center-text">
          <h2>🎓 Course complete!</h2>
          <p>Every part passed at {settings.passThreshold}%+. Keep clearing reviews for true mastery, then take the Final Test.</p>
          <div className="btnrow">
            <button className="btn btn-primary" onClick={() => go("test")}>Final Test</button>
            <button className="btn" onClick={() => go("review")}>Review ({derived.due.length})</button>
          </div>
        </div>
        <Syllabus app={app} />
      </div>
    );
  }

  if (phase === "study") {
    const topicId = part.topics[cardIdx];
    const c = conceptById[topicId];
    const isLast = cardIdx === part.topics.length - 1;
    return (
      <div className="screen">
        <header className="apphead">
          <h1>Part {part.part} · Study</h1>
          <span className="subtitle">{part.title}</span>
        </header>
        <div className="card">
          <div className="study-head">
            <span className="badge">Topic {cardIdx + 1} / {part.topics.length}</span>
            <span className="csec">{c.sections.join(" · ")}</span>
          </div>
          <h2 className="study-title">{c.name}</h2>
          <p>{c.summary}</p>
          {c.formula && <code className="formula">{c.formula}</code>}
          {c.update_2026 && <p className="update-note">🆕 {c.update_2026}</p>}
        </div>
        <div className="study-progress">
          {part.topics.map((_, n) => <span key={n} className={`dot ${n < cardIdx ? "dot-done" : n === cardIdx ? "dot-now" : ""}`} />)}
        </div>
        <div className="btnrow">
          {cardIdx > 0 && <button className="btn" onClick={() => setCardIdx(cardIdx - 1)}>Back</button>}
          {!isLast && <button className="btn btn-primary" onClick={() => setCardIdx(cardIdx + 1)}>Next topic</button>}
          {isLast && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                await app.markStudied(part.part);
                setQs(partQuizQuestions(part.part));
                setI(0); setResults([]);
                resultsRef.current = [];
                setPhase("quiz");
              }}
            >
              Start Quiz ({part.topics.length} questions)
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "quiz") {
    const q = qs[i];
    const concept = conceptById[q.concept_id];
    return (
      <div className="screen">
        <header className="apphead">
          <h1>Part {part.part} · Day Quiz</h1>
          <span className="subtitle">{concept.name}</span>
        </header>
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          total={qs.length}
          onAnswered={async (idx) => {
            const ok = idx === q.correct_index; // known synchronously
            resultsRef.current = [...resultsRef.current, ok];
            setResults(resultsRef.current);
            await app.answerQuestion(q, idx, "lesson");
          }}
          onNext={async () => {
            if (i + 1 >= qs.length) {
              const correct = resultsRef.current.filter(Boolean).length;
              const res = await app.submitQuizResult(part.part, correct, qs.length);
              setOutcome(res);
              setPhase("result");
            } else {
              setI(i + 1);
            }
          }}
          nextLabel={i + 1 >= qs.length ? "Finish quiz" : "Next"}
        />
      </div>
    );
  }

  if (phase === "result") {
    const correct = results.filter(Boolean).length;
    const passed = outcome && outcome.passed;
    return (
      <div className="screen">
        <header className="apphead"><h1>Part {part.part} result</h1></header>
        <div className="card center-text">
          <h2>{passed ? "✅ Part passed!" : "❌ Not yet"}</h2>
          <p className="bigscore">{outcome ? outcome.pct : 0}%</p>
          <p>{correct} / {results.length} correct — pass mark {settings.passThreshold}%.</p>
          {passed ? (
            <p className="csec">
              {part.part < derived.totalParts
                ? `Part ${part.part + 1} is unlocked. Missed topics were queued for spaced review.`
                : "That was the final part — the whole course is unlocked!"}
            </p>
          ) : (
            <p className="csec">Re-read the study cards and retry — the gate stays at Part {part.part} until you score {settings.passThreshold}%+. Missed topics are also in the review queue.</p>
          )}
          <div className="btnrow">
            {!passed && (
              <button className="btn btn-primary" onClick={() => { setCardIdx(0); setPhase("study"); }}>
                Review Study Mode again
              </button>
            )}
            {passed && app.derived.due.length > 0 && (
              <button className="btn btn-primary" onClick={() => go("review")}>Review misses ({app.derived.due.length})</button>
            )}
            <button className="btn" onClick={() => { setPhase("overview"); setActivePart(null); go("home"); }}>Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  // overview
  const attempts = app.meta.studied[part.part] || 0;
  const lastScore = app.meta.partScores[part.part];
  return (
    <div className="screen">
      <header className="apphead"><h1>Learn</h1><span className="subtitle">self-paced · pass {settings.passThreshold}% to unlock the next part</span></header>
      <div className="card">
        <div className="lesson-now">
          <span className="badge">Part {part.part} / {derived.totalParts}</span>
          <span className={`phasechip phase-${((part.module - 1) % 3) + 1}`}>Module {part.module} · {moduleTitle(part.module)}</span>
        </div>
        <h2>{part.title}</h2>
        <p className="csec">{part.theme}</p>
        <p>
          📖 {part.topics.length} topic cards, then a {part.topics.length}-question Day Quiz on exactly those topics, in the same order.
          {lastScore != null && !derived.courseComplete && ` Last attempt: ${lastScore}%.`}
        </p>
        <button className="btn btn-primary btn-block" onClick={() => { setActivePart(part); setCardIdx(0); setPhase("study"); }}>
          {attempts > 0 ? "Retry" : "Start"} Part {part.part}
        </button>
      </div>
      <Syllabus app={app} />
    </div>
  );
}

function Syllabus({ app }) {
  const unlocked = app.meta.unlockedUpToPart;
  let lastModule = 0;
  return (
    <div className="card">
      <h3>Course outline</h3>
      <ul className="syllabus">
        {PARTS.map((p) => {
          const header = p.module !== lastModule ? (lastModule = p.module, true) : false;
          const state = p.part < unlocked ? "done" : p.part === unlocked ? "current" : "locked";
          const score = app.meta.partScores[p.part];
          return (
            <React.Fragment key={p.part}>
              {header && <li className="syl-part">Module {p.module} — {moduleTitle(p.module)}</li>}
              <li className={`syl-day syl-${state}`}>
                <span className="syl-icon">{state === "done" ? "✅" : state === "current" ? "▶️" : "🔒"}</span>
                <span className="syl-text">
                  <span className="cname">Part {p.part}: {p.title}</span>
                  <span className="csec">{p.topics.length} topics{score != null ? ` · ${state === "done" ? "passed" : "last"} ${score}%` : ""}</span>
                </span>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
}
