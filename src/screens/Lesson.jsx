import React, { useState } from "react";
import QuestionCard from "../components/QuestionCard.jsx";
import { CURRICULUM, conceptById, lessonQuestions, partTitle, scenariosByDay } from "../lib/store.js";

// Institute-style lesson flow for the current day:
// Syllabus -> Study (read today's topics) -> Quiz (exactly those topics, in order) -> Done.
export default function Lesson({ app, go }) {
  const { derived } = app;
  const [phase, setPhase] = useState("overview"); // overview | study | quiz | done
  const [qs, setQs] = useState([]);
  const [i, setI] = useState(0);
  const [results, setResults] = useState([]);
  // Snapshot of the day being quizzed — derived.currentDay advances the moment
  // the lesson completes, so labels must not read it mid-session.
  const [activeDay, setActiveDay] = useState(null);

  const day = phase === "quiz" && activeDay ? activeDay : derived.currentDay;
  const lesson = derived.lesson;

  if (derived.courseComplete && phase === "overview") {
    return (
      <div className="screen">
        <header className="apphead"><h1>Course</h1><span className="subtitle">all 21 lessons complete</span></header>
        <div className="card center-text">
          <h2>🎓 Course complete!</h2>
          <p>Keep clearing reviews to reach 100% mastery, then take the Final Test.</p>
          <div className="btnrow">
            <button className="btn btn-primary" onClick={() => go("test")}>Final Test</button>
            <button className="btn" onClick={() => go("review")}>Review ({derived.due.length})</button>
          </div>
        </div>
        <Syllabus completedDays={app.meta.completedDays} currentDay={22} />
      </div>
    );
  }

  if (phase === "study") {
    return (
      <div className="screen">
        <header className="apphead">
          <h1>Day {day} · Study</h1>
          <span className="subtitle">{lesson.title}</span>
        </header>
        <div className="card hint"><p>📖 Read each topic below. The quiz that follows asks about exactly these topics, in this order.</p></div>
        {lesson.concept_ids.map((id, n) => {
          const c = conceptById[id];
          return (
            <div className="card" key={id}>
              <div className="study-head">
                <span className="badge">{n + 1} / {lesson.concept_ids.length}</span>
                <span className="csec">{c.sections.join(" · ")}</span>
              </div>
              <h2 className="study-title">{c.name}</h2>
              <p>{c.summary}</p>
              {c.formula && <code className="formula">{c.formula}</code>}
              {c.update_2026 && <p className="update-note">🆕 {c.update_2026}</p>}
            </div>
          );
        })}
        {(scenariosByDay[day] || []).length > 0 && (
          <div className="card hint"><p>🧩 The quiz ends with {(scenariosByDay[day] || []).length} scenario question{(scenariosByDay[day] || []).length === 1 ? "" : "s"} combining today's topics with earlier material.</p></div>
        )}
        <button
          className="btn btn-primary btn-block"
          onClick={async () => {
            await app.markStudied(day);
            setActiveDay(day);
            setQs(lessonQuestions(day));
            setI(0); setResults([]);
            setPhase("quiz");
          }}
        >
          I've read it — start the quiz ({lessonQuestions(day).length} questions)
        </button>
      </div>
    );
  }

  if (phase === "quiz") {
    if (i >= qs.length) {
      const correct = results.filter(Boolean).length;
      return (
        <div className="screen">
          <header className="apphead"><h1>Day {day} complete</h1></header>
          <div className="card center-text">
            <h2>Lesson finished 🎉</h2>
            <p className="bigscore">{correct} / {qs.length}</p>
            <p>
              {correct === qs.length
                ? "Perfect score! Everything is scheduled for spaced review."
                : "Missed items were re-queued for review today — clear them to lock the learning in."}
            </p>
            <p className="csec">{day < 21 ? `Day ${day + 1} is now unlocked. Continue now or come back later — the course is self-paced.` : "That was the final lesson!"}</p>
            <div className="btnrow">
              {app.derived.due.length > 0 && (
                <button className="btn btn-primary" onClick={() => go("review")}>Review misses ({app.derived.due.length})</button>
              )}
              <button className="btn" onClick={() => { setPhase("overview"); go("home"); }}>Dashboard</button>
            </div>
          </div>
        </div>
      );
    }
    const q = qs[i];
    const isScenario = q.kind === "scenario";
    const concept = conceptById[q.concept_id];
    return (
      <div className="screen">
        <header className="apphead">
          <h1>Day {day} · Quiz</h1>
          <span className="subtitle">{isScenario ? "🧩 cross-concept scenario" : concept.name}</span>
        </header>
        <QuestionCard
          key={q.id}
          question={q}
          index={i}
          total={qs.length}
          onAnswered={async (idx) => {
            const ok = await app.answerQuestion(q, idx, "lesson");
            setResults((r) => [...r, ok]);
          }}
          onNext={async () => {
            if (i + 1 >= qs.length) await app.completeLesson(day);
            setI(i + 1);
          }}
          nextLabel={i + 1 >= qs.length ? "Finish lesson" : "Next"}
        />
      </div>
    );
  }

  // overview: current lesson + full syllabus
  return (
    <div className="screen">
      <header className="apphead"><h1>Learn</h1><span className="subtitle">self-paced · Part {lesson.part}: {partTitle(lesson.part)}</span></header>
      <div className="card">
        <div className="lesson-now">
          <span className="badge">Day {day} / 21</span>
          <span className={`phasechip phase-${Math.min(3, lesson.part)}`}>Part {lesson.part} · {partTitle(lesson.part)}</span>
        </div>
        <h2>{lesson.title}</h2>
        <p className="csec">{lesson.sections.join(" · ")}</p>
        <p>
          {lesson.concept_ids.length} topics to study, then a {lessonQuestions(day).length}-question quiz
          ({(scenariosByDay[day] || []).length > 0 ? `incl. ${(scenariosByDay[day] || []).length} scenario` : "topic questions"}) in the same order.
        </p>
        <button className="btn btn-primary btn-block" onClick={() => setPhase("study")}>
          {derived.lessonStudied ? "Continue Day " + day : "Start Day " + day}
        </button>
      </div>
      <Syllabus completedDays={app.meta.completedDays} currentDay={day} />
    </div>
  );
}

function Syllabus({ completedDays, currentDay }) {
  let lastPart = 0;
  return (
    <div className="card">
      <h3>Syllabus</h3>
      <ul className="syllabus">
        {CURRICULUM.map((d) => {
          const header = d.part !== lastPart ? (lastPart = d.part, true) : false;
          const state = d.day <= completedDays ? "done" : d.day === currentDay ? "current" : "locked";
          return (
            <React.Fragment key={d.day}>
              {header && <li className="syl-part">Part {d.part} — {partTitle(d.part)}</li>}
              <li className={`syl-day syl-${state}`}>
                <span className="syl-icon">{state === "done" ? "✅" : state === "current" ? "▶️" : "🔒"}</span>
                <span className="syl-text">
                  <span className="cname">Day {d.day}: {d.title}</span>
                  <span className="csec">{d.concept_ids.length} topics{(scenariosByDay[d.day] || []).length ? ` + ${(scenariosByDay[d.day] || []).length} scenario` : ""}</span>
                </span>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
}
