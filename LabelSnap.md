# **LabelSnap**

## 1. Problem Statement

As a researcher, my daily routine is to snap a product, a label, or a lab picture. I then have to transfer each picture manually into a document, and write a footnote for each one. This repetitive manual transfer is the main pain point. It would also help if the app could read the text on the label (OCR) and automatically crop the frame around the label or product.

**Core flow:** choose or create a document → enter camera mode (with OCR / label detection) → snap, with a caption or footnote step before saving → the capture lands in the document, already formatted.

## 2. Project Objectives

| No | Objective | Realised by |
| :---- | :---- | :---- |
| OBJ-1 | A progressive web app that snaps a picture and places it into a document | Modules 3, 5, 11, 13 |
| OBJ-2 | Each document's output format can be customised | Module 4, 12 |
| OBJ-3 | Automatic label detection and OCR | Modules 6, 7, 8 |
| OBJ-4 | Manage documents | Modules 3, 14 |
| OBJ-5 | Usable in the field, where the bench has no signal | Module 13 |

## 3. Glossary

The draft used the word "document" for two different things — the report being assembled, and the piece of paper being photographed. These four nouns are used strictly throughout this spec:

| Term | Meaning |
| :---- | :---- |
| **Document** | The output being assembled: an ordered collection of Entries plus a Template. Exports to PDF or .docx. |
| **Entry** | One capture: the image (original + cropped), its caption, its footnote, its OCR result, and its metadata. One Entry is one figure in the exported Document. |
| **Template** | A reusable output format: page size, images per page, caption position, numbering scheme, typography. |
| **Space** | The ownership boundary. Every Document belongs to exactly one Space. A Space is either `personal` (created automatically, one per user) or `team` (shared with invited members). |
| **Capture session** | A continuous run of Entries into one Document without leaving the camera. |

## 4. Scope

| Release | Modules |
| :---- | :---- |
| **v1** | 1 Auth, 2 Workspace *(personal Space only)*, 3 Documents, 4 Templates, 5 Capture, 6 Detection & Crop, 7 OCR, 10 Caption & Footnote, 11 Entry management, 12 Export, 13 Offline & Sync, 15 Settings, 17 Onboarding |
| **v2** | 2 Workspace *(team Spaces, invites, roles)*, 8 Barcode/QR, 9 Annotation & Redaction, 14 Search, 16 Notifications, 18 Security & Data Governance *(beyond the baseline rules)*, 19 Observability |

v1 is shippable on its own: no v1 requirement depends on a v2 module. The data model below is written once, with the v2 fields present but unused in v1, so no migration is needed later.

## 5. Technology

| Layer | Choice |
| :---- | :---- |
| UI | React + TypeScript |
| Delivery | Progressive Web App (installable, offline-capable) |
| Database | Firebase Firestore |
| File storage | Firebase Storage |
| Auth | Firebase Authentication (email/password + Google OAuth) |
| OCR | Tesseract.js, on-device, in a Web Worker |
| Local store | IndexedDB (image blobs, upload queue, search index) |
| PDF export | Client-side render (e.g. pdf-lib / jsPDF) |
| .docx export | Client-side generation (e.g. the `docx` package) |
| Barcode *(v2)* | `BarcodeDetector` where available, ZXing fallback |

On-device OCR was chosen over a cloud Vision API so that scanning works offline at the bench and costs nothing per image. The trade-off is accuracy on glossy, curved or very small print, and 2–5 s per image on mid-range mobile — which is why OCR runs in a worker and never blocks the shutter.

## 6. Functional Requirements

Priority `v1` / `v2` matches the scope table above, and doubles as the build order.

