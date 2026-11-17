# LabelSnap — guidance for Claude

LabelSnap is a progressive web app for researchers: pick a Document → snap a label (auto-detected, cropped,
straightened, OCR'd on the device) → add a caption and footnote → the capture lands in the Document as a numbered
figure, ready to export to PDF or .docx. The product spec is `LabelSnap.md` (functional requirements are referenced
as FR-xxx, non-functional ones as NFR-xx). The wireframes are the "LabelSnap Wireframes" design canvas (light
notebook look); `logo-draft/` holds the logo work (concept A, "Snap Bracket", is the app icon).

## Glossary (use these words strictly)

- **Document**: the output being assembled: ordered Entries plus a Template. Exports to PDF or .docx.
- **Entry**: one capture: original + derived (cropped/enhanced) + thumbnail images, caption, footnote, OCR, metadata.
- **Template**: page size, orientation, images per page, caption position, numbering, caption template, fonts, custom fields.
- **Space**: ownership boundary. v1 has one personal Space per user (`personal_{uid}`); team Spaces are v2.
- **Capture session**: consecutive captures into one Document without leaving the camera (Save & next).

## Commands

```bash
npm run dev              # Vite dev server against the live Firebase project
npm run emulators        # Firebase Auth + Firestore emulators (needs Java 11+)
npm run dev:emulators    # dev server pointed at the emulators (.env.emulators) — use this for testing
npm run build            # tsc -b && vite build (also generates the service worker)
npm run preview          # serve dist/ (PWA + offline testing)
npm test                 # Vitest unit tests (tests/*.test.ts) — pure logic, imaging, export builders
npm run test:rules       # Firestore security-rules tests; starts the Firestore emulator itself
npm run lint && npm run typecheck && npm run i18n:check
npm run icons            # regenerate public/icons from logo concept A
npm run deploy:rules     # publish firestore.rules (requires `firebase login`; confirm with the user first)
```

Always finish a change with `npm run typecheck`, `npm run lint`, `npm test` and `npm run i18n:check`.

## Stack

Vite 5 + React 18 + TypeScript (strict) · react-router 6 · zustand · Firebase JS SDK 11 (Auth, Firestore with
`persistentLocalCache`) · Google Drive REST v3 via Google Identity Services · Dexie (IndexedDB) · tesseract.js 5 ·
pdf-lib · docx · dnd-kit · @tanstack/react-virtual · i18next · vite-plugin-pwa (Workbox, `registerType: 'prompt'`).
Hosting: Vercel (`vercel.json`). There is no server code and no Cloud Functions (no Blaze plan).

## Architecture

- **Local-first.** Firestore's persistent cache is the offline mirror and metadata write queue. Writes go through
  `fire()` in `src/data/refs.ts`: **never `await` a Firestore write in the UI path** (offline it only settles when
  the server acknowledges). Ids are generated client-side (`newId()`).
- **Images live in the user's Google Drive, not Firebase Storage.** `src/lib/drive/` (GIS token client, scope
  `drive.file`). Layout: `LabelSnap/` → one folder per Document (found by `appProperties.labelsnapDocument`) →
  `{entryId}_{original|derived|thumb}.jpg`. Entry fields `originalImagePath` / `imagePath` / `thumbPath` hold
  **Drive file ids** (empty until uploaded); `imageStorage: 'gdrive'`. Images are fetched as authenticated blobs
  (`src/lib/images.ts`); no public links are ever created.
- **Blobs first, uploads queued.** `saveNewEntry` writes the three variants to Dexie `image_blobs`, then queues
  `pending_ops` (`src/lib/sync/uploadQueue.ts`). The queue drains on start-up, `online`, `visibilitychange` and
  Drive reconnect (no Background Sync — iOS lacks it), with exponential backoff (`backoff.ts`, 8 attempts, then
  `failed` + banner). **Never delete a local blob before its upload is confirmed** (`uploaded: 1`); eviction
  (`quota.ts`) only removes uploaded non-thumbnail blobs.
- **GIS needs a user gesture.** `connectDrive()` must be called synchronously from a click handler; the GIS script
  is preloaded in `main.tsx`. An expired token shows a "Reconnect" banner instead of a popup.
- **Personal Space bootstrap** (`src/data/session.ts`): one batch creates `spaces/personal_{uid}`, its owner
  `members/{uid}`, `users/{uid}` and preferences. It retries if the first read fails and re-runs if the profile
  lacks `defaultSpaceId`.
- **Shared snapshot listeners** (`src/hooks/useFirestore.ts`): one ref-counted listener per key with delayed
  teardown. Do not call `onSnapshot` directly in components — rapid listen/unlisten of the same query (StrictMode,
  remounts) trips a Firestore internal assertion (`ID: ca9`) that corrupts the client cache.
- **One layout engine** (`src/lib/templates/layout.ts` + `render.ts`): Template live preview, page-preview tab,
  print view, PDF (`lib/export/pdf.ts`) and .docx (`lib/export/docx.ts`) all place figures from it. Units are PDF
  points, origin top-left. Change layout in one place only.
