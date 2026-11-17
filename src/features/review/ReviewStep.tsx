import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomField, DocumentRec, OcrState, Quad, Template } from '../../data/types';
import type { OcrOutput } from '../../lib/ocr/ocrService';
import { expandTokens } from '../../lib/templates/tokens';
import { fieldsFromOcr } from '../../data/entries';
import { useFormat } from '../../hooks/useFormat';
import { Button, IconButton } from '../../components/ui';
import { TagEditor } from '../../components/TagEditor';
import { CaptionFields, CustomFieldsForm, OcrPanel, RegionSelector, useOcrRun, validateFields } from './reviewParts';
import type { CropResult } from '../crop/CropStep';

export interface ReviewData {
  caption: string;
  footnote: string;
  tags: string[];
  fields: Record<string, string>;
  ocr: OcrOutput | null;
  ocrPromise: Promise<OcrOutput> | null;
  ocrEditedText: string | null;
  ocrRegion: Quad | null;
  ocrState: OcrState;
}

export function defaultCaption(
  template: Template,
  ctx: { index: number; date: string; time: string; ocr?: string; document: string; fields: Record<string, string> },
): string {
  return expandTokens(template.captionTemplate, ctx);
}

export function ReviewStep({
  doc,
  template,
  processed,
  capturedAt,
  figureNumber,
  figureText,
  captionSuggestions,
  tagSuggestions,
  ocrEnabled,
  languages,
  onBack,
  onSave,
  saving,
}: {
  doc: DocumentRec;
  template: Template;
  processed: CropResult;
  capturedAt: Date;
  figureNumber: number;
  figureText: string;
  captionSuggestions: string[];
  tagSuggestions: string[];
  ocrEnabled: boolean;
  languages: string[];
  onBack: () => void;
  onSave: (kind: 'next' | 'done' | 'skip', data: ReviewData) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const ocr = useOcrRun(processed.derived, ocrEnabled, languages);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  const [footnote, setFootnote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fromOcr, setFromOcr] = useState<Set<string>>(new Set());
  const [editedText, setEditedText] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [regionMode, setRegionMode] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(processed.derived);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [processed.derived]);

  const ocrText = editedText ?? ocr.output?.text ?? '';

  // Fill empty pattern-mapped fields from OCR as soon as text arrives.
  useEffect(() => {
    if (!ocr.output) return;
    const fill = fieldsFromOcr(ocrText, template.customFields, fields);
    if (Object.keys(fill).length) {
      setFields((f) => ({ ...f, ...fill }));
      setFromOcr((s) => new Set([...s, ...Object.keys(fill)]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocr.output, editedText]);

  const expanded = useMemo(
    () =>
      defaultCaption(template, {
        index: figureNumber,
        date: fmt.date(capturedAt),
        time: fmt.time(capturedAt),
        ocr: ocrText,
        document: doc.title,
        fields,
      }),
    [template, figureNumber, fmt, capturedAt, ocrText, doc.title, fields],
  );

  // The caption follows the Template until the user types in it.
  useEffect(() => {
    if (!captionTouched) setCaption(expanded);
  }, [expanded, captionTouched]);

  const data = (): ReviewData => ({
    caption,
    footnote,
    tags,
    fields,
    ocr: ocr.output,
    ocrPromise: ocr.status === 'running' ? ocr.promise : null,
    ocrEditedText: editedText,
    ocrRegion: ocr.region,
    ocrState: !ocrEnabled ? 'disabled' : ocr.status === 'running' ? 'pending' : ocr.status === 'failed' ? 'failed' : ocr.output ? (ocr.output.text ? 'done' : 'empty') : 'disabled',
  });

  const save = (kind: 'next' | 'done' | 'skip') => {
    const errs = validateFields(template.customFields, fields);
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(`field-${Object.keys(errs)[0]}`)?.focus();
      return;
    }
    const d = data();
    onSave(kind, kind === 'skip' ? { ...d, caption: expanded, footnote: '' } : d);
  };

  const setField = (key: string, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    setFromOcr((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  };

  const hasRequired = template.customFields.some((f: CustomField) => f.required);

  return (
    <>
      <div className="topbar">
        <IconButton icon="back" label={t('review.backToCrop')} onClick={onBack} />
        <h1 className="topbar-title">{t('review.title', { figure: figureText })}</h1>
        <Button variant="ghost" size="sm" onClick={() => save('skip')} disabled={saving}>
          {t('review.skip')}
        </Button>
      </div>
      <div className="step-layout two-col">
        <div className="step-visual">
          <div className="crop-stage" style={{ minHeight: 160, flex: 'none', padding: 8 }}>
            {imageUrl &&
              (regionMode ? (
                <RegionSelector
                  imageUrl={imageUrl}
                  naturalWidth={processed.width}
                  naturalHeight={processed.height}
                  alt={t('review.imageAlt')}
                  onSelect={(rect, quad) => {
                    setRegionMode(false);
                    setEditedText(null);
                    ocr.run({ rect, region: quad });
                  }}
                />
              ) : (
                <img src={imageUrl} alt={t('review.imageAlt')} style={{ maxHeight: 'min(40dvh, 480px)' }} />
              ))}
          </div>
          {regionMode && <p className="meta">{t('ocr.regionHint')}</p>}
          <p className="meta">
            {t(`crop.filters.${processed.filter}`)}
            {processed.report.flags.length > 0 && ` · ${processed.report.flags.map((f) => t(`quality.short.${f}`)).join(', ')}`}
          </p>
        </div>
        <div className="col gap-12">
          <OcrPanel
            status={ocr.status}
            progress={ocr.progress}
            text={ocr.output?.text ?? ''}
            rawText={ocr.output?.text ?? ''}
            words={ocr.output?.words ?? []}
            confidence={ocr.output?.confidence ?? null}
            downloadNote={ocr.downloadNote}
            editedText={editedText}
            onEdit={setEditedText}
            onConfirmDownload={ocr.confirmDownload}
            onRun={() => ocr.run({ force: true })}
            onSelectRegion={() => setRegionMode((v) => !v)}
            regionActive={regionMode}
            languages={languages}
          />
          <CaptionFields
            caption={caption}
            footnote={footnote}
            onCaption={(v) => {
              setCaption(v);
              setCaptionTouched(true);
            }}
            onFootnote={setFootnote}
            suggestions={captionSuggestions}
          />
          <CustomFieldsForm fields={template.customFields} values={fields} onChange={setField} errors={errors} fromOcr={fromOcr} />
          <TagEditor tags={tags} onChange={setTags} suggestions={tagSuggestions} />
          {hasRequired && <p className="meta">{t('review.requiredNote')}</p>}
        </div>
      </div>
      <div className="step-footer">
        <Button onClick={() => save('done')} disabled={saving}>
          {t('review.saveDone')}
        </Button>
        <Button variant="primary" onClick={() => save('next')} busy={saving}>
          {t('review.saveNext')}
        </Button>
      </div>
    </>
  );
}