| No | Module | ID | Requirement | Pri. |
| :---- | :---- | :---- | :---- | :---- |
| 1 | User Authentication & Account | FR-001 | The system shall allow users to register and log in using email/password or Google OAuth via Firebase Authentication. | v1 |
|  |  | FR-002 | The system shall maintain user session state and automatically redirect unauthenticated users to the login page. | v1 |
|  |  | FR-003 | The system shall allow users to log out and securely terminate their active session. | v1 |
|  |  | FR-004 | The system shall allow a user to request a password reset email and set a new password from the emailed link. | v1 |
|  |  | FR-005 | The system shall send a verification email on email/password registration and indicate unverified status in the account screen. | v1 |
|  |  | FR-006 | The system shall create a personal Space automatically on first sign-in and set it as the default Space. | v1 |
|  |  | FR-007 | The system shall allow a user to edit their display name and profile photo. | v1 |
|  |  | FR-008 | The system shall allow a user to link or unlink an additional auth provider to the same account. | v2 |
|  |  | FR-009 | The system shall allow a user to delete their account, cascade-deleting their personal Space, its Documents, Entries and stored images. | v2 |
|  |  | FR-010 | The system shall require recent re-authentication before account deletion, email change or password change. | v2 |
| 2 | Workspace & Team | FR-011 | The system shall scope every Document to exactly one Space and shall show only Documents of the active Space. | v1 |
|  |  | FR-012 | The system shall provide a Space switcher when the user belongs to more than one Space, and hide it when only the personal Space exists. | v1 |
|  |  | FR-013 | The system shall allow a user to create a team Space with a name, becoming its owner. | v2 |
|  |  | FR-014 | The system shall allow an owner to invite members to a team Space by email address with an assigned role. | v2 |
|  |  | FR-015 | The system shall support the roles owner, editor and viewer, where viewers may read and export but not create, edit or delete. | v2 |
|  |  | FR-016 | The system shall allow an invitee to accept an invitation via an emailed link, and shall expire unaccepted invitations after 14 days. | v2 |
|  |  | FR-017 | The system shall allow an owner to change a member role or remove a member, and shall allow a member to leave a Space. | v2 |
|  |  | FR-018 | The system shall prevent the removal of the last owner of a Space. | v2 |
|  |  | FR-019 | The system shall allow an owner to rename or delete a team Space, confirming the Document count that will be removed. | v2 |
| 3 | Document Management | FR-020 | The system shall allow users to create a Document with a title and an assigned Template. | v1 |
|  |  | FR-021 | The system shall list the Documents of the active Space with cover thumbnail, title, Entry count and last-updated time. | v1 |
|  |  | FR-022 | The system shall allow users to rename, duplicate and delete a Document. | v1 |
|  |  | FR-023 | The system shall treat deletion as a soft delete into a Trash, and shall allow restore from Trash. | v1 |
|  |  | FR-024 | The system shall permanently purge Trashed Documents, including their stored images, 30 days after deletion. | v1 |
|  |  | FR-025 | The system shall allow users to sort the Document list by last updated, title or creation date, and filter it by tag. | v1 |
|  |  | FR-026 | The system shall allow users to assign free-text tags to a Document. | v1 |
|  |  | FR-027 | The system shall allow users to pin Documents so they appear first in the list. | v1 |
|  |  | FR-028 | The system shall offer a Continue last Document shortcut on the home screen. | v1 |
|  |  | FR-029 | The system shall maintain a Document-level notes field for context not tied to any single Entry. | v1 |
|  |  | FR-030 | The system shall allow users to organise Documents into folders, including nested folders. | v2 |
|  |  | FR-031 | The system shall allow users to archive a Document, hiding it from the default list without deleting it. | v2 |
| 4 | Document Format / Template | FR-032 | The system shall allow users to choose page size (A4, Letter) and orientation (portrait, landscape) per Template. | v1 |
|  |  | FR-033 | The system shall allow users to set the number of images per page (1, 2, 4, 6). | v1 |
|  |  | FR-034 | The system shall allow users to set caption position relative to the image (above, below, right). | v1 |
|  |  | FR-035 | The system shall number Entries in the export using a selectable scheme (Figure N, Fig. N, Plate N, Image N, none) and shall renumber after reordering. | v1 |
|  |  | FR-036 | The system shall allow users to define a caption template containing variable tokens, including index, date, time, ocr, barcode, document and any custom field name, and shall pre-fill each new Entry caption by expanding it. | v1 |
|  |  | FR-037 | The system shall allow users to define page header and footer text, with support for a page-number token. | v1 |
|  |  | FR-038 | The system shall allow users to set caption and body font family and size per Template. | v1 |
|  |  | FR-039 | The system shall provide at least three built-in Templates: single large image per page, two-up with captions, four-up contact sheet. | v1 |
|  |  | FR-040 | The system shall allow users to save a customised format as a named reusable Template in the active Space. | v1 |
|  |  | FR-041 | The system shall allow users to apply a different Template to an existing Document, re-flowing its Entries without altering their images or text. | v1 |
|  |  | FR-042 | The system shall allow users to define per-Document custom Entry fields (name, type of text/number/date/choice, required flag) that appear in the caption form. | v1 |
|  |  | FR-043 | The system shall show a live preview of the Template as it is edited. | v1 |
| 5 | Capture (Camera) | FR-044 | The system shall open a live camera preview and shall always display which Document the capture will be saved into. | v1 |
|  |  | FR-045 | The system shall request camera permission only after an explaining screen, and shall provide a working fallback to file or gallery import when permission is denied or no camera exists. | v1 |
|  |  | FR-046 | The system shall allow users to import one or more existing images from the device gallery or file system as Entries. | v1 |
|  |  | FR-047 | The system shall allow users to switch between available cameras and shall default to the rear camera. | v1 |
|  |  | FR-048 | The system shall allow users to toggle the torch where the device and browser expose it. | v1 |
|  |  | FR-049 | The system shall support pinch-to-zoom and tap-to-focus where the browser exposes the capability. | v1 |
|  |  | FR-050 | The system shall offer an optional rule-of-thirds grid overlay to help square up labels. | v1 |
|  |  | FR-051 | The system shall allow users to select capture resolution and JPEG quality, and shall persist the choice. | v1 |
|  |  | FR-052 | The system shall provide a capture session mode that returns directly to the live preview after a save, so consecutive labels can be shot without navigating. | v1 |
|  |  | FR-053 | The system shall display a running count and a thumbnail strip of the Entries captured in the current session. | v1 |
|  |  | FR-054 | The system shall allow users to retake a capture before it is saved, discarding the previous frame. | v1 |
|  |  | FR-055 | The system shall release the camera stream when the capture screen loses visibility or is navigated away from. | v1 |
|  |  | FR-056 | The system shall offer an optional 3 or 10 second self-timer for one-handed or fixed-stand capture. | v2 |
| 6 | Detection & Auto-crop | FR-057 | The system shall detect the quadrilateral of a label or document in the live preview and draw it as an overlay. | v1 |
|  |  | FR-058 | The system shall automatically crop the captured image to the detected quadrilateral. | v1 |
|  |  | FR-059 | The system shall apply a perspective correction so that a label photographed at an angle is rectified to a rectangle. | v1 |
|  |  | FR-060 | The system shall allow users to adjust the four corners by dragging handles, and shall re-render the correction live. | v1 |
|  |  | FR-061 | The system shall allow users to reset the crop to the full frame, and to switch detection off for a capture. | v1 |
|  |  | FR-062 | The system shall allow users to rotate an image in 90 degree steps and to straighten it by a free angle. | v1 |
|  |  | FR-063 | The system shall offer image enhancement filters: none, auto-contrast, greyscale, high-contrast black and white. | v1 |
|  |  | FR-064 | The system shall warn, before save, when a capture is detected as blurred, badly underexposed or heavily glared, and shall offer a retake. | v1 |
|  |  | FR-065 | The system shall retain the original uncropped image alongside the derived cropped image, so a crop can always be redone. | v1 |
|  |  | FR-066 | The system shall allow users to re-crop a saved Entry from its retained original. | v1 |
| 7 | OCR | FR-067 | The system shall extract text from a capture using on-device OCR, executed in a Web Worker so that the interface and the shutter remain responsive. | v1 |
|  |  | FR-068 | The system shall run OCR on the cropped and enhanced image rather than the raw frame. | v1 |
|  |  | FR-069 | The system shall display OCR progress and shall allow the Entry to be saved before OCR completes, attaching the result when it finishes. | v1 |
|  |  | FR-070 | The system shall allow users to select one or more OCR languages, and shall download and cache the corresponding language data on first use. | v1 |
|  |  | FR-071 | The system shall warn the user of the download size of OCR language data and shall require explicit confirmation on a metered connection. | v1 |
|  |  | FR-072 | The system shall present the recognised text in an editable field so the user can correct it before saving. | v1 |
|  |  | FR-073 | The system shall display a confidence indicator for the recognised text and shall flag low-confidence results for review. | v1 |
|  |  | FR-074 | The system shall allow users to run OCR on a selected region of the image instead of the whole image. | v1 |
|  |  | FR-075 | The system shall allow users to copy the recognised text to the clipboard. | v1 |
|  |  | FR-076 | The system shall extract named fields from the recognised text using configurable patterns (lot number, batch, expiry date, catalogue number, CAS number) and write them into matching custom Entry fields. | v1 |
|  |  | FR-077 | The system shall allow users to re-run OCR on a saved Entry, optionally with a different language. | v1 |
|  |  | FR-078 | The system shall allow OCR to be disabled entirely, per Document and globally in settings. | v1 |
| 8 | Barcode & QR | FR-079 | The system shall detect and decode 1D barcodes and QR codes in the live preview. | v2 |
|  |  | FR-080 | The system shall store a decoded code on the Entry and make it available to the caption template. | v2 |
|  |  | FR-081 | The system shall allow a decoded code to be mapped to a tag or a custom field value by a user-defined rule. | v2 |
|  |  | FR-082 | The system shall allow a scanned code to select or create the target Document, so a sample can be scanned to route its captures. | v2 |
| 9 | Annotation & Redaction | FR-083 | The system shall allow users to draw freehand strokes, arrows and boxes over an Entry image. | v2 |
|  |  | FR-084 | The system shall allow users to add text labels over an Entry image. | v2 |
|  |  | FR-085 | The system shall allow users to redact a region by opaque block or blur, and shall apply the redaction destructively to the derived image so it cannot be recovered from the export. | v2 |
|  |  | FR-086 | The system shall store annotations as a separate editable layer and shall flatten them into the exported image. | v2 |
| 10 | Caption & Footnote | FR-087 | The system shall present a caption and footnote form before an Entry is saved, pre-filled from the caption template. | v1 |
|  |  | FR-088 | The system shall treat caption and footnote as distinct fields, rendered in distinct positions by the Template. | v1 |
|  |  | FR-089 | The system shall allow the caption form to be skipped, saving the Entry with the expanded template caption only. | v1 |
|  |  | FR-090 | The system shall allow users to dictate caption and footnote text by voice where the browser supports speech recognition. | v1 |
|  |  | FR-091 | The system shall suggest completions for caption text from the captions previously used in the same Document. | v1 |
|  |  | FR-092 | The system shall record, at capture time, the timestamp, the capture device description and the originating user on every Entry. | v1 |
|  |  | FR-093 | The system shall optionally record capture location, only after separate explicit consent, and shall allow it to be switched off per Document. | v1 |
|  |  | FR-094 | The system shall allow users to assign tags to an individual Entry. | v1 |
|  |  | FR-095 | The system shall validate that required custom fields are filled before an Entry can be saved. | v1 |
|  |  | FR-096 | The system shall allow users to edit the caption, footnote, tags and custom fields of a saved Entry. | v1 |
| 11 | Entry Management | FR-097 | The system shall display a Document as a reorderable grid, list, or page preview of its Entries. | v1 |
|  |  | FR-098 | The system shall allow users to reorder Entries by drag and drop, and shall renumber figures accordingly. | v1 |
|  |  | FR-099 | The system shall allow users to insert a new capture at a chosen position rather than only at the end. | v1 |
|  |  | FR-100 | The system shall allow users to delete an Entry, with undo available immediately after the action. | v1 |
|  |  | FR-101 | The system shall allow users to duplicate an Entry. | v1 |
|  |  | FR-102 | The system shall allow users to replace the image of an Entry while keeping its caption, footnote and fields. | v1 |
|  |  | FR-103 | The system shall allow users to move or copy one or more Entries to another Document. | v1 |
|  |  | FR-104 | The system shall allow users to select multiple Entries and apply delete, move, copy or tag in bulk. | v1 |
|  |  | FR-105 | The system shall provide a full-screen viewer with pinch zoom and swipe between Entries. | v1 |
|  |  | FR-106 | The system shall display, per Entry, its sync state and whether OCR is pending, complete or unavailable. | v1 |
| 12 | Export, Print & Share | FR-107 | The system shall export a Document to PDF, laid out according to its Template. | v1 |
|  |  | FR-108 | The system shall export a Document to .docx, laid out according to its Template and remaining editable in a word processor. | v1 |
|  |  | FR-109 | The system shall allow the export scope to be the whole Document or only the selected Entries. | v1 |
|  |  | FR-110 | The system shall allow users to choose the image resolution used in an export, trading file size against quality. | v1 |
|  |  | FR-111 | The system shall offer to append a text appendix listing the OCR text of each Entry. | v1 |
|  |  | FR-112 | The system shall allow users to choose a filename pattern for exports, including document title and date tokens. | v1 |
|  |  | FR-113 | The system shall show export progress and allow the export to be cancelled. | v1 |
|  |  | FR-114 | The system shall offer the finished export to the operating system share sheet where supported, and shall always offer a direct download. | v1 |
|  |  | FR-115 | The system shall provide a print-optimised view of a Document. | v1 |
|  |  | FR-116 | The system shall refuse to start an export while any Entry image is still absent from the device, and shall say which Entries are missing. | v1 |
|  |  | FR-117 | The system shall record the last export format, scope and settings per Document and reuse them as defaults. | v1 |
| 13 | Offline & Sync | FR-118 | The system shall be installable as a PWA and shall prompt installation at an appropriate moment rather than on first load. | v1 |
|  |  | FR-119 | The system shall precache its application shell so that it launches with no network connection. | v1 |
|  |  | FR-120 | The system shall write every new or edited Entry to local storage first, and shall treat the local copy as authoritative until it is confirmed uploaded. | v1 |
|  |  | FR-121 | The system shall allow full capture, crop, OCR, caption and reorder while offline. | v1 |
|  |  | FR-122 | The system shall queue image uploads and Firestore writes while offline and shall drain the queue automatically when connectivity returns. | v1 |
|  |  | FR-123 | The system shall retry failed uploads with exponential backoff, shall surface a permanent failure to the user, and shall allow a manual retry. | v1 |
|  |  | FR-124 | The system shall display an offline indicator and a count of items pending upload. | v1 |
|  |  | FR-125 | The system shall never discard a locally held image until its upload has been confirmed. | v1 |
|  |  | FR-126 | The system shall compress images client-side before upload, to a configurable target, and shall generate a thumbnail for list views. | v1 |
|  |  | FR-127 | The system shall monitor the storage quota granted by the browser and shall warn the user before it is exhausted. | v1 |
|  |  | FR-128 | The system shall resolve concurrent edits to the same Entry field by last write wins, and shall never resolve a conflict by deleting an image. | v1 |
|  |  | FR-129 | The system shall detect a new application version and shall prompt the user to reload, rather than reloading underneath an in-progress capture. | v1 |
|  |  | FR-130 | The system shall allow the user to free local space by evicting already-uploaded images from the device cache. | v1 |
| 14 | Search & Discovery | FR-131 | The system shall provide a single search across Document titles, captions, footnotes, tags and OCR text. | v2 |
|  |  | FR-132 | The system shall allow search results to be filtered by date range, tag, Document and whether OCR text exists. | v2 |
|  |  | FR-133 | The system shall maintain a local search index so that search works offline over the data held on the device. | v2 |
|  |  | FR-134 | The system shall highlight the matched term in the result and shall open the matching Entry directly. | v2 |
|  |  | FR-135 | The system shall support searching within a single Document. | v2 |
| 15 | Settings & Preferences | FR-136 | The system shall allow users to select a theme and a high-contrast variant. | v1 |
|  |  | FR-137 | The system shall allow users to set defaults for capture quality, image compression, OCR languages and Template. | v1 |
|  |  | FR-138 | The system shall display current local storage usage, broken down by cached images and OCR language data, and allow each to be cleared. | v1 |
|  |  | FR-139 | The system shall allow users to set the date and time display format. | v1 |
|  |  | FR-140 | The system shall display the status of camera, microphone and location permissions, with guidance on changing a denied permission in the browser. | v1 |
|  |  | FR-141 | The system shall respect the operating system reduce-motion preference and shall allow the interface text size to be scaled. | v1 |
|  |  | FR-142 | The system shall be structured for localisation, with no user-facing string hard-coded in a component. | v1 |
| 16 | Notifications & Feedback | FR-143 | The system shall confirm every destructive or long-running action with a transient message, and shall offer undo where the action is reversible. | v1 |
|  |  | FR-144 | The system shall show a persistent banner while any item has permanently failed to sync. | v1 |
|  |  | FR-145 | The system shall notify the user when an export has finished while the app was in the background. | v2 |
|  |  | FR-146 | The system shall support push notification of Space invitations and shared-Document changes, where the platform permits it for an installed PWA. | v2 |
| 17 | Onboarding & Help | FR-147 | The system shall present a short first-run walkthrough of the capture-to-document flow, skippable and replayable from settings. | v1 |
|  |  | FR-148 | The system shall explain why camera access is needed before triggering the browser permission prompt. | v1 |
|  |  | FR-149 | The system shall present a purposeful empty state with a primary action on the Document list, inside an empty Document, and on an empty search. | v1 |
|  |  | FR-150 | The system shall display the application version and a link to report a problem. | v1 |
| 18 | Security & Data Governance | FR-151 | The system shall enforce access to every Firestore document and Storage object by Space membership and role, server-side, and shall not rely on the client for authorisation. | v1 |
|  |  | FR-152 | The system shall serve Entry images only through short-lived authorised URLs, with no publicly readable Storage path. | v1 |
|  |  | FR-153 | The system shall allow users to strip EXIF metadata, including any embedded location, from stored and exported images. | v2 |
|  |  | FR-154 | The system shall allow users to lock the app behind a device PIN or biometric check, requiring it after a configurable idle period. | v2 |
|  |  | FR-155 | The system shall allow a user to export all of their data, including original images, captions and OCR text, in a machine-readable archive. | v2 |
|  |  | FR-156 | The system shall limit the rate of invitation sends and authentication attempts per account. | v2 |
| 19 | Observability | FR-157 | The system shall report unhandled client errors, with no image content and no OCR text included in a report. | v2 |
|  |  | FR-158 | The system shall record anonymous counts of captures, OCR runs, exports and sync failures, to show where the flow breaks down. | v2 |
|  |  | FR-159 | The system shall allow the user to opt out of all analytics reporting. | v2 |

