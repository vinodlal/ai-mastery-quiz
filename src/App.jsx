import React, { useState } from "react";
import { useAppState } from "./lib/store.js";
import Dashboard from "./screens/Dashboard.jsx";
import Lesson from "./screens/Lesson.jsx";
import ReviewQueue from "./screens/ReviewQueue.jsx";
import Progress from "./screens/Progress.jsx";
import FinalTest from "./screens/FinalTest.jsx";
import Settings from "./screens/Settings.jsx";

const TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "learn", label: "Learn", icon: "📚" },
  { id: "review", label: "Review", icon: "🔁" },
  { id: "progress", label: "Progress", icon: "📊" },
  { id: "test", label: "Final", icon: "🎓" },

  { id: "settings", label: "Settings", icon: "⚙️" },
];

export default function App() {
  const app = useAppState();
  const [tab, setTab] = useState("home");
  // A quiz/review/test in progress locks navigation prompts via each screen's own state.

  if (!app.loaded) {
    return (
      <div className="shell">
        <main className="content center"><div className="card">Loading your progress…</div></main>
      </div>
    );
  }

  return (
    <div className="shell">
      <main className="content" key={tab}>
        {tab === "home" && <Dashboard app={app} go={setTab} />}
        {tab === "learn" && <Lesson app={app} go={setTab} />}
        {tab === "review" && <ReviewQueue app={app} go={setTab} />}
        {tab === "progress" && <Progress app={app} />}
        {tab === "test" && <FinalTest app={app} />}
        {tab === "settings" && <Settings app={app} />}
      </main>
      <nav className="tabbar" aria-label="Main navigation">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "tab-active" : ""}`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <span className="tab-icon" aria-hidden="true">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
