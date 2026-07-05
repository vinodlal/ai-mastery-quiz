import React, { useRef, useState } from "react";

export default function Settings({ app }) {
  const { doExport, doImport, resetProgress, derived } = app;
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  async function handleExport() {
    try {
      const data = await doExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-mastery-backup-${derived.today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("✅ Backup downloaded. Keep it somewhere safe (Files app / iCloud).");
    } catch (e) {
      setMsg("❌ Export failed: " + e.message);
    }
  }

  async function handleImport(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await doImport(data);
      setMsg("✅ Progress restored from backup.");
    } catch (e) {
      setMsg("❌ Import failed: " + e.message);
    } finally {
      ev.target.value = "";
    }
  }

  return (
    <div className="screen">
      <header className="apphead"><h1>Settings</h1></header>

      <div className="card">
        <h3>Course pace</h3>
        <p className="csec">
          The course is self-paced: finish a lesson (Study → Quiz) to unlock the next day.
          Do one lesson a day for the intended 21-day rhythm, or binge ahead — reviews stay on their own spaced schedule either way.
        </p>
      </div>

      <div className="card">
        <h3>Backup & restore</h3>
        <p className="csec">
          ⚠️ iOS Safari can evict site storage after ~7 days of inactivity.
          Export your progress regularly — especially before breaks.
        </p>
        <div className="btnrow">
          <button className="btn btn-primary" onClick={handleExport}>Export progress (JSON)</button>
          <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>Import backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={handleImport} />
        </div>
        {msg && <p className="msg">{msg}</p>}
      </div>

      <div className="card">
        <h3>Danger zone</h3>
        {!confirmReset ? (
          <button className="btn btn-danger" onClick={() => setConfirmReset(true)}>Reset all progress…</button>
        ) : (
          <>
            <p>This wipes every answer, schedule and test result on this device. Export a backup first?</p>
            <div className="btnrow">
              <button className="btn btn-danger" onClick={async () => { await resetProgress(); setConfirmReset(false); setMsg("Progress reset."); }}>
                Yes, wipe everything
              </button>
              <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3>About</h3>
        <p className="csec">
          Personal offline course built from your AI/RAG learning documents.
          169 topics · 202 questions (incl. 33 cross-concept scenarios) · 21 sequential lessons in 5 parts ·
          Study→Quiz flow · simplified SM-2 spaced repetition.
          All data stays in this device's IndexedDB — no network calls, no analytics, no account.
        </p>
      </div>
    </div>
  );
}