## 7. UX Flow

```
Splash / version check
  |
  +-- not signed in --> Login / Register / Reset password
  |
  v
Home  (recent Documents, Continue last Document, pending-sync badge)
  |
  +-- Space switcher (v2: team Spaces)
  |
  v
Document list  (sort, filter by tag, pinned first, Trash)
  |
  v
Document detail  (grid / list / page preview, reorder, select, Template, Export)
  |
  +--> Template editor  (live preview, save as Template)
  +--> Export  (format, scope, resolution, OCR appendix) --> share / download / print
  |
  v
CAPTURE  (live preview, detection overlay, torch, grid, session counter)
  |
  v
Crop & enhance  (auto quad, corner handles, rotate, filter, quality warning)
  |
  v
Review  (OCR text editable + confidence, caption, footnote, custom fields, tags)
  |
  +-- Save & next ---> back to CAPTURE   (capture session mode)
  +-- Save & done ---> back to Document detail
```

### Screen-by-screen offline behaviour and empty states

| Screen | Offline | Empty state |
| :---- | :---- | :---- |
| Login | Blocked — cached session continues to work, new sign-in requires network | n/a |
| Home | Full access to cached Documents; pending-sync badge visible | "No documents yet" + Create Document |
| Document list | Reads from local store; create/rename/delete all queue | "No documents yet" + Create Document |
| Document detail | Full access; Entries show per-Entry sync state | "No captures yet" + Open camera |
| Capture | Fully offline | n/a |
| Crop & enhance | Fully offline | n/a |
| Review (OCR) | Fully offline once the language pack is cached | OCR found no text → caption form still usable |
| Template editor | Fully offline, queues | Built-in Templates always present |
| Export | Fully offline, provided every image is on the device (FR-116) | Document with no Entries → export disabled with a reason |
| Search (v2) | Local index only, with a notice that results cover cached data | "No matches" + clear filters |

