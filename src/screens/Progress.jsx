import React, { useMemo, useState } from "react";
import { CONCEPTS, PARTS } from "../lib/store.js";
import { masteryPercent, proficiencyPercent } from "../lib/scheduler.js";

export default function Progress({ app }) {
  const { states, derived, settings } = app;
  const unlocked = app.meta.unlockedUpToPart;
  const [filter, setFilter] = useState("all"); // all | weak | mastered | enhancement
  const [expanded, setExpanded] = useState(null);

  const rows = useMemo(() => {
    return CONCEPTS.map((c) => {
      const s = states[c.id];
      return {
        concept: c,
        state: s,
        mastery: masteryPercent(s),
        proficiency: proficiencyPercent(s),
        introduced: !!(s && s.introduced),
      };
    });
  }, [states]);

  const phaseStats = [1, 2, 3].map((p) => {
    const grp = rows.filter((r) => r.concept.phase === p);
    const mastered = grp.filter((r) => r.state && r.state.mastered).length;
    return { phase: p, total: grp.length, mastered };
  });

  const attempts = rows.reduce((n, r) => n + (r.state ? r.state.attempts : 0), 0);
  const corrects = rows.reduce((n, r) => n + (r.state ? r.state.corrects : 0), 0);
  const accuracy = attempts ? Math.round((corrects / attempts) * 100) : 0;

  const visible = rows.filter((r) => {
    if (filter === "weak") return r.introduced && r.proficiency < 80;
    if (filter === "mastered") return r.state && r.state.mastered;
    if (filter === "enhancement") return r.concept.source_type === "enhancement";
    return true;
  });

  const phaseNames = { 1: "Foundational questions", 2: "Applied questions", 3: "Expert questions" };

  return (
    <div className="screen">
      <header className="apphead"><h1>Progress</h1><span className="subtitle">gate + true mastery</span></header>

      {/* Course gate (pass/fail unlocking) — separate from SM-2 true mastery below */}
      <div className="card">
        <h3>Course gate</h3>
        <div className="phasebar">
          <div className="phasebar-label"><span>Parts passed at {settings.passThreshold}%+</span><span>{unlocked - 1}/{PARTS.length}</span></div>
          <div className="bar"><div className="bar-fill" style={{ width: `${((unlocked - 1) / PARTS.length) * 100}%` }} /></div>
        </div>
        {Object.keys(app.meta.partScores || {}).length > 0 && (
          <ul className="concept-list">
            {PARTS.filter((p) => app.meta.partScores[p.part] != null).slice(-6).map((p) => (
              <li key={p.part}>
                <span className="cname">Part {p.part}: {p.title}</span>
                <span className="csec">{p.part < unlocked ? "✅ passed" : "❌ last attempt"} · {app.meta.partScores[p.part]}%</span>
              </li>
            ))}
          </ul>
        )}
        <p className="csec">The gate controls unlocking only. True mastery below comes from spaced repetition: 3 correct answers on 3 different days per topic.</p>
      </div>

      <div className="card">
        <h3>True mastery (spaced repetition)</h3>
        <div className="statrow">
          <div className="stat"><b>{derived.masteredCount}</b><span>mastered</span></div>
          <div className="stat"><b>{derived.introducedCount}/{derived.totalConcepts}</b><span>seen</span></div>
          <div className="stat"><b>{accuracy}%</b><span>accuracy</span></div>
        </div>
        {phaseStats.map((p) => (
          <div className="phasebar" key={p.phase}>
            <div className="phasebar-label">
              <span>{phaseNames[p.phase]}</span><span>{p.mastered}/{p.total}</span>
            </div>
            <div className="bar"><div className={`bar-fill phase-fill-${p.phase}`} style={{ width: `${p.total ? (p.mastered / p.total) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="filterrow">
        {[["all", "All"], ["weak", "< 80%"], ["mastered", "Mastered"], ["enhancement", "2026"]].map(([id, label]) => (
          <button key={id} className={`chip ${filter === id ? "chip-active" : ""}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div className="card">
        {visible.length === 0 && <p className="csec">Nothing here yet.</p>}
        <ul className="progress-list">
          {visible.map((r) => (
            <li key={r.concept.id}>
              <button className="prow" onClick={() => setExpanded(expanded === r.concept.id ? null : r.concept.id)}>
                <div className="prow-top">
                  <span className="cname">
                    {r.state && r.state.mastered ? "🏅 " : ""}{r.concept.name}
                  </span>
                  <span className={`pct ${r.introduced && r.proficiency < 80 ? "pct-low" : ""}`}>
                    {r.introduced ? `${r.mastery}%` : "—"}
                  </span>
                </div>
                <div className="bar bar-thin"><div className="bar-fill" style={{ width: `${r.mastery}%` }} /></div>
              </button>
              {expanded === r.concept.id && (
                <div className="pdetail">
                  <p>{r.concept.summary}</p>
                  {r.concept.update_2026 && <p className="update-note">🆕 {r.concept.update_2026}</p>}
                  <p className="csec">
                    {r.concept.sections.join(" · ")} · day {r.concept.day_assigned}
                    {r.state ? ` · ${r.state.corrects}/${r.state.attempts} correct · next review ${r.state.due || "—"}` : " · not started"}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
