import { deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useMemo } from 'react';
import { useQuerySnapshot } from '../hooks/useFirestore';
import { fire, newId, templateRef, templatesCol } from './refs';
import type { Template, TemplateSettings } from './types';
import { BUILT_IN_TEMPLATES, settingsOf } from '../lib/templates/builtins';

/** Built-in Templates followed by the active Space's saved Templates. */
export function useTemplates(spaceId: string | null): { templates: Template[]; loading: boolean } {
  const { data, loading } = useQuerySnapshot<Template>(
    spaceId ? templatesCol(spaceId) : null,
    spaceId ? `templates:${spaceId}` : null,
    (s) => ({ ...BUILT_IN_TEMPLATES[1], ...(s.data() as Omit<Template, 'id'>), id: s.id, isBuiltIn: false }),
  );
  const templates = useMemo(
    () => [...BUILT_IN_TEMPLATES, ...[...data].sort((a, b) => a.name.localeCompare(b.name))],
    [data],
  );
  return { templates, loading };
}

export function createTemplate(spaceId: string, name: string, settings: TemplateSettings): string {
  const id = newId();
  fire(
    setDoc(templateRef(spaceId, id), {
      ...settingsOf(settings),
      name: name.trim(),
      isBuiltIn: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
  return id;
}

export function saveTemplate(spaceId: string, id: string, name: string, settings: TemplateSettings): void {
  fire(
    setDoc(
      templateRef(spaceId, id),
      { ...settingsOf(settings), name: name.trim(), isBuiltIn: false, updatedAt: serverTimestamp() },
      { merge: true },
    ),
  );
}

export function deleteTemplate(spaceId: string, id: string): void {
  fire(deleteDoc(templateRef(spaceId, id)));
}