## 8. Database Design (Firestore)

The original draft proposed an `auth_provider` table. **It has been dropped:** Firebase Authentication already owns provider records, and duplicating them invites drift. Linked providers are kept as an array on the user document instead.

Collection paths are nested so that one security rule can cover a whole subtree:

```
users/{uid}
users/{uid}/settings/preferences
spaces/{spaceId}
spaces/{spaceId}/members/{uid}
spaces/{spaceId}/invites/{inviteId}
spaces/{spaceId}/templates/{templateId}
spaces/{spaceId}/folders/{folderId}
spaces/{spaceId}/documents/{documentId}
spaces/{spaceId}/documents/{documentId}/entries/{entryId}
spaces/{spaceId}/documents/{documentId}/entries/{entryId}/ocr/result
templates/{templateId}                      <- built-in, read-only
```

### 8.1 users

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| uid | string | PK, = Firebase Auth uid | Document ID |
| email | string | required, unique | From the auth provider |
| displayName | string | optional | Editable (FR-007) |
| photoURL | string | optional | Avatar |
| linkedProviders | array of string | required, min 1 | e.g. `["password","google.com"]` (FR-008) |
| defaultSpaceId | string | required, FK spaces | Personal Space created on first sign-in (FR-006) |
| emailVerified | boolean | required, default false | Mirrored from Auth for display (FR-005) |
| createdAt | timestamp | required, server time | |
| lastSeenAt | timestamp | required | Drives "Continue last Document" ordering |
| lastDocumentId | string | optional | FR-028 |
| analyticsOptOut | boolean | default false | FR-159 |

