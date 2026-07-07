import React from "react";
import { moduleTitle } from "../lib/store.js";
import { SCENARIO_WEAVE_MIN_PARTS } from "../lib/scheduler.js";

export default function Dashboard({ app, go }) {
  const { derived, settings } = app;
  const { currentPart, unlockedUpToPart, courseComplete, part, due, masteredCount, introducedCount, totalConcepts, totalParts, streak, todayLog, lastScore } = derived;
  const gatePct = Math.round(((unlockedUpToPart - 1) / totalParts) * 100);

  return (
    <div className="screen">
      <header className="apphead">
        <h1>AI Mastery</h1>
        <span className="subtitle">{totalParts}-part course · self-paced · offline</span>
      </header>

      <div className="card hero">
        <div className="hero-row">
          <div>
            <div className="hero-day">Part {courseComplete ? totalParts : currentPart} <span className="hero-of">/ {totalParts}</span></div>
            {!courseComplete && (
              <div className={`phasechip phase-${((part.module - 1) % 3) + 1}`}>Module {part.module} · {moduleTitle(part.module)}</div>
            )}
            {courseComplete && <div className="phasechip phase-3">Course complete 🎓</div>}
          </div>
          <div className="ring" style={{ "--pct": Math.round((masteredCount / totalConcepts) * 100) }}>
            <span>{Math.round((masteredCount / totalConcepts) * 100)}%</span>
            <small>true mastery</small>
          </div>
        </div>
        {/* two separate measures: the unlock gate and SM-2 true mastery */}
        <div className="phasebar">
          <div className="phasebar-label"><span>Course gate — parts passed</span><span>{unlockedUpToPart - 1}/{totalParts}</span></div>
          <div className="bar"><div className="bar-fill" style={{ width: `${gatePct}%` }} /></div>
        </div>
        <div className="statrow">
          <div className="stat"><b>{introducedCount}</b><span>topics seen</span></div>
          <div className="stat"><b>{masteredCount}</b><span>mastered</span></div>
          <div className="stat"><b>{streak}</b><span>day streak</span></div>
        </div>
      </div>

      {!courseComplete && (
        <div className="card">
          <h3>Current part</h3>
          <h2 className="lesson-title">Part {currentPart}: {part.title}</h2>
          <p className="csec">{part.theme}</p>
          <p>
            📖 Tap through {part.topics.length} topic cards, then pass the Day Quiz at {settings.passThreshold}%+ to unlock Part {Math.min(totalParts, currentPart + 1)}.
            {lastScore != null && ` Last attempt: ${lastScore}%.`}
          </p>
          <button className="btn btn-primary btn-block" onClick={() => go("learn")}>
            {lastScore != null && lastScore < settings.passThreshold ? "Retry" : "Start"} Part {currentPart}
          </button>
        </div>
      )}

      <div className="card">
        <h3>Practice</h3>
        {due.length === 0 ? (
          <p>✅ Review queue is clear.</p>
        ) : (
          <p>🔁 {due.length} topic{due.length === 1 ? "" : "s"} due for spaced review{unlockedUpToPart >= SCENARIO_WEAVE_MIN_PARTS ? " — sessions now include 🧩 cross-part scenarios." : "."}</p>
        )}
        <div className="btnrow">
          <button className="btn" onClick={() => go("review")} disabled={due.length === 0}>
            Review ({due.length})
          </button>
          {courseComplete && (
            <button className="btn btn-primary" onClick={() => go("test")}>Final Test</button>
          )}
        </div>
      </div>

      {todayLog.answers > 0 && (
        <div className="card hint">
          <p>Today: {todayLog.answers} answer{todayLog.answers === 1 ? "" : "s"} · {todayLog.lessons} part{todayLog.lessons === 1 ? "" : "s"} passed · {todayLog.reviewsDone} review{todayLog.reviewsDone === 1 ? "" : "s"}</p>
        </div>
      )}
    </div>
  );
}
