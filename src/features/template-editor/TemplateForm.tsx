import { useTranslation } from 'react-i18next';
import type {
  CaptionPosition,
  CustomField,
  CustomFieldType,
  FontFamily,
  ImagesPerPage,
  NumberingScheme,
  Orientation,
  PageSize,
  TemplateSettings,
} from '../../data/types';
import { FIELD_PRESETS, fieldKeyFromLabel } from '../../lib/templates/builtins';
import { Button, IconButton, Segmented, SelectField, Switch, TextField } from '../../components/ui';

const FONTS: FontFamily[] = ['Helvetica', 'Times', 'Courier'];
const SIZES = [7, 8, 9, 10, 11, 12, 14];

export function TemplateForm({
  value,
  onChange,
  readOnly,
}: {
  value: TemplateSettings;
  onChange: (patch: Partial<TemplateSettings>) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const set = <K extends keyof TemplateSettings>(k: K, v: TemplateSettings[K]) => onChange({ [k]: v } as Partial<TemplateSettings>);
  const fieldKeys = value.customFields.map((f) => f.key);
  const tokens = ['index', 'date', 'time', 'ocr', 'document', ...fieldKeys];

  const updateField = (i: number, patch: Partial<CustomField>) =>
    set(
      'customFields',
      value.customFields.map((f, k) => (k === i ? { ...f, ...patch } : f)),
    );

  return (
    <fieldset disabled={readOnly} className="col gap-16" style={{ border: 'none', padding: 0, margin: 0 }}>
      <div className="field">
        <span className="field-label">{t('templates.form.page')}</span>
        <div className="row wrap">
          <Segmented<PageSize>
            label={t('templates.form.pageSize')}
            value={value.pageSize}
            onChange={(v) => set('pageSize', v)}
            options={[
              { value: 'A4', label: 'A4' },
              { value: 'Letter', label: t('templates.form.letter') },
            ]}
          />
          <Segmented<Orientation>
            label={t('templates.form.orientation')}
            value={value.orientation}
            onChange={(v) => set('orientation', v)}
            options={[
              { value: 'portrait', label: t('templates.orientation.portrait') },
              { value: 'landscape', label: t('templates.orientation.landscape') },
            ]}
          />
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t('templates.form.perPage')}</span>
        <Segmented<ImagesPerPage>
          label={t('templates.form.perPage')}
          value={value.imagesPerPage}
          onChange={(v) => set('imagesPerPage', v)}
          options={[1, 2, 4, 6].map((n) => ({ value: n as ImagesPerPage, label: String(n) }))}
        />
      </div>
      <div className="field">
        <span className="field-label">{t('templates.form.captionPosition')}</span>
        <Segmented<CaptionPosition>
          label={t('templates.form.captionPosition')}
          value={value.captionPosition}
          onChange={(v) => set('captionPosition', v)}
          options={[
            { value: 'above', label: t('templates.position.above') },
            { value: 'below', label: t('templates.position.below') },
            { value: 'right', label: t('templates.position.right') },
          ]}
        />
      </div>
      <SelectField
        label={t('templates.form.numbering')}
        value={value.numberingScheme}
        onChange={(v) => set('numberingScheme', v as NumberingScheme)}
        options={(['figure', 'fig', 'plate', 'image', 'none'] as NumberingScheme[]).map((n) => ({
          value: n,
          label: t(`templates.numbering.${n}`),
        }))}
      />
      <div className="field">
        <TextField
          label={t('templates.form.captionTemplate')}
          value={value.captionTemplate}
          className="input mono"
          onChange={(e) => set('captionTemplate', e.target.value)}
          hint={t('templates.form.captionTemplateHint')}
        />
        <div className="row wrap gap-4" aria-label={t('templates.form.insertToken')}>
          {tokens.map((tok) => (
            <button
              key={tok}
              type="button"
              className="chip chip-filter mono"
              onClick={() => set('captionTemplate', `${value.captionTemplate}${value.captionTemplate.endsWith(' ') || !value.captionTemplate ? '' : ' '}{${tok}}`)}
            >
              {`{${tok}}`}
            </button>
          ))}
        </div>
      </div>
      <TextField
        label={t('templates.form.header')}
        value={value.headerText}
        onChange={(e) => set('headerText', e.target.value)}
        hint={t('templates.form.bandHint')}
      />
      <TextField
        label={t('templates.form.footer')}
        value={value.footerText}
        onChange={(e) => set('footerText', e.target.value)}
        hint={t('templates.form.bandHint')}
      />
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 140 }}>
          <SelectField
            label={t('templates.form.captionFont')}
            value={value.captionFont}
            onChange={(v) => set('captionFont', v as FontFamily)}
            options={FONTS.map((f) => ({ value: f, label: f }))}
          />
        </div>
        <div style={{ width: 96 }}>
          <SelectField
            label={t('templates.form.size')}
            value={String(value.captionFontSize)}
            onChange={(v) => set('captionFontSize', Number(v))}
            options={SIZES.map((s) => ({ value: String(s), label: `${s} pt` }))}
          />
        </div>
      </div>
      <div className="row wrap">
        <div className="grow" style={{ minWidth: 140 }}>
          <SelectField
            label={t('templates.form.bodyFont')}
            value={value.bodyFont}
            onChange={(v) => set('bodyFont', v as FontFamily)}
            options={FONTS.map((f) => ({ value: f, label: f }))}
          />
        </div>
        <div style={{ width: 96 }}>
          <SelectField
            label={t('templates.form.size')}
            value={String(value.bodyFontSize)}
            onChange={(v) => set('bodyFontSize', Number(v))}
            options={SIZES.map((s) => ({ value: String(s), label: `${s} pt` }))}
          />
        </div>
      </div>

      <section className="col gap-12">
        <div>
          <h2 className="h3">{t('templates.fields.title')}</h2>
          <p className="meta">{t('templates.fields.hint')}</p>
        </div>
        {value.customFields.map((f, i) => (
          <div key={f.key} className="card card-pad col gap-12">
            <div className="row">
              <div className="grow">
                <TextField label={t('templates.fields.label')} value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} />
              </div>
              <IconButton
                icon="trash"
                label={t('templates.fields.remove', { label: f.label })}
                onClick={() => set('customFields', value.customFields.filter((_, k) => k !== i))}
              />
            </div>
            <div className="row wrap">
              <div style={{ minWidth: 130 }}>
                <SelectField
                  label={t('templates.fields.type')}
                  value={f.type}
                  onChange={(v) => updateField(i, { type: v as CustomFieldType })}
                  options={(['text', 'number', 'date', 'choice'] as CustomFieldType[]).map((ty) => ({
                    value: ty,
                    label: t(`templates.fields.types.${ty}`),
                  }))}
                />
              </div>
              <label className="row" style={{ fontSize: '0.875rem' }}>
                <Switch label={t('templates.fields.required')} checked={f.required} onChange={(v) => updateField(i, { required: v })} />
                {t('templates.fields.required')}
              </label>
              <span className="meta mono">{`{${f.key}}`}</span>
              {f.ocrPattern && <span className="chip chip-accent">{t('templates.fields.fromOcr')}</span>}
            </div>
            {f.type === 'choice' && (
              <TextField
                label={t('templates.fields.choices')}
                value={(f.choices ?? []).join(', ')}
                onChange={(e) =>
                  updateField(i, {
                    choices: e.target.value
                      .split(',')
                      .map((c) => c.trim())
                      .filter(Boolean),
                  })
                }
                hint={t('templates.fields.choicesHint')}
              />
            )}
          </div>
        ))}
        <div className="row wrap">
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              const label = t('templates.fields.newLabel');
              set('customFields', [
                ...value.customFields,
                { key: fieldKeyFromLabel(label, fieldKeys), label, type: 'text', required: false },
              ]);
            }}
          >
            {t('templates.fields.add')}
          </Button>
          {FIELD_PRESETS.filter((p) => !value.customFields.some((f) => f.ocrPattern === p.pattern)).map((p) => (
            <Button
              key={p.pattern}
              size="sm"
              variant="ghost"
              icon="plus"
              onClick={() =>
                set('customFields', [
                  ...value.customFields,
                  {
                    ...p.field,
                    label: t(`templates.presets.${p.pattern}`),
                    key: fieldKeyFromLabel(p.field.key, fieldKeys),
                  },
                ])
              }
            >
              {t(`templates.presets.${p.pattern}`)}
            </Button>
          ))}
        </div>
      </section>
    </fieldset>
  );
}