### 8.2 users/{uid}/settings/preferences

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| theme | string | enum: dark, highContrast | FR-136 |
| ocrLanguages | array of string | default `["eng"]` | Tesseract language codes (FR-070) |
| ocrEnabled | boolean | default true | FR-078 |
| captureQuality | string | enum: low, medium, high | FR-051 |
| compressionTarget | number | 0.3–1.0, default 0.8 | JPEG quality on upload (FR-126) |
| defaultTemplateId | string | FK templates | FR-137 |
| dateFormat | string | enum | FR-139 |
| locale | string | BCP-47, default device | FR-142 |
| textScale | number | 1.0–1.5 | FR-141 |
| captureLocationConsent | boolean | default false | FR-093 |
| appLockEnabled | boolean | default false | FR-154 (v2) |
| appLockIdleMinutes | number | default 5 | FR-154 (v2) |

### 8.3 spaces

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| spaceId | string | PK | Document ID |
| name | string | required | "My Lab", or the user name for a personal Space |
| type | string | enum: personal, team | A user has exactly one personal Space (FR-006, FR-013) |
| ownerUid | string | required, FK users | |
| documentCount | number | default 0 | Denormalised for FR-019 confirmation |
| createdAt | timestamp | required | |

### 8.4 spaces/{spaceId}/members

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| uid | string | PK, FK users | Document ID — makes the rule a single `get()` |
| role | string | enum: owner, editor, viewer | FR-015 |
| displayName | string | denormalised | Avoids an N+1 read on the member list |
| invitedBy | string | optional, FK users | |
| joinedAt | timestamp | required | |

