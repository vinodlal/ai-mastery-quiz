# AI Mastery — 21-Day Quiz Coach (offline-first PWA)

A personal, single-user quiz & spaced-repetition app generated from your two learning
documents (`AI_TECHNICAL_GLOSSARY.md` + `SW_Engineering_and_Agentic_AI_Guide.md`).

- **169 concepts** (133 from your source + 36 web-researched 2026 enhancements)
- **202 MCQs**: 169 topic questions (every concept covered) + a **33-question cross-part Scenario Bank**, each with a full why-right/why-wrong explanation
- **Thematic gated course**: concepts clustered by theme/dependency (not document order) into **23 parts across 5 modules**, sequenced foundational-first
- **Study Mode**: tap through the part's topic cards one by one; "Start Quiz" appears only after the last card. The Day Quiz then asks exactly those topics, in the same order — no scenarios mixed in
- **Score-gated, self-paced**: no calendar locking; `unlocked_up_to_part` lives in IndexedDB and Part N+1 opens only when Part N's Day Quiz scores ≥ 80% (configurable in Settings). Fail → re-study → retry
- **Scenario weaving**: each scenario is tagged `min_part_required`; 1-2 eligible scenarios join review sessions once 3+ parts are unlocked, and Final Test Level 3 draws primarily from the Scenario Bank
- **Dual progress metrics**: the pass/fail part gate AND SM-2 "true mastery" (3 correct answers on 3 different days per topic) are tracked and shown separately
- **30-minute final assessment**: 3 levels × 10 min, pass gates 90% / 85% / 80%
- **All data in IndexedDB** on the device. No backend, no login, no analytics, zero runtime network calls.
- **Export / Import progress as JSON** (Settings) — your backup against iOS Safari's ~7-day storage eviction.

Deliverables at the project root: `concept_inventory.json`, `question_bank.json`.

---

## 1. Run locally on Windows

```powershell
cd "C:\My Learning APP- Claude"
npm install        # first time only
npm run dev        # dev server at http://localhost:5173
```

Production build + data validation:

```powershell
npm run build      # regenerates data, builds dist/ with service worker
npm run validate   # 16-check self-test suite (data, SM-2, assessment, PWA)
npm run preview    # serves the built app at http://localhost:4173
```

> Rule of thumb: use `npm run dev` while poking around, but test PWA/offline behaviour
> with `npm run build` + `npm run preview` — the service worker only exists in the built app.

## 2. Preview at iPhone size in Chrome DevTools

1. Open http://localhost:5173 in Chrome.
2. Press **F12** → click the **device toolbar** icon (Ctrl+Shift+M).
3. In the dimensions dropdown choose **Edit…** → **Add custom device**:
   - Name: `iPhone 17 Pro Max`, Width `430`, Height `932`, DPR `3`, type Mobile.
4. Select it. Use the rotate icon to test landscape (932×430).
5. Add a second custom device `Tablet` at `820 × 1180` for the tablet view.

## 3. Install on your actual iPhone 17 Pro Max & tablet

iOS requires a **secure context (HTTPS)** for the service worker, so plain
`http://<pc-ip>:4173` over Wi-Fi will install but won't work offline. Two good options:

### Option A — GitHub Pages (DEPLOYED — this is the live setup)

**Live URL: https://vinodlal.github.io/ai-mastery-quiz/**

- Source repo: https://github.com/vinodlal/ai-mastery-quiz (public; app code + quiz
  content only — progress data never leaves the device)
- Hosting serves static files only; all progress lives in each device's IndexedDB.

**iPhone (Safari)**: open the URL → Share button → **Add to Home Screen** → Add.
**iPad (Safari)**: same. **Android tablet (Chrome)**: open URL → ⋮ → **Add to Home screen** / "Install app".
Open the installed icon once while online (precaches everything), then it works fully
offline — test with Airplane Mode.

To ship an update later:

```powershell
cd "C:\My Learning APP- Claude"
npm run build
cd dist
git add -A; git commit -m "update"; git push --force https://github.com/vinodlal/ai-mastery-quiz.git gh-pages
```

Installed apps pick the update up automatically the next time they're opened online.

### Option B — fully local over your Wi-Fi (no internet hosting)

Uses mkcert to create a certificate your iPhone can trust:

```powershell
winget install FiloSottile.mkcert
mkcert -install
ipconfig                       # note your PC's Wi-Fi IPv4, e.g. 192.168.1.42
cd "C:\My Learning APP- Claude"
mkcert 192.168.1.42            # writes 192.168.1.42.pem + 192.168.1.42-key.pem
npm run build
npx http-server dist -S -C 192.168.1.42.pem -K 192.168.1.42-key.pem -p 8443
```

On the iPhone (once):
1. Find mkcert's root CA: `mkcert -CAROOT` → copy `rootCA.pem` somewhere servable,
   e.g. `copy "$(mkcert -CAROOT)\rootCA.pem" dist\` and download it in Safari from
   `https://192.168.1.42:8443/rootCA.pem` (or email it to yourself).
2. Settings → **Profile Downloaded** → Install.
3. Settings → General → About → **Certificate Trust Settings** → enable full trust for mkcert.
4. Safari → `https://192.168.1.42:8443` → Share → **Add to Home Screen**.

PC and iPhone must be on the same Wi-Fi. After the first load the app runs offline;
the server only needs to be running again when you want to update the app.

---

## Project layout

```
concept_inventory.json   ← deliverable: all 169 concepts, tagged by source section
question_bank.json       ← deliverable: all 169 MCQs with day/difficulty
data/src/                ← hand-authored inventories + question parts (edit here)
scripts/build_data.mjs   ← merges/validates data, assigns days, shuffles options
scripts/validate.mjs     ← 16-check self-test suite
scripts/gen_icons.mjs    ← regenerates PWA icons
src/lib/scheduler.js     ← SM-2 + mastery + assessment logic (pure, unit-tested)
src/lib/db.js            ← IndexedDB wrapper + export/import
src/screens/             ← Dashboard, DailyQuiz, ReviewQueue, Progress, FinalTest, Settings
```

## Weekly habit

Open **Settings → Export progress (JSON)** about once a week and whenever you'll
be away from the app for a few days — iOS Safari may evict site storage after
~7 days of non-use. Import the file to restore everything.
