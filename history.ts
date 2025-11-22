
import { state } from "./state";
import { AseData } from "./types";
import { debouncedSave } from "./storage";

type RestoreCallback = (data: AseData) => void;

let historyStack: string[] = [];
let historyIndex = -1;
let onRestore: RestoreCallback | null = null;

// DOM Elements (Lazily bound)
let btnUndo: HTMLButtonElement | null = null;
let btnRedo: HTMLButtonElement | null = null;

export function initHistory(initialData: AseData, callback: RestoreCallback) {
    historyStack = [JSON.stringify(initialData)];
    historyIndex = 0;
    onRestore = callback;
    
    // Bind buttons if DOM is ready, otherwise they will be bound on first update
    btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
    btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
    
    updateHistoryButtons();
}

export function pushHistory() {
    // If we are in middle of history and push new state, truncate future
    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    
    historyStack.push(JSON.stringify(state.aseData));
    
    // Limit stack size to 50
    if (historyStack.length > 50) {
        historyStack.shift();
        // Since we just pushed to the end, the index naturally follows.
        // However, shifting reduces length by 1, so we must ensure index is correct.
        // The new tip is at length-1.
    }
    
    historyIndex = historyStack.length - 1;
    updateHistoryButtons();
    
    // Save state changes to persistence
    debouncedSave();
}

export function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        restore();
        debouncedSave();
        return true;
    }
    return false;
}

export function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        restore();
        debouncedSave();
        return true;
    }
    return false;
}

function restore() {
    if (onRestore && historyStack[historyIndex]) {
        const data = JSON.parse(historyStack[historyIndex]);
        onRestore(data);
    }
    updateHistoryButtons();
}

function updateHistoryButtons() {
    if (!btnUndo) btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
    if (!btnRedo) btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;

    if (btnUndo && btnRedo) {
        btnUndo.disabled = historyIndex <= 0;
        btnRedo.disabled = historyIndex >= historyStack.length - 1;
    }
}
