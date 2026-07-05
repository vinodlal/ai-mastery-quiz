import React from "react";
import { partTitle, scenariosByDay, lessonQuestions } from "../lib/store.js";

export default function Dashboard({ app, go }) {
  const { derived } = app;
  const { currentDay, courseComplete, lesson, due, masteredCount, introducedCount, totalConcepts, streak, todayLog } = derived;

  return (
    <div className="screen">
      <header className="apphead">
        <h1>AI Mastery</h1>
        <span className="subtitle">21-lesson course · self-paced · offline</span>
      </header>

      <div className="card hero">
        <div className="hero-row">
          <div>
            <div className="hero-day">Day {courseComplete ? 21 : currentDay} <span className="hero-of">/ 21</span></div>
            {!courseComplete && (
              <div className={`phasechip phase-${Math.min(3, lesson.part)}`}>Part {lesson.part} · {partTitle(lesson.part)}</div>
            )}
            {courseComplete && <div className="phasechip phase-3">Course complete 🎓</div>}
          </div>
          <div className="ring" style={{ "--pct": Math.round((masteredCount / totalConcepts) * 100) }}>
            <span>{Math.round((masteredCount / totalConcepts) * 100)}%</span>
            <small>mastered</small>
          </div>
        </div>
        <div className="statrow">
          <div className="stat"><b>{introducedCount}</b><span>topics seen</span></div>
          <div className="stat"><b>{masteredCount}</b><span>mastered</span></div>
          <div className="stat"><b>{streak}</b><span>day streak</span></div>
        </div>
      </div>

      {!courseComplete && (
        <div className="card">
          <h3>Current lesson</h3>
          <h2 className="lesson-title">Day {currentDay}: {lesson.title}</h2>
          <p className="csec">{lesson.sections.join(" · ")}</p>
          <p>
            📖 Study {lesson.concept_ids.length} topics, then a {lessonQuestions(currentDay).length}-question quiz
            {(scenariosByDay[currentDay] || []).length > 0 ? ` ending with ${(scenariosByDay[currentDay] || []).length} cross-concept scenario${(scenariosByDay[currentDay] || []).length === 1 ? "" : "s"}` : ""}.
            Finish it to unlock Day {Math.min(21, currentDay + 1)}.
          </p>
          <button className="btn btn-primary btn-block" onClick={() => go("learn")}>
            {derived.lessonStudied ? "Continue" : "Start"} Day {currentDay}
          </button>
        </div>
      )}

      <div className="card">
        <h3>Reviews</h3>
        {due.length === 0 ? (
          <p>✅ Review queue is clear. Correct answers return in growing intervals; misses come back the same day.</p>
        ) : (
          <p>🔁 {due.length} topic{due.length === 1 ? "" : "s"} due — clearing them keeps the spaced-repetition schedule honest.</p>
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
          <p>Today: {todayLog.answers} answer{todayLog.answers === 1 ? "" : "s"} · {todayLog.lessons} lesson{todayLog.lessons === 1 ? "" : "s"} completed · {todayLog.reviewsDone} review{todayLog.reviewsDone === 1 ? "" : "s"}</p>
        </div>
      )}
    </div>
  );
}
