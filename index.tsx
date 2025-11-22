
/**
 * ChromaForge ASE Editor
 * Refactored Modular Entry Point
 */

import { state } from "./state";
import { Block, AseData } from "./types";
import { parseASE, createASEBuffer } from "./ase-utils";
import { blockToRgb, getHexFromBlock } from "./color-utils"; 
import { initDOM, renderUI, showToast, selectSwatch, dropOverlay, searchInput, updateEditorPanelState, deleteCurrentSwatch } from "./ui";
import { initHistory, pushHistory, undo, redo } from "./history";
import { initColorEngine } from "./color-engine";
import { initStorage, forceSaveState } from "./storage";

// Element References
let fileInput: HTMLInputElement;
let mergeInput: HTMLInputElement;
let btnUndo: HTMLButtonElement;
let btnRedo: HTMLButtonElement;
let sortSelect: HTMLSelectElement;
let btnDeleteAll: HTMLButtonElement;
let btnMusic: HTMLButtonElement;

// Audio State
let bgAudio: HTMLAudioElement;
let isMusicPlaying = false;
// Track the play promise to prevent "interrupted by pause" errors
let playAttempt: Promise<void> | undefined;
let unlockHandler: ((e: Event) => void) | null = null;

// Centralized History Restoration Handler
function restoreHistoryState(restoredData: AseData) {
    state.isUndoing = true;
    state.aseData = restoredData;
    state.currentSelection = null;
    renderUI();
    updateEditorPanelState();
    state.isUndoing = false;
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI Elements
    initDOM();
    
    fileInput = document.getElementById('file-input') as HTMLInputElement;
    mergeInput = document.getElementById('merge-input') as HTMLInputElement;
    btnUndo = document.getElementById('btn-undo') as HTMLButtonElement;
    btnRedo = document.getElementById('btn-redo') as HTMLButtonElement;
    sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
    btnDeleteAll = document.getElementById('btn-delete-all') as HTMLButtonElement;
    btnMusic = document.getElementById('btn-music') as HTMLButtonElement;

    // Bind Top Level Events
    document.getElementById('btn-new')?.addEventListener('click', createNewSwatch);
    document.getElementById('btn-open')?.addEventListener('click', () => fileInput.click());
    document.getElementById('btn-merge')?.addEventListener('click', () => mergeInput.click());
    document.getElementById('btn-save')?.addEventListener('click', saveASE);
    document.getElementById('btn-hard-reset')?.addEventListener('click', handleFactoryReset);
    
    // Settings Menu Logic
    const btnSettings = document.getElementById('btn-settings');
    const menuSettings = document.getElementById('settings-menu');
    
    btnSettings?.addEventListener('click', (e) => {
        e.stopPropagation();
        menuSettings?.classList.toggle('hidden');
    });

    // Close menus on outside click
    document.addEventListener('click', (e) => {
        if (!menuSettings?.contains(e.target as Node) && !btnSettings?.contains(e.target as Node)) {
            menuSettings?.classList.add('hidden');
        }
    });
    
    // Delete All Button Binding
    btnDeleteAll?.addEventListener('click', deleteAllSwatches);
    
    // Music Toggle Binding
    btnMusic?.addEventListener('click', toggleMusic);

    document.getElementById('btn-export-css')?.addEventListener('click', exportToCSS);
    
    fileInput.addEventListener('change', handleFileLoad);
    mergeInput.addEventListener('change', handleMergeLoad);

    // History & Sort Bindings
    btnUndo.addEventListener('click', () => {
        if (undo()) showToast("Undid last action", 'info');
    });
    btnRedo.addEventListener('click', () => {
        if (redo()) showToast("Redid action", 'info');
    });
    sortSelect.addEventListener('change', handleSort);

    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeydown);

    // Drag & Drop Setup (File API)
    document.body.addEventListener('dragenter', handleDragEnter);
    document.body.addEventListener('dragleave', handleDragLeave);
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', async e => {
        e.preventDefault();
        state.dragCounter = 0;
        // Reset overlay state
        dropOverlay.classList.remove('opacity-100', 'pointer-events-auto');
        dropOverlay.classList.add('opacity-0', 'pointer-events-none');
        
        if (e.dataTransfer?.files.length) {
            loadFile(e.dataTransfer.files[0]);
        }
    });
    
    // Initialize ICC Color Engine, then load storage or default file
    initColorEngine().then(async () => {
        // Initialize Storage
        const restored = await initStorage();
        
        if (restored) {
            // Hydrate UI from restored state
            initHistory(state.aseData, restoreHistoryState);
            renderUI();
            updateEditorPanelState();
            showToast("Session restored", 'success');
        } else {
            // Fallback to default file
            loadDefaultFile();
        }
    });

    // Initialize Background Audio
    initAudio();

    // Save state on exit/hide
    const saveHandler = () => forceSaveState();
    window.addEventListener('pagehide', saveHandler);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveHandler();
    });
});

