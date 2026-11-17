# LabelSnap

Snap a label, let LabelSnap find and straighten it and read the text on the device, add a caption and footnote,
and the capture lands in your document as a numbered figure — ready to export as PDF or Word. Works offline at
the bench; images back up to your own Google Drive.

## Run it

```bash
npm install
npm run dev                 # http://localhost:5173 against the live Firebase project
```

### Run against local emulators (recommended for testing)

Requires Java 11+.

```bash
npm run emulators           # terminal 1: Auth (9099) + Firestore (8080)
npm run dev:emulators       # terminal 2: app pointed at the emulators
```

Accounts and data created this way exist only in the emulators.

### Tests

```bash
npm test                    # unit tests: ordering, layout, tokens, OCR field patterns, detection, warp, PDF/.docx
npm run test:rules          # Firestore security rules against the emulator
npm run lint && npm run typecheck && npm run i18n:check
```

## One-time setup

1. **Firebase console → Authentication**
   - Email/Password: enabled.
   - Google: enable it if you want "Continue with Google".
   - Settings → Authorized domains: add your Vercel domain (e.g. `labelsnap.vercel.app`).
2. **Firebase console → Firestore → Rules**: paste `firestore.rules` and publish
   (or `npx firebase login` then `npm run deploy:rules`).
3. **Google Cloud console** (project `labelsnap-12765`) — for image storage in Google Drive:
   - APIs & Services → Library → enable **Google Drive API**.
   - OAuth consent screen → External, Testing mode, add yourself (and colleagues) as test users, add scope
     `https://www.googleapis.com/auth/drive.file`.
   - Credentials → Create OAuth client ID → **Web application**; Authorized JavaScript origins:
     `http://localhost:5173`, `http://localhost:4173`, `https://<your-vercel-domain>`.
   - Put the client ID in `src/config.ts` (`GOOGLE_CLIENT_ID`) or set `VITE_GOOGLE_CLIENT_ID` in Vercel.
4. **Vercel**: import the repository. The defaults from `vercel.json` work (framework Vite, `npm run build`,
   output `dist`). HTTPS is required for the camera on phones.

Without step 3 the app still works, but images stay on the device that captured them.

## Where things are

| Path | What |
| ---- | ---- |
| `src/features/` | Screens: auth, home, documents, document-detail, capture, crop, review, template-editor, export, viewer, settings, onboarding |
| `src/data/` | Firestore repositories and live hooks (documents, entries, templates, session) |
| `src/lib/imaging/` | Label detection, perspective warp, filters, quality checks (Web Worker) |
| `src/lib/ocr/` | Tesseract service and field extraction |
| `src/lib/templates/` | Built-in templates, caption tokens, the shared page layout engine |
| `src/lib/export/` | PDF and .docx builders |
| `src/lib/drive/`, `src/lib/sync/` | Google Drive client and the offline upload queue |
| `firestore.rules` | Security rules (membership-based) |
| `CLAUDE.md` | Architecture and conventions |
