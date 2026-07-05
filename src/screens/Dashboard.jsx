import React from "react";
import { CONCEPTS } from "../lib/store.js";

export default function Dashboard({ app, go }) {
  const { derived, meta, settings } = app;
  const { day, due, newList, todayLog, masteredCount, introducedCount, totalConcepts } = derived;
  const phase = day <= 7 ? "Foundational" : day <= 14 ? "Applied" : "Expert & Integration";
  const goalNewTarget = Math.min(settings.newPerDay, todayLog.newDone + newList.length);
  const goalDone = todayLog.goalMet;

  // learning streak = consecutive calendar days (ending today or yesterday) with goalMet
  const streak = (() => {
    const dates = Object.entries(meta.dailyLog).filter(([, v]) => v.goalMet).map(([d]) => d).sort();
    if (!dates.length) return 0;
    let n = 0;
    let cur = new Date();
    for (;;) {
      const s = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (dates.includes(s)) { n++; cur.setDate(cur.getDate() - 1); }
      else if (n === 0 && dates.length) { // allow streak counted from yesterday if today not done yet
        cur.setDate(cur.getDate() - 1);
        const y = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        if (!dates.includes(y)) return 0;
      } else return n;
    }
  })();

  const todaysConcepts = newList.slice(0, settings.newPerDay);

  return (
    <div className="screen">
      <header className="apphead">
        <h1>AI Mastery</h1>
        <span className="subtitle">21-day quiz coach · offline</span>
      </header>

      <div className="card hero">
        <div className="hero-row">
          <div>
            <div className="hero-day">Day {day} <span className="hero-of">/ 21</span></div>
            <div className={`phasechip phase-${day <= 7 ? 1 : day <= 14 ? 2 : 3}`}>{phase}</div>
          </div>
          <div className="ring" style={{ "--pct": Math.round((masteredCount / totalConcepts) * 100) }}>
            <span>{Math.round((masteredCount / totalConcepts) * 100)}%</span>
            <small>mastered</small>
          </div>
        </div>
        <div className="statrow">
          <div className="stat"><b>{introducedCount}</b><span>seen</span></div>
          <div className="stat"><b>{masteredCount}</b><span>mastered</span></div>
          <div className="stat"><b>{streak}</b><span>day streak</span></div>
        </div>
      </div>

      <div className="card">
        <h3>Today's goal</h3>
        <ul className="goal-list">
          <li className={due.length === 0 ? "done" : ""}>
            {due.length === 0 ? "✅" : "🔁"} Clear due reviews
            {due.length > 0 ? ` — ${due.length} waiting` : " — done"}
          </li>
          <li className={todayLog.newDone >= goalNewTarget && goalNewTarget > 0 ? "done" : goalNewTarget === 0 ? "done" : ""}>
            {todayLog.newDone >= goalNewTarget ? "✅" : "📝"} Learn {goalNewTarget} new concept{goalNewTarget === 1 ? "" : "s"} — {todayLog.newDone}/{goalNewTarget}
          </li>
        </ul>
        {goalDone && <p className="goal-done-msg">🎉 Daily goal complete — Day {day > 1 ? day - 1 : day} logged. See you tomorrow!</p>}
        <div className="btnrow">
          <button className="btn btn-primary" onClick={() => go("quiz")} disabled={newList.length === 0}>
            {newList.length === 0 ? "No new concepts left" : "Start Daily Quiz"}
          </button>
          <button className="btn" onClick={() => go("review")} disabled={due.length === 0}>
            Review ({due.length})
          </button>
        </div>
      </div>

      {todaysConcepts.length > 0 && (
        <div className="card">
          <h3>Up next today</h3>
          <ul className="concept-list">
            {todaysConcepts.map((c) => (
              <li key={c.id}>
                <span className="cname">{c.name}</span>
                <span className="csec">{c.sections[0]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {day >= 21 && (
        <div className="card">
          <h3>Course complete?</h3>
          <p>You've reached the end of the 21-day plan. Take the 30-minute final assessment.</p>
          <button className="btn btn-primary" onClick={() => go("test")}>Go to Final Test</button>
        </div>
      )}
    </div>
  );
}