/* -------------------------------------------------------------------------- */
/* FACTORY RESET LOGIC                                                        */
/* -------------------------------------------------------------------------- */

async function handleFactoryReset() {
    const btn = document.getElementById('btn-hard-reset');
    if (!btn) return;

    // In-Button Confirmation Pattern
    if (btn.dataset.confirm !== 'true') {
        const originalText = btn.innerHTML;
        btn.dataset.confirm = 'true';
        btn.innerHTML = `<span class="text-red-400 font-bold">Click again to confirm</span>`;
        
        setTimeout(() => {
            btn.dataset.confirm = 'false';
            btn.innerHTML = originalText;
        }, 3000);
        return;
    }

    try {
        // 1. Load Default Data (Simulate Fresh Start)
        let defaultData: AseData;
        try {
            const response = await fetch('default.ase');
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                defaultData = parseASE(buffer);
            } else {
                throw new Error("Defaults file missing");
            }
        } catch (e) {
            console.warn("Default file not found, using hardcoded fallback.");
            defaultData = {
                version: [1, 0],
                blocks: [
                    { type: 'color', name: 'ChromaForge Red', model: 'RGB ', values: [1, 0.2, 0.2], colorType: 2 }
                ]
            };
        }

        // 2. Reset Application State
        state.aseData = defaultData;
        state.currentFileName = 'chromaforge-default.ase';
        state.currentSelection = null;
        state.dragSourceIndex = null;
        state.viewMode = 'grid';
        state.showContrastOverlay = false;

        // 3. Re-Initialize Systems
        initHistory(state.aseData, restoreHistoryState);
        renderUI();
        updateEditorPanelState();

        // 4. Force Overwrite Persistence Immediately
        // This effectively clears the old DB state by writing the new default state over it
        forceSaveState();

        showToast("App reset to factory defaults", 'success');

        // Reset Button State
        btn.dataset.confirm = 'false';
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg> Reset App State`;

    } catch (err: any) {
        showToast("Reset failed: " + err.message, 'error');
    }
}

/* -------------------------------------------------------------------------- */
/* AUDIO LOGIC                                                                */
/* -------------------------------------------------------------------------- */

function initAudio() {
    bgAudio = document.getElementById('bg-audio') as HTMLAudioElement;
    if (!bgAudio) return;

    // Using the raw GitHub URL for streaming
    bgAudio.src = "https://github.com/shafranek-js/filestorage/raw/main/LullabyInstrumental.mp3";
    bgAudio.volume = 0.4; 
    
    // Error listener for the file loading itself
    bgAudio.addEventListener('error', (e) => {
        console.warn("Audio resource failed to load.");
        isMusicPlaying = false;
        updateMusicButton();
    });
    
    // Music is off by default now
    updateMusicButton();
}

function safePlay() {
    if (!bgAudio) return;
    
    // Prevent playback if the media has already errored out
    if (bgAudio.error) {
        console.debug("Cannot play audio: Source error.");
        return;
    }

    playAttempt = bgAudio.play();

    if (playAttempt !== undefined) {
        playAttempt
            .then(() => {
                isMusicPlaying = true;
                updateMusicButton();
                // Play successful, we don't need unlock listeners anymore
                removeUnlockListeners();
            })
            .catch((error) => {
                // Check for "no supported sources" specifically (NotSupportedError)
                if (error.name === 'NotSupportedError' || error.message.includes('no supported sources')) {
                     console.warn("Audio file missing or format unsupported.");
                     isMusicPlaying = false;
                     updateMusicButton();
                     return;
                }

                // Auto-play was prevented or aborted
                isMusicPlaying = false;
                updateMusicButton();

                // If blocked by browser policy, add interaction listeners
                if (error.name === 'NotAllowedError') {
                    addUnlockListeners();
                } else {
                    console.debug("Audio playback failed:", error.message);
                }
            });
    }
}

function safePause() {
    if (!bgAudio) return;

    // Ensure we don't interrupt a pending play request
    if (playAttempt !== undefined) {
        playAttempt
            .then(() => {
                bgAudio.pause();
                isMusicPlaying = false;
                updateMusicButton();
            })
            .catch(() => {
                // If play failed, we're likely already paused, but ensure state is correct
                isMusicPlaying = false;
                updateMusicButton();
            });
    } else {
        bgAudio.pause();
        isMusicPlaying = false;
        updateMusicButton();
    }
}

function addUnlockListeners() {
    if (unlockHandler) return; // Listeners already active

    unlockHandler = () => {
        // Don't retry if broken
        if (bgAudio && bgAudio.error) return;
        safePlay();
    };

    // Capture interactions to unlock audio context
    document.addEventListener('click', unlockHandler, { once: true });
    document.addEventListener('keydown', unlockHandler, { once: true });
}

function removeUnlockListeners() {
    if (unlockHandler) {
        document.removeEventListener('click', unlockHandler);
        document.removeEventListener('keydown', unlockHandler);
        unlockHandler = null;
    }
}

function toggleMusic(e: MouseEvent) {
    if (!bgAudio) return;
    
    // Prevent this click from triggering the unlock listener if it's active
    e.stopPropagation();
    e.preventDefault();

    if (bgAudio.paused) {
        safePlay();
    } else {
        safePause();
    }
}

function updateMusicButton() {
    if (!btnMusic) return;
    
    const iconSpan = document.getElementById('icon-music');
    const textSpan = document.getElementById('text-music');

    if (isMusicPlaying) {
        if (iconSpan) iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
        if (textSpan) textSpan.innerText = "Music: On";
        btnMusic.classList.add('text-pink-400');
        btnMusic.classList.remove('text-zinc-300');
    } else {
        // Muted / Off Icon
        if (iconSpan) iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle><line x1="4" y1="4" x2="20" y2="20"></line></svg>`;
        if (textSpan) textSpan.innerText = "Music: Off";
        btnMusic.classList.remove('text-pink-400');
        btnMusic.classList.add('text-zinc-300');
    }
}

