import type { GeoPoint, Timestamp } from 'firebase/firestore';

export type Role = 'owner' | 'editor' | 'viewer';
export type SpaceType = 'personal' | 'team';

export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  linkedProviders: string[];
  defaultSpaceId: string;
  emailVerified: boolean;
  createdAt?: Timestamp;
  lastSeenAt?: Timestamp;
  lastDocumentId?: string;
  analyticsOptOut?: boolean;
}

export interface Space {
  id: string;
  name: string;
  type: SpaceType;
  ownerUid: string;
  documentCount: number;
  createdAt?: Timestamp;
}

export type PageSize = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
export type ImagesPerPage = 1 | 2 | 4 | 6;
export type CaptionPosition = 'above' | 'below' | 'right';
export type NumberingScheme = 'figure' | 'fig' | 'plate' | 'image' | 'none';
export type FontFamily = 'Helvetica' | 'Times' | 'Courier';
export type CustomFieldType = 'text' | 'number' | 'date' | 'choice';
export type FieldPatternKey = 'lot' | 'batch' | 'expiry' | 'catalogue' | 'cas';

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  choices?: string[];
  /** When set, OCR pattern extraction fills this field. */
  ocrPattern?: FieldPatternKey;
}

export interface TemplateSettings {
  pageSize: PageSize;
  orientation: Orientation;
  imagesPerPage: ImagesPerPage;
  captionPosition: CaptionPosition;
  numberingScheme: NumberingScheme;
  captionTemplate: string;
  headerText: string;
  footerText: string;
  captionFont: FontFamily;
  bodyFont: FontFamily;
  captionFontSize: number;
  bodyFontSize: number;
  customFields: CustomField[];
}

export interface Template extends TemplateSettings {
  id: string;
  name: string;
  isBuiltIn: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type DocumentStatus = 'active' | 'archived' | 'trashed';
export type ExportFormat = 'pdf' | 'docx';
export type ExportResolution = 'low' | 'medium' | 'high';

export interface LastExport {
  format: ExportFormat;
  scope: 'all' | 'selected';
  resolution: ExportResolution;
  includeOcrAppendix: boolean;
  filenamePattern: string;
}

export interface DocumentRec {
  id: string;
  spaceId: string;
  title: string;
  templateId: string;
  templateOverrides?: Partial<TemplateSettings>;
  folderId?: string;
  tags: string[];
  notes: string;
  entryCount: number;
  nextOrder: number;
  coverEntryId?: string;
  coverThumbPath?: string;
  status: DocumentStatus;
  trashedAt?: Timestamp | null;
  pinned: boolean;
  ocrEnabled: boolean;
  captureLocation: boolean;
  lastExport?: LastExport;
  driveFolderId?: string;
  createdBy: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Point {
  x: number;
  y: number;
}

/** Four corners, normalised 0–1, in order top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export type ImageFilter = 'none' | 'autoContrast' | 'greyscale' | 'bw';
export type QualityFlag = 'blur' | 'dark' | 'glare';
export type OcrState = 'disabled' | 'pending' | 'done' | 'failed' | 'empty';
export type SyncState = 'local' | 'uploading' | 'synced' | 'failed';
export type ImageVariant = 'original' | 'derived' | 'thumb';

export interface Entry {
  id: string;
  spaceId: string;
  documentId: string;
  order: number;
  /** Google Drive file ids. Empty until the upload is confirmed. */
  originalImagePath: string;
  imagePath: string;
  thumbPath: string;
  imageStorage: 'gdrive';
  width: number;
  height: number;
  byteSize: number;
  cropQuad?: Quad | null;
  rotation: number;
  straighten: number;
  filter: ImageFilter;
  qualityFlags: QualityFlag[];
  caption: string;
  footnote: string;
  tags: string[];
  customFieldValues: Record<string, string>;
  ocrState: OcrState;
  ocrTextCache: string;
  ocrConfidence?: number | null;
  ocrLanguages?: string[];
  capturedAt: Timestamp;
  capturedBy: string;
  deviceInfo: string;
  geo?: GeoPoint | null;
  source: 'camera' | 'import';
  syncState: SyncState;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrBlock {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  engine: string;
  languages: string[];
  rawText: string;
  editedText?: string | null;
  confidence: number;
  blocks: OcrBlock[];
  words?: OcrWord[];
  region?: Quad | null;
  parsedFields?: Partial<Record<FieldPatternKey, string>>;
  durationMs?: number;
  processedAt?: Timestamp;
}

export type ThemeName = 'light' | 'highContrast';
export type CaptureQuality = 'low' | 'medium' | 'high';
export type DateFormat = 'iso' | 'dmy' | 'mdy' | 'long';

export interface Preferences {
  theme: ThemeName;
  ocrLanguages: string[];
  ocrEnabled: boolean;
  captureQuality: CaptureQuality;
  compressionTarget: number;
  defaultTemplateId: string;
  dateFormat: DateFormat;
  timeFormat24h: boolean;
  locale: string;
  textScale: number;
  captureLocationConsent: boolean;
  analyticsOptOut: boolean;
  onboardingDone: boolean;
  driveRootFolderId?: string;
  driveAccountEmail?: string;
  showGrid: boolean;
  autoDetect: boolean;
}
