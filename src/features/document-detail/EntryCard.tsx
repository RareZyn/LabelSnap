import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EntryView } from '../../data/entries';
import type { SyncState } from '../../data/types';
import { useEntryImage } from '../../lib/images';
import { Icon } from '../../components/Icon';
import { OcrBadge, SyncBadge } from '../../components/feedback';

export function EntryThumb({ entry, className }: { entry: EntryView; className?: string }) {
  const { url, state } = useEntryImage(entry, 'thumb');
  return (
    <div className={className ?? 'thumb'}>
      {url ? (
        <img src={url} alt="" loading="lazy" draggable={false} />
      ) : (
        <Icon name={state === 'loading' ? 'image' : 'cloudOff'} size={22} strokeWidth={1.4} />
      )}
    </div>
  );
}

export function SortableEntryCard(props: {
  entry: EntryView;
  label: string;
  syncState: SyncState;
  selected: boolean;
  current: boolean;
  selectMode: boolean;
  disabled: boolean;
  onActivate: (e: React.MouseEvent | React.KeyboardEvent) => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.entry.id,
    disabled: props.disabled,
  });
  const { entry } = props;
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      type="button"
      className={`entry-card ${props.selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      aria-current={props.current || undefined}
      aria-pressed={props.selectMode ? props.selected : undefined}
      aria-label={`${props.label}${entry.caption ? ` — ${entry.caption}` : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={props.onActivate}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (!e.defaultPrevented && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          props.onActivate(e);
        }
      }}
    >
      <EntryThumb entry={entry} />
      {props.selectMode && (
        <span className="select-box" aria-hidden="true">
          {props.selected && <Icon name="check" size={14} strokeWidth={2.5} />}
        </span>
      )}
      <span className="body">
        <span className="title">
          {props.label}
          {entry.caption ? ` — ${entry.caption}` : ''}
        </span>
        <span className="row wrap gap-4">
          <SyncBadge state={props.syncState} />
          <OcrBadge state={entry.ocrState} confidence={entry.ocrConfidence} />
        </span>
        {entry.qualityFlags?.length > 0 && <span className="sr-only">{t('quality.flagged')}</span>}
      </span>
    </button>
  );
}
