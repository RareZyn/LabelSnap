import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from './ui';

export function normaliseTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  label,
  hideLabel,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  label?: string;
  hideLabel?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const id = useId();
  const listId = `${id}-list`;
  const add = (raw: string) => {
    const tag = normaliseTag(raw);
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft('');
  };
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label ?? t('tags.label')}
      </label>
      <div className="row wrap gap-4">
        {tags.map((tag) => (
          <Chip key={tag} onRemove={() => onChange(tags.filter((x) => x !== tag))} removeLabel={t('tags.remove', { tag })}>
            {tag}
          </Chip>
        ))}
        <input
          id={id}
          className="input"
          style={{ flex: 1, minWidth: 120, minHeight: 36 }}
          value={draft}
          list={suggestions.length ? listId : undefined}
          placeholder={t('tags.addPlaceholder')}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions
              .filter((s) => !tags.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        )}
      </div>
    </div>
  );
}
