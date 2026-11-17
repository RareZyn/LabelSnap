import type { CustomField, DocumentRec, FieldPatternKey, Template, TemplateSettings } from '../../data/types';

const base: TemplateSettings = {
  pageSize: 'A4',
  orientation: 'portrait',
  imagesPerPage: 2,
  captionPosition: 'below',
  numberingScheme: 'figure',
  captionTemplate: '{ocr} ({date})',
  headerText: '{document}',
  footerText: 'Page {page} of {pages}',
  captionFont: 'Helvetica',
  bodyFont: 'Helvetica',
  captionFontSize: 10,
  bodyFontSize: 9,
  customFields: [],
};

export const BUILT_IN_TEMPLATES: Template[] = [
  {
    ...base,
    id: 'builtin-single',
    name: 'Single large image',
    isBuiltIn: true,
    imagesPerPage: 1,
    captionFontSize: 11,
    bodyFontSize: 10,
  },
  {
    ...base,
    id: 'builtin-two-up',
    name: 'Two-up with captions',
    isBuiltIn: true,
    imagesPerPage: 2,
  },
  {
    ...base,
    id: 'builtin-contact',
    name: 'Four-up contact sheet',
    isBuiltIn: true,
    imagesPerPage: 4,
    numberingScheme: 'fig',
    captionFontSize: 8,
    bodyFontSize: 7,
  },
];

export const DEFAULT_TEMPLATE_ID = 'builtin-two-up';

export function isBuiltInTemplateId(id: string): boolean {
  return BUILT_IN_TEMPLATES.some((t) => t.id === id);
}

export function findTemplate(templates: Template[], id: string | undefined): Template {
  return (
    templates.find((t) => t.id === id) ??
    BUILT_IN_TEMPLATES.find((t) => t.id === id) ??
    BUILT_IN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!
  );
}

/** The effective format of a Document: its Template with the Document's own overrides applied. */
export function resolveTemplate(doc: Pick<DocumentRec, 'templateId' | 'templateOverrides'>, templates: Template[]): Template {
  const tpl = findTemplate(templates, doc.templateId);
  const overrides = doc.templateOverrides ?? {};
  return { ...tpl, ...overrides, customFields: overrides.customFields ?? tpl.customFields };
}

export function settingsOf(t: TemplateSettings): TemplateSettings {
  return {
    pageSize: t.pageSize,
    orientation: t.orientation,
    imagesPerPage: t.imagesPerPage,
    captionPosition: t.captionPosition,
    numberingScheme: t.numberingScheme,
    captionTemplate: t.captionTemplate,
    headerText: t.headerText,
    footerText: t.footerText,
    captionFont: t.captionFont,
    bodyFont: t.bodyFont,
    captionFontSize: t.captionFontSize,
    bodyFontSize: t.bodyFontSize,
    customFields: t.customFields,
  };
}

/** Preset custom fields that OCR pattern extraction can fill. Labels are i18n keys. */
export const FIELD_PRESETS: Array<{ pattern: FieldPatternKey; field: CustomField }> = [
  { pattern: 'lot', field: { key: 'lot', label: 'Lot number', type: 'text', required: false, ocrPattern: 'lot' } },
  { pattern: 'batch', field: { key: 'batch', label: 'Batch', type: 'text', required: false, ocrPattern: 'batch' } },
  { pattern: 'expiry', field: { key: 'expiry', label: 'Expiry date', type: 'date', required: false, ocrPattern: 'expiry' } },
  {
    pattern: 'catalogue',
    field: { key: 'catalogue', label: 'Catalogue no.', type: 'text', required: false, ocrPattern: 'catalogue' },
  },
  { pattern: 'cas', field: { key: 'cas', label: 'CAS number', type: 'text', required: false, ocrPattern: 'cas' } },
];

/** A field key that is safe to use as a caption token and a Firestore map key. */
export function fieldKeyFromLabel(label: string, existing: string[]): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'field';
  let key = base;
  let n = 2;
  while (existing.includes(key)) key = `${base}_${n++}`;
  return key;
}