/* -------------------------------------------------------------------------- */
/* SHORTCUTS                                                                  */
/* -------------------------------------------------------------------------- */

function handleKeydown(e: KeyboardEvent) {
    // Ignore if user is typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        return;
    }

    // Undo: Ctrl+Z / Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (undo()) showToast("Undid last action", 'info');
    }
    
    // Redo: Ctrl+Y / Cmd+Y / Ctrl+Shift+Z
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || 
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        if (redo()) showToast("Redid action", 'info');
    }

    // Save: Ctrl+S / Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveASE();
    }

    // Delete: Del / Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.currentSelection !== null) {
            e.preventDefault();
            deleteCurrentSwatch();
        }
    }
}

/* -------------------------------------------------------------------------- */
/* EXPORT                                                                     */
/* -------------------------------------------------------------------------- */

function exportToCSS() {
    if (state.aseData.blocks.length === 0) {
        showToast("No colors to export", 'error');
        return;
    }

    const colors = state.aseData.blocks.filter(b => b.type === 'color');
    if (colors.length === 0) {
        showToast("No colors found", 'error');
        return;
    }

    let css = ":root {\n";
    colors.forEach(c => {
        if (c.name) {
            const safeName = c.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const hex = getHexFromBlock(c);
            css += `  --${safeName}: ${hex};\n`;
        }
    });
    css += "}";

    navigator.clipboard.writeText(css).then(() => {
        showToast("CSS variables copied to clipboard!", 'success');
    }).catch(() => {
        showToast("Failed to copy to clipboard", 'error');
    });
}

/* -------------------------------------------------------------------------- */
/* LOGIC HANDLERS                                                             */
/* -------------------------------------------------------------------------- */

