import React, { useState } from "react";

// Renders one MCQ. Calls onAnswered(chosenIndex) once when the user picks an
// option, then shows the explanation immediately and a Next button.
export default function QuestionCard({ question, index, total, onAnswered, onNext, nextLabel = "Next" }) {
  const [chosen, setChosen] = useState(null);
  const answered = chosen !== null;
  const correct = answered && chosen === question.correct_index;

  function pick(i) {
    if (answered) return;
    setChosen(i);
    onAnswered(i);
  }

  return (
    <div className="card qcard">
      <div className="qmeta">
        <span className="badge">{index + 1} / {total}</span>
        <span className={`badge diff-${question.difficulty}`}>
          {question.difficulty === 1 ? "Foundational" : question.difficulty === 2 ? "Applied" : "Expert"}
        </span>
        {question.source_type === "enhancement" && <span className="badge badge-enh">2026 topic</span>}
      </div>
      <h2 className="qtext">{question.question_text}</h2>
      <div className="options">
        {question.options.map((opt, i) => {
          let cls = "option";
          if (answered) {
            if (i === question.correct_index) cls += " opt-correct";
            else if (i === chosen) cls += " opt-wrong";
            else cls += " opt-dim";
          }
          return (
            <button key={i} className={cls} onClick={() => pick(i)} disabled={answered}>
              <span className="opt-letter">{String.fromCharCode(65 + i)}</span>
              <span className="opt-text">{opt}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={`explain ${correct ? "explain-ok" : "explain-bad"}`}>
          <div className="explain-head">{correct ? "✅ Correct" : "❌ Not quite"}</div>
          <p>{question.explanation}</p>
          <button className="btn btn-primary" onClick={onNext}>{nextLabel}</button>
        </div>
      )}
    </div>
  );
}
