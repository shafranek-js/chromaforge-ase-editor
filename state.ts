
import { AseData, FlatListItem } from "./types";

export const state = {
    aseData: {
        version: [1, 0],
        blocks: []
    } as AseData,
    currentSelection: null as number | null,
    flatList: [] as FlatListItem[],
    deleteConfirm: false,
    deleteAllConfirm: false,
    dragCounter: 0,
    currentFileName: 'chromaforge-palette.ase',
    
    // History System is now managed in history.ts
    // We only track transient UI state here
    isUndoing: false,

    // Drag & Drop Reordering
    dragSourceIndex: null as number | null,

    // View Mode
    viewMode: 'grid' as 'grid' | 'list',
    
    // Visual Aids
    showContrastOverlay: false
};