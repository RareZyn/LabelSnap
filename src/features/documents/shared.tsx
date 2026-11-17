import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { Button, SelectField, Sheet, TextField } from '../../components/ui';
import { TagEditor } from '../../components/TagEditor';
import { useImage } from '../../lib/images';
import { createDocument, allTags, useDocuments } from '../../data/documents';
import { useTemplates } from '../../data/templates';
import { useAuthed, useSession } from '../../stores/sessionStore';
import type { DocumentRec } from '../../data/types';

export function DocCover({ doc, className = 'doc-cover', iconSize = 20 }: { doc: DocumentRec; className?: string; iconSize?: number }) {
  const { url } = useImage(doc.coverEntryId ? { entryId: doc.coverEntryId, variant: 'thumb', driveId: doc.coverThumbPath } : null);
  return (
    <div className={className} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name={doc.coverEntryId ? 'image' : 'doc'} size={iconSize} />}
    </div>
  );
}

export function NewDocumentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { uid, spaceId } = useAuthed();
  const prefs = useSession((s) => s.prefs);
  const { templates } = useTemplates(spaceId);
  const { data: docs } = useDocuments(spaceId);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(prefs.defaultTemplateId);
  const [tags, setTags] = useState<string[]>([]);

  const submit = () => {
    if (!title.trim()) return;
    const id = createDocument(spaceId, uid, { title, templateId, tags, ocrEnabled: prefs.ocrEnabled });
    setTitle('');
    setTags([]);
    onClose();
    navigate(`/d/${id}`);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('documents.new.title')}
      actions={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit} disabled={!title.trim()}>
            {t('documents.new.create')}
          </Button>
        </>
      }
    >
      <form
        className="col gap-12"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('documents.new.name')}
          placeholder={t('documents.new.namePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={140}
        />
        <SelectField
          label={t('documents.new.template')}
          value={templateId}
          onChange={setTemplateId}
          options={templates.map((tp) => ({ value: tp.id, label: tp.isBuiltIn ? t(`templates.builtin.${tp.id}`) : tp.name }))}
        />
        <TagEditor tags={tags} onChange={setTags} suggestions={allTags(docs)} />
        {/* Lets Enter in the title field submit: a form with several fields needs a submit button. */}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

export function templateName(t: (k: string) => string, tpl: { id: string; name: string; isBuiltIn: boolean }): string {
  return tpl.isBuiltIn ? t(`templates.builtin.${tpl.id}`) : tpl.name;
}