function createNewSwatch() {
    pushHistory();

    const newBlock: Block = {
        type: 'color',
        name: 'New Color',
        model: 'RGB ',
        values: [1, 0, 0], // Red
        colorType: 1 // Spot
    };

    state.aseData.blocks.push(newBlock);
    
    // Clear search if active so the new item shows up
    if (searchInput && searchInput.value) {
        searchInput.value = '';
    }

    renderUI();

    const newIndex = state.aseData.blocks.length - 1;
    const flatItem = state.flatList.find(item => item.index === newIndex);
    
    if (flatItem) {
        selectSwatch(newIndex, flatItem.element);
        flatItem.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    showToast("New swatch created", 'success');
}

function deleteAllSwatches() {
    if (state.aseData.blocks.length === 0) {
        showToast("Workspace is already empty", 'info');
        return;
    }

    // Custom confirmation logic to bypass sandbox restrictions on window.confirm
    if (!state.deleteAllConfirm) {
        state.deleteAllConfirm = true;
        if (btnDeleteAll) {
            btnDeleteAll.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg> Confirm?`;
            btnDeleteAll.classList.remove('text-zinc-400', 'hover:text-red-400', 'hover:bg-red-900/20');
            btnDeleteAll.classList.add('text-white', 'bg-red-600', 'hover:bg-red-700');
        }
        
        // Auto-reset after 3s
        setTimeout(() => {
            if (state.deleteAllConfirm) resetDeleteAllButton();
        }, 3000);
        return;
    }

    pushHistory();
    state.aseData.blocks = [];
    state.currentSelection = null;
    renderUI();
    updateEditorPanelState();
    showToast("Workspace cleared", 'success');
    resetDeleteAllButton();
}

function resetDeleteAllButton() {
    state.deleteAllConfirm = false;
    if (btnDeleteAll) {
        btnDeleteAll.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg> Delete all swatches`;
        btnDeleteAll.classList.remove('text-white', 'bg-red-600', 'hover:bg-red-700');
        btnDeleteAll.classList.add('text-zinc-400', 'hover:text-red-400', 'hover:bg-red-900/20');
    }
}

function handleSort() {
    const criterion = sortSelect.value;
    if (!criterion) return;

    pushHistory();

    // Use Smart Tree Sort to preserve groups
    state.aseData.blocks = sortBlocksHierarchically(state.aseData.blocks, criterion);

    state.currentSelection = null;
    renderUI();
    updateEditorPanelState();
    showToast("Palette sorted (Groups preserved)", 'success');
    
    // Previously we reset sortSelect.value = "" here. 
    // Removing this keeps the dropdown value persistent.
}

/* -------------------------------------------------------------------------- */
/* HIERARCHICAL SORT LOGIC                                                    */
/* -------------------------------------------------------------------------- */

interface TreeNode {
    block: Block;
    children: TreeNode[];
    endBlock?: Block;
}

function sortBlocksHierarchically(blocks: Block[], criterion: string): Block[] {
    // 1. Parse Flat Blocks into Tree
    // We create a dummy root to hold everything
    const root: TreeNode = { block: { type: 'groupStart' }, children: [] };
    const stack: TreeNode[] = [root];

    for (const b of blocks) {
        const parent = stack[stack.length - 1];

        if (b.type === 'groupStart') {
            const node: TreeNode = { block: b, children: [] };
            parent.children.push(node);
            stack.push(node);
        } else if (b.type === 'groupEnd') {
            if (stack.length > 1) {
                const finishedGroup = stack.pop();
                if (finishedGroup) finishedGroup.endBlock = b;
            } else {
                // Orphan groupEnd, treat as leaf in current root context or just ignore to prevent breaking structure
                parent.children.push({ block: b, children: [] });
            }
        } else {
            // Color or other
            parent.children.push({ block: b, children: [] });
        }
    }

    // 2. Recursive Sort Function
    const compareColors = (a: Block, b: Block): number => {
         if (criterion === 'name') {
            return (a.name || '').localeCompare(b.name || '');
        }
        
        const rgbA = blockToRgb(a);
        const rgbB = blockToRgb(b);
        
        // HSL Calculation local helper
        const getHSL = (r: number, g: number, bVal: number) => {
            const max = Math.max(r, g, bVal), min = Math.min(r, g, bVal);
            let h = 0, s = 0, l = (max + min) / 2;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = (g - bVal) / d + (g < bVal ? 6 : 0); break;
                    case g: h = (bVal - r) / d + 2; break;
                    case bVal: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            return [h, s, l];
        };

        const hslA = getHSL(rgbA[0], rgbA[1], rgbA[2]);
        const hslB = getHSL(rgbB[0], rgbB[1], rgbB[2]);

        if (criterion === 'hue') return hslA[0] - hslB[0]; 
        if (criterion === 'saturation') return hslB[1] - hslA[1]; // Desc
        if (criterion === 'lightness') return hslA[2] - hslB[2]; 
        return 0;
    };

    const sortTree = (nodes: TreeNode[]) => {
        // Depth-first sort of children
        nodes.forEach(n => {
            if (n.children.length > 0) sortTree(n.children);
        });

        nodes.sort((a, b) => {
            const isGroupA = a.block.type === 'groupStart';
            const isGroupB = b.block.type === 'groupStart';
            
            // Prioritize Groups at the top
            if (isGroupA && !isGroupB) return -1;
            if (!isGroupA && isGroupB) return 1;

            if (isGroupA && isGroupB) {
                // Sort Groups by Name
                return (a.block.name || '').localeCompare(b.block.name || '');
            }
            
            // Sort Colors based on user criterion
            return compareColors(a.block, b.block);
        });
    };

    // Perform Sort on Root's children
    sortTree(root.children);

    // 3. Flatten back to Block Array
    const result: Block[] = [];
    const flatten = (n: TreeNode) => {
        if (n !== root) result.push(n.block); // Skip dummy root start
        n.children.forEach(flatten);
        if (n.endBlock) result.push(n.endBlock);
    };
    
    flatten(root);
    return result;
}

/* -------------------------------------------------------------------------- */
/* FILE HANDLERS                                                              */
/* -------------------------------------------------------------------------- */

async function handleFileLoad(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.[0]) loadFile(target.files[0]);
    target.value = '';
}

async function handleMergeLoad(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files?.[0]) loadMergeFile(target.files[0]);
    target.value = '';
}