### 8.5 spaces/{spaceId}/invites (v2)

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| inviteId | string | PK | |
| email | string | required, lowercased | FR-014 |
| role | string | enum: editor, viewer | Owners cannot be invited directly |
| token | string | required, unguessable | Carried in the emailed link (FR-016) |
| status | string | enum: pending, accepted, revoked, expired | |
| createdAt / expiresAt | timestamp | expiresAt = createdAt + 14 days | FR-016 |

### 8.6 templates

Built-in Templates live in the top-level `templates` collection and are read-only; user Templates live under their Space.

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| templateId | string | PK | |
| name | string | required | FR-040 |
| isBuiltIn | boolean | required | FR-039 |
| pageSize | string | enum: A4, Letter | FR-032 |
| orientation | string | enum: portrait, landscape | FR-032 |
| imagesPerPage | number | enum: 1, 2, 4, 6 | FR-033 |
| captionPosition | string | enum: above, below, right | FR-034 |
| numberingScheme | string | enum: figure, fig, plate, image, none | FR-035 |
| captionTemplate | string | optional | Token string, e.g. `Figure {index} - {ocr} ({date})` (FR-036) |
| headerText / footerText | string | optional | Support a `{page}` token (FR-037) |
| captionFont / bodyFont | string | enum of bundled families | FR-038 |
| captionFontSize / bodyFontSize | number | pt | FR-038 |
| customFields | array of object | `{key, label, type, required, choices[]}` | FR-042 |
| createdAt / updatedAt | timestamp | required | |

### 8.7 spaces/{spaceId}/documents

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| documentId | string | PK | |
| title | string | required | FR-020 |
| templateId | string | required, FK templates | FR-020, FR-041 |
| templateOverrides | map | optional | Per-Document deviation from the Template, so editing the Template does not silently reformat other Documents |
| folderId | string | optional, FK folders | FR-030 (v2) |
| tags | array of string | default `[]` | FR-026 — array-contains index |
| notes | string | optional | FR-029 |
| entryCount | number | default 0 | Denormalised, maintained in the same batch as an Entry write (FR-021) |
| nextOrder | number | default 0 | Monotonic allocator for Entry order |
| coverThumbPath | string | optional | Storage path of the first Entry thumbnail |
| status | string | enum: active, archived, trashed | FR-023, FR-031 |
| trashedAt | timestamp | optional | Purge trigger at +30 days (FR-024) |
| pinned | boolean | default false | FR-027 |
| ocrEnabled | boolean | default from settings | FR-078 |
| captureLocation | boolean | default false | FR-093 |
| lastExport | map | optional | `{format, scope, resolution, includeOcrAppendix, filenamePattern}` (FR-117) |
| createdBy | string | required, FK users | |
| createdAt / updatedAt | timestamp | required | FR-021 sort keys |

### 8.8 spaces/{spaceId}/documents/{documentId}/entries

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| entryId | string | PK, client-generated | Generated offline, so the local record and the synced record are the same identity (FR-120) |
| order | number | required | Sparse float ordering, so a drag writes one document, not the whole list (FR-098, FR-099) |
| figureNumber | number | derived | Recomputed from order on export (FR-035) |
| originalImagePath | string | required | Uncropped source, never overwritten (FR-065) |
| imagePath | string | required | Cropped, rectified, enhanced — the one that is exported |
| thumbPath | string | required | ~320 px, for lists (FR-126) |
| width / height | number | required | Of imagePath; lets the layout reserve space before load |
| byteSize | number | required | Feeds the quota display (FR-127) |
| cropQuad | array of 4 points | optional | Normalised corners, so a crop can be re-edited (FR-060) |
| rotation | number | degrees, default 0 | FR-062 |
| filter | string | enum: none, autoContrast, greyscale, bw | FR-063 |
| qualityFlags | array of string | e.g. `["blur","glare"]` | FR-064 |
| caption | string | optional | FR-087 |
| footnote | string | optional | FR-088 |
| tags | array of string | default `[]` | FR-094 |
| customFieldValues | map | keyed by Template field key | FR-042, FR-095 |
| barcode | map | optional, `{format, value}` | FR-080 (v2) |
| annotations | array of object | optional | Editable markup layer (FR-086, v2) |
| ocrState | string | enum: disabled, pending, done, failed, empty | FR-106 |
| ocrTextCache | string | optional, truncated | Denormalised for list display and search without reading the OCR subdocument |
| capturedAt | timestamp | required, client clock | The moment of the shot, not of the upload (FR-092) |
| capturedBy | string | required, FK users | FR-092 |
| deviceInfo | string | optional | Model / user-agent summary (FR-092) |
| geo | geopoint | optional | Only with consent (FR-093) |
| source | string | enum: camera, import | FR-046 |
| syncState | string | enum: local, uploading, synced, failed | Mirrored from the local queue (FR-106, FR-124) |
| updatedAt | timestamp | required | Last-write-wins comparison key (FR-128) |

