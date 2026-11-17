import { create } from 'zustand';

/** Entries selected in a Document, shared between the detail page and the export screen. */
interface SelectionState {
  documentId: string | null;
  ids: string[];
  setSelection: (documentId: string, ids: string[]) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  documentId: null,
  ids: [],
  setSelection: (documentId, ids) => set({ documentId, ids }),
  clear: () => set({ documentId: null, ids: [] }),
}));