async function loadFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.ase')) {
        showToast("Please upload a .ase file", 'error');
        return;
    }

    state.currentFileName = file.name;

    try {
        const buffer = await file.arrayBuffer();
        state.aseData = parseASE(buffer); 
        state.currentSelection = null; 
        
        // Re-initialize history with new data
        initHistory(state.aseData, restoreHistoryState);

        renderUI();
        updateEditorPanelState();
        showToast(`Loaded ${state.aseData.blocks.filter(b => b.type === 'color').length} swatches`, 'success');
    } catch (err: any) {
        showToast("Error parsing file: " + err.message, 'error');
        console.error(err);
    }
}

async function loadDefaultFile() {
    try {
        const response = await fetch('default.ase');
        if (response.ok) {
            const buffer = await response.arrayBuffer();
            state.aseData = parseASE(buffer);
            state.currentFileName = 'default.ase';
            state.currentSelection = null;
            
            // Initialize History for default file
            initHistory(state.aseData, restoreHistoryState);

            renderUI();
            updateEditorPanelState();
        } else {
             // Initialize Empty History if default fetch fails
             initHistory(state.aseData, restoreHistoryState);
             renderUI();
        }
    } catch (err) {
        // Fallback init if no file
        console.debug("No default.ase file found.");
        initHistory(state.aseData, restoreHistoryState);
        renderUI();
    }
}

async function loadMergeFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.ase')) {
        showToast("Please upload a .ase file", 'error');
        return;
    }

    if (state.aseData.blocks.length === 0) {
        loadFile(file);
        return;
    }

    try {
        pushHistory();
        const buffer = await file.arrayBuffer();
        const newData = parseASE(buffer);
        
        let addedCount = 0;
        const existingNames = new Set(state.aseData.blocks
            .filter(b => b.type === 'color')
            .map(b => b.name?.trim().toLowerCase())
        );
        
        newData.blocks.forEach(block => {
            if (block.type === 'color' && block.name) {
                const normalizeName = block.name.trim().toLowerCase();
                if (!existingNames.has(normalizeName)) {
                    state.aseData.blocks.push(block);
                    existingNames.add(normalizeName);
                    addedCount++;
                }
            }
        });
        
        if (addedCount > 0) {
            renderUI();
            showToast(`Merged ${addedCount} unique swatches`, 'success');
        } else {
            showToast("No unique swatches found", 'info');
        }

    } catch (err: any) {
        showToast("Error merging: " + err.message, 'error');
    }
}

function saveASE() {
    if (!state.aseData.blocks.length) {
        showToast("Nothing to save", 'error');
        return;
    }

    try {
        const blob = createASEBuffer(state.aseData);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        const colorCount = state.aseData.blocks.filter(b => b.type === 'color').length;
        const baseName = state.currentFileName.replace(/\.ase$/i, '');
        a.download = `${baseName}-${colorCount}.ase`;
        
        a.click();
        URL.revokeObjectURL(url);
        showToast("File downloaded!", 'success');
    } catch(e: any) {
        showToast("Error saving: " + e.message, 'error');
        console.error(e);
    }
}

/* -------------------------------------------------------------------------- */
/* DRAG VISUALS (Main Window)                                                 */
/* -------------------------------------------------------------------------- */

function handleDragEnter(e: DragEvent) {
    // If dragging from OS, e.dataTransfer.types contains "Files". 
    // If dragging internal swatch, it does not.
    if (!e.dataTransfer?.types.includes('Files')) return;

    e.preventDefault();
    state.dragCounter++;
    // Show overlay
    dropOverlay.classList.remove('opacity-0', 'pointer-events-none');
    dropOverlay.classList.add('opacity-100', 'pointer-events-auto');
}

function handleDragLeave(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    
    e.preventDefault();
    state.dragCounter--;
    if (state.dragCounter === 0) {
        // Hide overlay
        dropOverlay.classList.remove('opacity-100', 'pointer-events-auto');
        dropOverlay.classList.add('opacity-0', 'pointer-events-none');
    }
}
