import React, { useMemo, useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { questionsByConcept, conceptById } from "../lib/store.js";

// Daily Quiz: introduces today's N new concepts, one question each.
export default function DailyQuiz({ app, go }) {
  const { derived, settings } = app;
  // Snapshot today's new-concept queue when the session starts.
  const [session, setSession] = useState(null);
  const [i, setI] = useState(0);
  const [results, setResults] = useState([]);

  const available = derived.newList.slice(0, Math.max(0, settings.newPerDay - derived.todayLog.newDone));

  const start = () => {
    const qs = available.map((c) => questionsByConcept[c.id][0]);
    setSession(qs);
    setI(0);
    setResults([]);
  };

  if (!session) {
    return (
      <div className="screen">
        <header className="apphead"><h1>Daily Quiz</h1><span className="subtitle">new concepts for today</span></header>
        <div className="card">
          {available.length === 0 ? (
            <>
              <h3>All done for today 🎉</h3>
              <p>
                {derived.todayLog.newDone > 0
                  ? `You already learned ${derived.todayLog.newDone} new concept${derived.todayLog.newDone === 1 ? "" : "s"} today.`
                  : "No new concepts remaining in the course."}
                {derived.due.length > 0 && " There are reviews waiting, though."}
              </p>
              {derived.due.length > 0 && (
                <button className="btn btn-primary" onClick={() => go("review")}>Go to Review ({derived.due.length})</button>
              )}
            </>
          ) : (
            <>
              <h3>{available.length} new concept{available.length === 1 ? "" : "s"} today</h3>
              <ul className="concept-list">
                {available.map((c) => (
                  <li key={c.id}><span className="cname">{c.name}</span><span className="csec">{c.sections[0]}</span></li>
                ))}
              </ul>
              <button className="btn btn-primary" onClick={start}>Begin</button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (i >= session.length) {
    const correct = results.filter(Boolean).length;
    return (
      <div className="screen">
        <header className="apphead"><h1>Daily Quiz</h1></header>
        <div className="card center-text">
          <h2>Session complete</h2>
          <p className="bigscore">{correct} / {session.length}</p>
          <p>
            {correct === session.length
              ? "Perfect! These concepts are scheduled for review."
              : "Missed concepts were re-queued for review today — clear them to finish your daily goal."}
          </p>
          <div className="btnrow">
            <button className="btn btn-primary" onClick={() => go("home")}>Dashboard</button>
            {app.derived.due.length > 0 && (
              <button className="btn" onClick={() => go("review")}>Review now ({app.derived.due.length})</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const q = session[i];
  const concept = conceptById[q.concept_id];

  return (
    <div className="screen">
      <header className="apphead"><h1>Daily Quiz</h1><span className="subtitle">{concept.name}</span></header>
      <div className="card concept-intro">
        <div className="csec">{concept.sections.join(" · ")}</div>
        <p>{concept.summary}</p>
        {concept.formula && <code className="formula">{concept.formula}</code>}
        {concept.update_2026 && <p className="update-note">🆕 {concept.update_2026}</p>}
      </div>
      <QuestionCard
        key={q.id}
        question={q}
        index={i}
        total={session.length}
        onAnswered={async (idx) => {
          const ok = await app.answerQuestion(q, idx, "daily");
          setResults((r) => [...r, ok]);
        }}
        onNext={async () => {
          if (i + 1 >= session.length) await app.checkDailyGoal();
          setI(i + 1);
        }}
        nextLabel={i + 1 >= session.length ? "Finish" : "Next"}
      />
    </div>
  );
}