### 8.9 .../entries/{entryId}/ocr/result

Kept as a subdocument because the block-level payload is large and is rarely needed in a list view.

| Field | Type | Constraint | Description |
| ----- | ----- | ----- | ----- |
| engine | string | required | e.g. `tesseract.js@5` |
| languages | array of string | required | FR-070 |
| rawText | string | required | Full recognised text |
| editedText | string | optional | User correction; exports prefer this (FR-072) |
| confidence | number | 0–100 | FR-073 |
| blocks | array of object | `{text, confidence, bbox}` | Enables region highlighting |
| region | array of 4 points | optional | Set when OCR ran on a selection (FR-074) |
| parsedFields | map | optional | Pattern extraction results (FR-076) |
| durationMs | number | optional | Feeds the performance budget |
| processedAt | timestamp | required | |

### 8.10 Firebase Storage layout

```
spaces/{spaceId}/documents/{documentId}/entries/{entryId}/original.jpg
spaces/{spaceId}/documents/{documentId}/entries/{entryId}/derived.jpg
spaces/{spaceId}/documents/{documentId}/entries/{entryId}/thumb.jpg
users/{uid}/avatar.jpg
```

The path mirrors the Firestore path so that a single Storage rule can authorise reads and writes with one `members/{uid}` lookup. No path is publicly readable (FR-152).

### 8.11 Security rule shape

Every read and write under `spaces/{spaceId}/**` resolves to one membership lookup:

```
function member(spaceId)  { return get(/databases/$(db)/documents/spaces/$(spaceId)/members/$(request.auth.uid)); }
function isMember(spaceId) { return request.auth != null && exists(<that path>); }
function canWrite(spaceId) { return isMember(spaceId) && member(spaceId).data.role in ['owner','editor']; }
```

Documents and Entries are readable by any member and writable by owner/editor only; `spaces/{spaceId}` itself is writable by owner only; `users/{uid}/**` is readable and writable by that uid alone. Because membership is a document and not a field on the user, adding a member never requires rewriting the member's own record.

### 8.12 Local (IndexedDB) stores — client-side only

These are not Firestore collections. They are what makes the app usable at the bench.

| Store | Key | Contents | Purpose |
| ----- | ----- | ----- | ----- |
| `image_blobs` | `{entryId}:{variant}` | Blob | Original / derived / thumb held locally until upload is confirmed, and as the offline read cache (FR-120, FR-125, FR-130) |
| `pending_ops` | auto-increment | `{type, path, payload, attempts, nextAttemptAt, lastError}` | The write and upload queue, drained on reconnect with backoff (FR-122, FR-123) |
| `entry_mirror` | entryId | Entry record | Local-first copy so a Document opens with no network (FR-121) |
| `search_index` | term | Posting list over titles, captions, footnotes, tags, OCR text | Offline search (FR-133, v2) |
| `ocr_lang_cache` | language code | Tesseract traineddata | Avoids re-downloading ~10–15 MB per language (FR-070, FR-138) |

## 9. Non-Functional Requirements

### 9.1 Platform constraints that shape the architecture

These are the ones that cost real rework if discovered late. iOS Safari is the binding constraint on almost every one.

| ID | Constraint | Consequence for the design |
| :---- | :---- | :---- |
| NFR-01 | `getUserMedia` requires a secure context and, on iOS, a user gesture | The camera cannot auto-start on route entry. The capture screen must open behind an explicit "Open camera" action, which also gives FR-148 its natural home. |
| NFR-02 | iOS Safari does not implement the Background Sync API | The upload queue must drain in the foreground on `online` and `visibilitychange`, not via `sync` events. Background Sync may be used as an enhancement where present, never as the only path (FR-122). |
| NFR-03 | Browsers evict storage for non-installed sites, and iOS does so aggressively after ~7 days unused | Unsynced captures are at risk on an uninstalled PWA. Hence the install prompt (FR-118), the quota warning (FR-127), and never discarding a local image before upload confirmation (FR-125). |
| NFR-04 | `ImageCapture`, torch and zoom constraints are unavailable or partial on iOS | Torch, zoom and focus (FR-048, FR-049) must be capability-detected and hidden when absent, with a canvas grab from the video element as the universal capture path. |
| NFR-05 | Tesseract.js language data is ~10–15 MB per language, WASM ~2–4 MB | Load lazily, cache in IndexedDB, warn on metered connections (FR-070, FR-071). |
| NFR-06 | OCR on a mid-range phone takes roughly 2–5 s per image | OCR must run in a Worker and must never gate the shutter; the Entry saves first and OCR attaches on completion (FR-067, FR-069). |
| NFR-07 | Web Speech API is absent or unreliable on several mobile browsers | Voice dictation (FR-090) is an enhancement; the text field is always usable. |
| NFR-08 | Push notification on iOS requires an installed PWA on iOS 16.4+ | FR-146 is v2 and must degrade silently. |
| NFR-09 | Safari requires a user gesture close to a programmatic download | Export completion must present a visible "Save / Share" action rather than triggering a download from an async callback (FR-114). |
| NFR-10 | Client-side .docx and PDF generation runs in the tab | Large Documents must be rendered in chunks with progress and cancellation (FR-113); a server-side path is held in reserve behind the same interface. |

### 9.2 Performance

