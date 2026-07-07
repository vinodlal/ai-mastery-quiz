import React, { useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { questionsByConcept, conceptById, QUESTIONS } from "../lib/store.js";
import { masteryPercent, pickSessionScenarios, SCENARIO_WEAVE_MIN_PARTS } from "../lib/scheduler.js";

// Review Queue: quizzes every due concept with its base question. Once 3+
// parts are unlocked, 1-2 eligible cross-part scenarios (min_part_required
// already studied) are woven into each session. Wrong concept answers go to
// the back of the queue; scenarios appear once per session.
export default function ReviewQueue({ app, go }) {
  const [queue, setQueue] = useState(null); // items: {type:'concept', id} | {type:'scenario', q}
  const [count, setCount] = useState(0);
  const [qKey, setQKey] = useState(0);
  const [lastCorrect, setLastCorrect] = useState(null);

  const due = app.derived.due;
  const unlocked = app.meta.unlockedUpToPart;

  if (!queue) {
    const woven = pickSessionScenarios(QUESTIONS, unlocked).length;
    return (
      <div className="screen">
        <header className="apphead"><h1>Review Queue</h1><span className="subtitle">spaced repetition</span></header>
        <div className="card">
          {due.length === 0 ? (
            <>
              <h3>Queue clear ✅</h3>
              <p>No reviews due right now. Correct answers push topics further into the future; wrong answers bring them back the same day.</p>
              {unlocked < SCENARIO_WEAVE_MIN_PARTS && (
                <p className="csec">🧩 Cross-part scenario questions join your practice once you've unlocked {SCENARIO_WEAVE_MIN_PARTS}+ parts.</p>
              )}
              <button className="btn btn-primary" onClick={() => go("home")}>Dashboard</button>
            </>
          ) : (
            <>
              <h3>{due.length} topic{due.length === 1 ? "" : "s"} due{woven > 0 ? ` + ${woven} scenario${woven === 1 ? "" : "s"}` : ""}</h3>
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
              <button
                className="btn btn-primary"
                onClick={() => {
                  const conceptItems = due.map((s) => ({ type: "concept", id: s.conceptId }));
                  const scenarioItems = pickSessionScenarios(QUESTIONS, unlocked).map((q) => ({ type: "scenario", q }));
                  // weave: one scenario mid-session, one at the end
                  const mid = Math.ceil(conceptItems.length / 2);
                  const woven2 = [...conceptItems.slice(0, mid), ...(scenarioItems[0] ? [scenarioItems[0]] : []),
                                  ...conceptItems.slice(mid), ...(scenarioItems[1] ? [scenarioItems[1]] : [])];
                  setQueue(woven2);
                  setCount(0);
                }}
              >
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

  const item = queue[0];
  const isScenario = item.type === "scenario";
  const q = isScenario ? item.q : questionsByConcept[item.id][0];
  const concept = conceptById[q.concept_id];

  return (
    <div className="screen">
      <header className="apphead">
        <h1>Review</h1>
        <span className="subtitle">{queue.length} left · {isScenario ? "🧩 cross-part scenario" : concept.name}</span>
      </header>
      <QuestionCard
        key={`${isScenario ? q.id : item.id}-${qKey}`}
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
            // wrong CONCEPT answers re-queue; scenarios run once per session
            return lastCorrect || isScenario ? rest : [...rest, item];
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
