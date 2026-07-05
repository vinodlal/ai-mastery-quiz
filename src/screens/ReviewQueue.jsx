import React, { useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { questionsByConcept, conceptById, QUESTIONS } from "../lib/store.js";
import { masteryPercent, pickReviewQuestion } from "../lib/scheduler.js";

// Review Queue: quizzes every due concept. Practice alternates between the
// concept's base question and unlocked cross-concept scenarios that include it.
// Wrong answers go to the back of the queue (SM-2 re-queues them the same day).
export default function ReviewQueue({ app, go }) {
  const [queue, setQueue] = useState(null); // array of concept ids
  const [count, setCount] = useState(0);
  const [qKey, setQKey] = useState(0);
  const [lastCorrect, setLastCorrect] = useState(null);

  const due = app.derived.due;

  if (!queue) {
    return (
      <div className="screen">
        <header className="apphead"><h1>Review Queue</h1><span className="subtitle">spaced repetition</span></header>
        <div className="card">
          {due.length === 0 ? (
            <>
              <h3>Queue clear ✅</h3>
              <p>No reviews due right now. Correct answers push topics further into the future; wrong answers bring them back the same day. Repeat topics sometimes appear as cross-concept scenarios.</p>
              <button className="btn btn-primary" onClick={() => go("home")}>Dashboard</button>
            </>
          ) : (
            <>
              <h3>{due.length} topic{due.length === 1 ? "" : "s"} due</h3>
              <ul className="concept-list">
                {due.slice(0, 8).map((s) => {
                  const c = conceptById[s.conceptId];
                  return (
                    <li key={s.conceptId}>
                      <span className="cname">{c.name}</span>
                      <span className="csec">mastery {masteryPercent(s)}%</span>
                    </li>
                  );
                })}
                {due.length > 8 && <li><span className="csec">…and {due.length - 8} more</span></li>}
              </ul>
              <button className="btn btn-primary" onClick={() => { setQueue(due.map((s) => s.conceptId)); setCount(0); }}>
                Start Review
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="screen">
        <header className="apphead"><h1>Review Queue</h1></header>
        <div className="card center-text">
          <h2>Reviews cleared 🎉</h2>
          <p>{count} answer{count === 1 ? "" : "s"} this session. Everything is rescheduled.</p>
          <button className="btn btn-primary" onClick={() => go("home")}>Dashboard</button>
        </div>
      </div>
    );
  }

  const conceptId = queue[0];
  const state = app.states[conceptId];
  const q = pickReviewQuestion(conceptId, state, questionsByConcept, QUESTIONS, app.derived.currentDay);
  const concept = conceptById[conceptId];
  const isScenario = q.kind === "scenario";

  return (
    <div className="screen">
      <header className="apphead">
        <h1>Review</h1>
        <span className="subtitle">{queue.length} left · {isScenario ? `🧩 scenario (${concept.name})` : concept.name}</span>
      </header>
      <QuestionCard
        key={`${conceptId}-${qKey}`}
        question={q}
        index={count}
        total={count + queue.length}
        onAnswered={async (idx) => {
          const ok = await app.answerQuestion(q, idx, "review");
          setLastCorrect(ok);
        }}
        onNext={() => {
          setCount((c) => c + 1);
          setQueue((qu) => {
            const rest = qu.slice(1);
            return lastCorrect ? rest : [...rest, conceptId];
          });
          setQKey((k) => k + 1);
          setLastCorrect(null);
        }}
        nextLabel="Next"
      />
      <div className="card hint">
        <p>💡 Wrong answers return to the end of today's queue. Mastery = 3 correct answers on 3 different days.</p>
      </div>
    </div>
  );
}