| ID | Target |
| :---- | :---- |
| NFR-11 | App shell interactive within 2.5 s on a mid-range phone over 4G; within 1 s when installed and offline. |
| NFR-12 | Shutter to live preview resumed, in capture session mode: under 400 ms. Crop and enhancement must not block the shutter. |
| NFR-13 | Document detail with 200 Entries scrolls at 60 fps, using thumbnails and virtualised lists. |
| NFR-14 | A 40-Entry Document exports to PDF in under 20 s, with progress shown throughout. |
| NFR-15 | A capture occupies no more than ~2.5 MB of local storage across its three variants at default quality. |

### 9.3 Compatibility, accessibility, cost

| ID | Requirement |
| :---- | :---- |
| NFR-16 | Supported: iOS Safari 16.4+, Chrome/Edge Android 110+, Chrome/Edge/Firefox desktop current-1, Safari macOS 16.4+. Below these, the app loads in import-only mode rather than failing. |
| NFR-17 | Primary layout is a one-handed phone portrait layout; tablet and desktop widths get a two-pane Document view. Camera controls stay within thumb reach. |
| NFR-18 | WCAG 2.1 AA: every control reachable by keyboard, visible focus ring, 44×44 px minimum touch targets, labelled form fields, and the contrast floors in section 10. |
| NFR-19 | Firestore reads are kept down by the denormalised `entryCount`, `coverThumbPath` and `ocrTextCache` fields; thumbnails rather than full images are used in every list, because Storage egress is the dominant running cost of an image-heavy app. |
| NFR-20 | No image content, OCR text, caption or email address is sent to any error-reporting or analytics service (FR-157). |

## 10. Theme — Futuristic

The three brand colours are the foundation, but a dark interface needs surface elevations, borders, states and status colours. The tokens below are derived from them.

**Brand:** Raven Black `#080402` · Powder Blue `#B6DFF5` · Poppy Red `#E0091F`

| Token | Hex | Role | Contrast on base |
| :---- | :---- | :---- | :---- |
| `--bg` | `#080402` | App background (Raven Black) | — |
| `--surface` | `#12100E` | Cards, list rows | — |
| `--surface-raised` | `#1C1917` | Sheets, menus, camera control bar | — |
| `--overlay` | `rgba(8,4,2,0.72)` | Scrim behind modals, camera overlay | — |
| `--border` | `#2A2724` | Hairlines, dividers | — |
| `--border-strong` | `#3D3935` | Input outlines, selected cards | — |
| `--text-primary` | `#F2F7FA` | Body and headings | ~18:1 |
| `--text-secondary` | `#9FB3BF` | Metadata, timestamps, helper text | ~9.4:1 |
| `--text-disabled` | `#5C666C` | Disabled labels only | ~3.5:1 (exempt) |
| `--accent` | `#B6DFF5` | Primary action, active state, detection overlay (Powder Blue) | ~13.9:1 |
| `--accent-muted` | `#44606E` | Accent fills behind text, inactive tabs | — |
| `--on-accent` | `#080402` | Text on an accent-filled button | ~13.9:1 |
| `--focus-ring` | `#B6DFF5` | 2 px ring, 2 px offset, never removed | — |
| `--danger` | `#E0091F` | Destructive fills, large labels, icons (Poppy Red) | **~4.1:1** |
| `--danger-text` | `#FF6B7A` | Destructive text at body size | ~7.4:1 |
| `--success` | `#3ED598` | Synced, OCR complete | ~10.9:1 |
| `--warning` | `#FFC24B` | Quality warning, quota warning, pending sync | ~12.7:1 |

**Contrast caveat on Poppy Red.** `#E0091F` on `#080402` computes to roughly **4.1:1** — below the WCAG AA floor of 4.5:1 for normal-size text, and only just above the 3:1 floor for large text and UI components. Therefore: use `--danger` for fills, icons and 18 pt+ labels, and `--danger-text` (`#FF6B7A`) wherever destructive wording appears at body size. This keeps the brand accent visible without failing NFR-18.

Semantic status colours are never used alone: each pairs with an icon or text label, so the interface still reads under colour-vision deficiency.

## 11. Open Questions

| # | Question | Why it matters |
| :---- | :---- | :---- |
| Q1 | Do exports need to append to an existing Word file, or is generating a fresh .docx per export sufficient? | Appending to a user-supplied template .docx is substantially more work than generating one, and it changes the Template model. |
| Q2 | How many Entries will a realistic Document hold — 20, or 500? | Sets whether client-side export and the local store are viable, or whether a Cloud Function render path is needed from the start (NFR-10, NFR-14). |
| Q3 | Which languages and scripts appear on the labels being scanned? | Each added OCR language costs ~10–15 MB of cached data and some accuracy (NFR-05). |
| Q4 | Are the field patterns in FR-076 (lot, batch, expiry, CAS) the right set, and are there house formats for sample IDs? | Determines whether pattern extraction is a shipped default or a user-editable rule list. |
| Q5 | Is the Google Drive / cloud-drive export target wanted later? | It was offered and not selected; noting it here so the export module keeps its output path pluggable. |
| Q6 | Should basic search (FR-131, FR-135) be pulled into v1? | As scoped, v1 has no search whatsoever. That is fine at 10 Documents and painful at 100 — and "find the label where I wrote the lot number" is exactly the thing OCR makes possible. Pulling a title/caption/OCR-text search into v1 is roughly a day of work on top of the local store that v1 already needs; full filters and the offline index can stay in v2. |