- **Capture → Crop → Review is one route** (`features/capture/CaptureFlow.tsx`) so the camera stream survives
  Save & next. The stream is released on `visibilitychange` and after 2 minutes away from the viewfinder.
  The camera starts only from an explicit tap or when permission is already granted (iOS gesture rule).
- **Detection without OpenCV** (`src/lib/imaging/detect.ts`, run in `imaging.worker.ts`): edge-enclosure and
  Otsu-blob strategies → convex hull → 4-corner simplification → validation. Perspective warp, rotation,
  straighten, filters (`raster.ts`) and quality checks (`quality.ts`) are pure functions with unit tests.
- **OCR** (`src/lib/ocr/ocrService.ts`) runs in Tesseract's own worker, jobs serialised. The Entry saves first;
  a still-running recognition is attached later (`data/ocrJobs.ts`). Language data size comes from a HEAD request
  (FR-071); metered connections need confirmation. Field extraction: `fieldPatterns.ts` (lot, batch, expiry,
  catalogue, CAS with check digit).
- **Entry order** is a sparse float (`src/lib/order.ts`); a move writes one document. Figure numbers are derived.
- **Trash purge** (FR-024) runs client-side on app start (`purgeExpiredTrash`), deleting the Drive folder too.

## Data model deviations from LabelSnap.md

- Images in Google Drive (user's request); `*Path` fields hold Drive file ids; Firebase Storage is unused.
- Built-in Templates ship in code (`lib/templates/builtins.ts`, ids `builtin-*`), not a seeded collection.
- Preferences `theme` is `light | highContrast` (the wireframe look replaced the dark §10 palette).
- Extra fields: Entry `straighten`, `ocrConfidence`, `ocrLanguages`, `imageStorage`; Document `coverEntryId`,
  `driveFolderId`; Preferences `showGrid`, `autoDetect`, `timeFormat24h`, `onboardingDone`.
- Avatars are small data-URL thumbnails on the profile doc (no image storage).

## Conventions

- **All user-facing strings go through `t()`** with keys in `src/i18n/locales/en.json` (FR-142). Plurals use
  `_one` / `_other`. Run `npm run i18n:check` (dynamic `t(\`prefix.${x}\`)` keys must be checked by hand).
- **Colours only via tokens** in `src/styles/tokens.css`; no raw hex in components. Exception: the printed-page
  simulation (`.page-sheet`, `PagePreview`) mirrors the PDF output colours.
- Status colours always pair with an icon or text (colour-blind safe). Touch targets ≥ 44 px. Real `<button>`,
  `<a>`, labelled inputs; dialogs use the native `<dialog>` via `Sheet`; never `window.confirm` (use
  `confirmDialog` / `promptDialog` from `stores/dialogStore.ts`).
- Analytics (`lib/firebase/analytics.ts`) sends counts only — never image content, OCR text, captions or email.
- Comments explain *why*; reference FR ids in commit messages rather than code.
- Firestore rejects `undefined` unless `ignoreUndefinedProperties` (enabled) — still prefer `null` for "cleared".

## Theme tokens (wireframe light look)

Paper `--bg #FDFCF8`, surface `#FFFFFF`, text `#37352F`, secondary `#6F6E69`, tertiary `#7A7874` (darkened from
the wireframe's `#9B9A97` for AA contrast), accent `#7B1E2C` (maroon), accent tint `#F6E9EB`, detection overlay
`#E7A3AE`, danger `#B42318`, success `#2F7D4F`. Ruled-paper background (`.paper`). High-contrast variant via
`[data-theme='hc']`. Text scale via root font-size (1.0–1.5).

## Platform constraints (from the spec, still binding)

NFR-01 camera needs a secure context and (iOS) a gesture · NFR-02 no Background Sync on iOS · NFR-03 storage
eviction for non-installed sites → install prompt after 3 saves, `navigator.storage.persist()` · NFR-04 torch /
zoom / focus are capability-detected · NFR-05/06 Tesseract data lazy + cached, OCR never blocks the shutter ·
NFR-07 Web Speech optional · NFR-09 Safari needs a gesture for downloads → explicit Share/Download buttons after
export · NFR-10 export in chunks with progress and cancel.

## Manual setup (owner's Google/Firebase consoles)

1. Firebase → Authentication: Email/Password enabled; enable Google provider for Google sign-in; add the Vercel
   domain to Authorized domains.
2. Firebase → Firestore → Rules: publish `firestore.rules` (or `npm run deploy:rules` after `firebase login`).
3. Google Cloud (project `labelsnap-12765`): enable the Google Drive API; OAuth consent screen (External, Testing,
   add test users, scope `drive.file`); create an OAuth 2.0 **Web** client with JS origins `http://localhost:5173`,
   `http://localhost:4173` and the Vercel URL; put the client id in `src/config.ts` (or `VITE_GOOGLE_CLIENT_ID`).
4. Vercel: import the repo; framework Vite, build `npm run build`, output `dist`.

## Scope status

v1 modules 1–7, 10–13, 15, 17 are implemented, plus the v1 parts of 16 (toasts/undo, failed-sync banner) and the
baseline of 18 (rules). v2 (team Spaces/invites, barcode, annotation, search, push, app lock, EXIF strip, data
export, observability) is not built; the data model leaves room for it (`members`, `invites`, `folders`).
