# Wave 1: Polish & UX — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform the existing bot from prototype to polished product — i18n infrastructure, format utilities, unified navigation, improved wizards, better card/list displays.

**Architecture:** i18n first (all subsequent code uses `ctx.t()`), then utilities, then UI changes top-down (menu → lists → cards → wizards).

**Tech Stack:** Node.js ESM, grammY, Supabase PostgreSQL

**Note:** No tests in this project (per CLAUDE.md). Verification is manual via `npm run dev`.

---

## Task 1: i18n Infrastructure (#112)

**Files:**
- Create: `src/locales/index.js`
- Create: `src/locales/ru.js`
- Modify: `src/middleware/auth.js`
- Modify: `src/config.js`

**DB migration:** `ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'ru';`

---

## Task 2: Format Utilities (#1, #8, #9, #10, #16)

**Files:**
- Modify: `src/utils/format.js` — add breadcrumb, pluralize, relativeDate, truncate, progressBar

---

## Task 3: Emoji Mapping & Config (#6, #115)

**Files:**
- Modify: `src/config.js` — add EMOJI map, CATEGORY_KEYWORDS, expand DOSAGE_UNITS

---

## Task 4: Common Keyboards & Navigation (#2, #4, #5)

**Files:**
- Modify: `src/keyboards/common.js` — enhance backButton, add confirmDelete
- Modify: `src/keyboards/mainMenu.js` — quick actions (#3)

---

## Task 5: Main Menu Dashboard (#3, #7, #20, #21, #25)

**Files:**
- Modify: `src/handlers/menu.js` — quick actions, empty states, counters, problem indicators

---

## Task 6: Medicine Card Polish (#16, #17, #18, #19, #25)

**Files:**
- Modify: `src/handlers/medicines.js` — progress bar, status badges, quick restock, linked schedules, date added

---

## Task 7: Medkit List Polish (#20, #21, #22, #23)

**Files:**
- Modify: `src/handlers/medkits.js` — counters in buttons, problem indicators, group operations, saved sort

---

## Task 8: AddMedicine Wizard Polish (#11-15, #30, #33)

**Files:**
- Modify: `src/handlers/addMedicine.js` — skip buttons, preview, cancel, validation, last category, auto-category, duplicate check

---

## Task 9: Text Formatting & Empty States (#7, #8, #9, #10, #24)

**Files:**
- Modify all handlers to use new format utilities and i18n strings
- Add empty state messages everywhere

---

## Task 10: Extract ALL Existing Strings to i18n

**Files:**
- Modify: `src/locales/ru.js` — add all remaining strings
- Modify: ALL handlers — replace hardcoded strings with ctx.t() calls

---
