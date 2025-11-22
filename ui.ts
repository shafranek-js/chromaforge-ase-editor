
import { state } from "./state";
import { Block } from "./types";
import { getCSSColor, getHexFromBlock, getChannelValuesText, blockToRgb, rgbToCmyk, rgbToGray, rgbToLab, hexToRgb, getContrastRatio, getBestTextColor, labToRgbValues, isAuthoritative } from "./color-utils";
import { pushHistory } from "./history"; 
import { debouncedSave } from "./storage";

// DOM Elements
export let container: HTMLElement;
export let editorPanel: HTMLElement;
export let editorEmpty: HTMLElement;
export let dropOverlay: HTMLElement;
let toast: HTMLElement;
let toastMsg: HTMLElement;
export let searchInput: HTMLInputElement;

// Form Elements
let inpName: HTMLInputElement;
let inpModel: HTMLSelectElement;
let inpValuesDiv: HTMLElement;
let inpColorType: HTMLSelectElement;
let inpGlobal: HTMLInputElement;
let inpHex: HTMLInputElement;
let btnDelete: HTMLButtonElement;
let btnDuplicate: HTMLButtonElement;
let previewColor: HTMLElement;
let previewContainer: HTMLElement;
let nativePicker: HTMLInputElement;
let previewHex: HTMLElement;
let previewRatio: HTMLElement; // New

// View Toggles
let btnViewGrid: HTMLButtonElement;
let btnViewList: HTMLButtonElement;
let btnViewContrast: HTMLButtonElement;

// Guide Elements
let guideModal: HTMLElement;
let guideBackdrop: HTMLElement;
let guideContent: HTMLElement;

// Constants
const TRANSPARENCY_CLASS = "bg-transparency";

export function initDOM() {
    container = document.getElementById('swatch-container')!;
    editorPanel = document.getElementById('editor-panel')!;
    editorEmpty = document.getElementById('editor-empty')!;
    dropOverlay = document.getElementById('drop-overlay')!;
    toast = document.getElementById('toast')!;
    toastMsg = document.getElementById('toast-msg')!;
    searchInput = document.getElementById('search-input') as HTMLInputElement;

    inpName = document.getElementById('edit-name') as HTMLInputElement;
    inpModel = document.getElementById('edit-model') as HTMLSelectElement;
    inpValuesDiv = document.getElementById('value-inputs')!;
    
    // New UI inputs for Color Type
    inpColorType = document.getElementById('edit-color-type') as HTMLSelectElement;
    inpGlobal = document.getElementById('edit-global') as HTMLInputElement;

    inpHex = document.getElementById('edit-hex') as HTMLInputElement;
    btnDelete = document.getElementById('btn-delete') as HTMLButtonElement;
    btnDuplicate = document.getElementById('btn-duplicate') as HTMLButtonElement;
    previewColor = document.getElementById('preview-color')!;
    previewContainer = previewColor.parentElement!;
    nativePicker = document.getElementById('native-picker') as HTMLInputElement;
    previewHex = document.getElementById('preview-hex')!;
    previewRatio = document.getElementById('preview-ratio')!; // New

    btnViewGrid = document.getElementById('btn-view-grid') as HTMLButtonElement;
    btnViewList = document.getElementById('btn-view-list') as HTMLButtonElement;
    btnViewContrast = document.getElementById('btn-view-contrast') as HTMLButtonElement;

    // Guide Elements Init
    guideModal = document.getElementById('guide-modal')!;
    guideBackdrop = document.getElementById('guide-backdrop')!;
    guideContent = document.getElementById('guide-content')!;
    
    // Guide Bindings
    document.getElementById('btn-guide')?.addEventListener('click', openGuide);
    document.getElementById('btn-close-guide')?.addEventListener('click', closeGuide);
    document.getElementById('btn-close-guide-footer')?.addEventListener('click', closeGuide);
    guideBackdrop?.addEventListener('click', closeGuide);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !guideModal.classList.contains('hidden')) {
            closeGuide();
        }
    });

    // Batch Menu Logic
    const btnBatch = document.getElementById('btn-batch-ops');
    const menuBatch = document.getElementById('batch-menu');
    
    btnBatch?.addEventListener('click', (e) => {
        e.stopPropagation();
        menuBatch?.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!menuBatch?.contains(e.target as Node) && !btnBatch?.contains(e.target as Node)) {
            menuBatch?.classList.add('hidden');
        }
    });

    document.querySelectorAll('.batch-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = (e.currentTarget as HTMLElement).dataset.action;
            if(action) handleBatchAction(action);
            menuBatch?.classList.add('hidden');
        });
    });

    // Bind Editor Events
    btnDelete.addEventListener('click', deleteCurrentSwatch);
    btnDuplicate?.addEventListener('click', duplicateCurrentSwatch);
    document.getElementById('btn-apply')?.addEventListener('click', applyChanges);
    
    inpModel.addEventListener('change', handleModelChange);
    // inpValuesDiv listener updated to handle both input types
    inpValuesDiv.addEventListener('input', handleValueInput); 
    searchInput.addEventListener('input', () => renderUI());
    
    // Color Type Logic: Spot implies Global
    inpColorType.addEventListener('change', () => {
        if (inpColorType.value === 'spot') {
            inpGlobal.checked = true;
            inpGlobal.disabled = true;
        } else {
            inpGlobal.disabled = false;
        }
    });

    // New Events: Hex Editing & Visual Picker
    inpHex.addEventListener('input', handleHexInput);
    inpHex.addEventListener('focus', () => inpHex.select());
    inpHex.addEventListener('blur', () => {
        if (state.currentSelection !== null) {
             updateSidebarPreview();
        }
    });

    // HEX Copy Button Logic
    document.getElementById('btn-copy-hex')?.addEventListener('click', () => {
        if (inpHex.value) {
            navigator.clipboard.writeText('#' + inpHex.value).then(() => {
                showToast("HEX copied to clipboard", 'success');
            }).catch(err => {
                showToast("Failed to copy", 'error');
            });
        }
    });

    previewContainer.addEventListener('click', () => nativePicker.click());
    nativePicker.addEventListener('input', handleNativePicker);

    // View Mode Bindings
    btnViewGrid.addEventListener('click', () => setViewMode('grid'));
    btnViewList.addEventListener('click', () => setViewMode('list'));
    btnViewContrast.addEventListener('click', toggleContrastOverlay);
}

/* -------------------------------------------------------------------------- */
/* BATCH OPERATIONS                                                           */
/* -------------------------------------------------------------------------- */

function handleBatchAction(action: string) {
    if (!state.aseData.blocks.length) {
         showToast("No colors to convert", 'error');
         return;
    }
    pushHistory();
    
    let count = 0;
    const blocks = state.aseData.blocks;

    blocks.forEach(block => {
        if (block.type !== 'color') return;
        
        const model = (block.model || 'RGB').trim();
        let modified = false;
        const v = block.values || [];

        switch(action) {
            case 'rgb-lab':
                if (model === 'RGB' && v.length === 3) {
                    block.values = rgbToLab(v[0], v[1], v[2]);
                    block.model = 'LAB ';
                    modified = true;
                }
                break;
            case 'lab-rgb':
                if (model === 'LAB' && v.length === 3) {
                    block.values = labToRgbValues(v[0], v[1], v[2]);
                    block.model = 'RGB ';
                    modified = true;
                }
                break;
            case 'rgb-lab-cmyk':
                 if (model === 'RGB' && v.length === 3) {
                    // RGB -> LAB -> RGB -> CMYK
                    const lab = rgbToLab(v[0], v[1], v[2]);
                    const rgb2 = labToRgbValues(lab[0], lab[1], lab[2]);
                    block.values = rgbToCmyk(rgb2[0], rgb2[1], rgb2[2]);
                    block.model = 'CMYK';
                    modified = true;
                 }
                 break;
            case 'cmyk-lab':
                if (model === 'CMYK') {
                    const rgb = blockToRgb(block); // Converts CMYK to RGB [0-1]
                    block.values = rgbToLab(rgb[0], rgb[1], rgb[2]);
                    block.model = 'LAB ';
                    modified = true;
                }
                break;
            case 'lab-cmyk':
                if (model === 'LAB' && v.length === 3) {
                    const rgb = labToRgbValues(v[0], v[1], v[2]);
                    block.values = rgbToCmyk(rgb[0], rgb[1], rgb[2]);
                    block.model = 'CMYK';
                    modified = true;
                }
                break;
            case 'cmyk-lab-rgb':
                if (model === 'CMYK') {
                    const rgb = blockToRgb(block);
                    const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
                    block.values = labToRgbValues(lab[0], lab[1], lab[2]);
                    block.model = 'RGB ';
                    modified = true;
                }
                break;
            case 'process-spot':
                // Process (Global 0 or Normal 2) -> Spot 1
                if (block.colorType !== 1) {
                    block.colorType = 1;
                    modified = true;
                }
                break;
            case 'set-global':
                // Normal (2) -> Global (0). Ignore Spot (1).
                if (block.colorType === 2) {
                    block.colorType = 0;
                    modified = true;
                }
                break;
            case 'unset-global':
                // Global (0) -> Normal (2). Spot (1) -> Normal (2).
                if (block.colorType === 0 || block.colorType === 1) {
                    block.colorType = 2;
                    modified = true;
                }
                break;
        }

        if (modified) count++;
    });

    if (count > 0) {
        if (state.currentSelection !== null) {
             // Force update selection panel logic from new data
             const el = state.flatList.find(x => x.index === state.currentSelection)?.element;
             if(el) selectSwatch(state.currentSelection, el);
        }
        renderUI();
        showToast(`Updated ${count} swatches`, 'success');
    } else {
        showToast("No eligible swatches found", 'info');
    }
}

/* -------------------------------------------------------------------------- */
/* USER GUIDE MODAL                                                           */
/* -------------------------------------------------------------------------- */

function openGuide() {
    guideModal.classList.remove('hidden');
    guideModal.classList.add('flex');
    // Trigger reflow for animation
    void guideModal.offsetWidth;
    
    guideBackdrop.classList.remove('opacity-0');
    guideBackdrop.classList.add('opacity-100');
    
    guideContent.classList.remove('scale-95', 'opacity-0');
    guideContent.classList.add('scale-100', 'opacity-100');
}

function closeGuide() {
    guideBackdrop.classList.remove('opacity-100');
    guideBackdrop.classList.add('opacity-0');
    
    guideContent.classList.remove('scale-100', 'opacity-100');
    guideContent.classList.add('scale-95', 'opacity-0');
    
    setTimeout(() => {
        guideModal.classList.remove('flex');
        guideModal.classList.add('hidden');
    }, 200);
}

/* -------------------------------------------------------------------------- */
/* TOAST SYSTEM                                                               */
/* -------------------------------------------------------------------------- */

export function showToast(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    if (!toastMsg || !toast) return;
    toastMsg.innerText = msg;
    
    const baseClasses = "fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-xl border flex items-center gap-3 z-50 text-sm font-medium transition-all duration-300";
    const visibleClasses = "translate-y-0 opacity-100";
    const hiddenClasses = "translate-y-full opacity-0";
    
    let colorClass = 'bg-zinc-800 border-zinc-700 text-zinc-200';
    if (type === 'error') colorClass = 'bg-red-900/90 border-red-800 text-red-100';
    if (type === 'success') colorClass = 'bg-emerald-900/90 border-emerald-800 text-emerald-100';
    
    toast.className = `${baseClasses} ${colorClass} ${visibleClasses}`;
    
    setTimeout(() => {
        toast.className = `${baseClasses} ${colorClass} ${hiddenClasses}`;
    }, 3000);
}

/* -------------------------------------------------------------------------- */
/* VIEW MODES                                                                 */
/* -------------------------------------------------------------------------- */

function setViewMode(mode: 'grid' | 'list') {
    state.viewMode = mode;
    
    if (mode === 'grid') {
        btnViewGrid.classList.add('bg-zinc-700', 'text-white');
        btnViewGrid.classList.remove('text-zinc-400', 'hover:bg-zinc-700');
        
        btnViewList.classList.remove('bg-zinc-700', 'text-white');
        btnViewList.classList.add('text-zinc-400', 'hover:bg-zinc-700');
    } else {
        btnViewList.classList.add('bg-zinc-700', 'text-white');
        btnViewList.classList.remove('text-zinc-400', 'hover:bg-zinc-700');
        
        btnViewGrid.classList.remove('bg-zinc-700', 'text-white');
        btnViewGrid.classList.add('text-zinc-400', 'hover:bg-zinc-700');
    }
    
    debouncedSave();
    renderUI();
}

function toggleContrastOverlay() {
    state.showContrastOverlay = !state.showContrastOverlay;
    
    if (state.showContrastOverlay) {
        btnViewContrast.classList.add('bg-zinc-700', 'text-white');
        btnViewContrast.classList.remove('text-zinc-400', 'hover:bg-zinc-700');
        showToast("Text contrast overlay enabled", 'info');
    } else {
        btnViewContrast.classList.remove('bg-zinc-700', 'text-white');
        btnViewContrast.classList.add('text-zinc-400', 'hover:bg-zinc-700');
        showToast("Text contrast overlay disabled", 'info');
    }
    
    debouncedSave();
    renderUI();
}

/* -------------------------------------------------------------------------- */
/* RENDERER                                                                   */
/* -------------------------------------------------------------------------- */

export function renderUI() {
    container.innerHTML = '';
    state.flatList = [];
    
    // Apply Container Layout based on view mode
    if (state.viewMode === 'grid') {
        container.className = 'flex-1 p-8 overflow-y-auto flex flex-wrap content-start gap-6 bg-black/20';
    } else {
        container.className = 'flex-1 p-4 overflow-y-auto flex flex-col gap-2 bg-black/20';
    }

    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const isSearching = query.length > 0;

    if (state.aseData.blocks.length === 0) {
        container.innerHTML = `
            <div class="w-full h-full flex flex-col items-center justify-center text-zinc-600 opacity-50 select-none">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="mb-4">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <p>Drag and drop an .ase file here</p>
            </div>`;
        return;
    }

    let hasMatches = false;

    state.aseData.blocks.forEach((block, index) => {
        if (isSearching) {
            if (block.type !== 'color') return;
            const name = block.name?.toLowerCase() || '';
            const model = block.model?.toLowerCase() || '';
            if (!name.includes(query) && !model.includes(query)) return;
        }

        hasMatches = true;

        if (block.type === 'groupStart') {
            const header = document.createElement('div');
            header.className = 'w-full pt-6 pb-2 flex items-end gap-2 border-b border-zinc-800 mb-2 group/header';
            
            const label = document.createElement('input');
            label.value = block.name || 'Untitled Group';
            label.className = 'bg-transparent text-xs font-bold text-zinc-500 uppercase tracking-widest focus:text-zinc-200 focus:outline-none focus:ring-0 w-full cursor-pointer hover:text-zinc-300 transition-colors';
            label.title = "Double click to rename";
            
            // Rename Logic
            let originalName = block.name;
            label.addEventListener('focus', () => {
                originalName = label.value;
                label.select();
            });
            
            label.addEventListener('blur', () => {
                if (label.value !== originalName) {
                    pushHistory();
                    block.name = label.value;
                    showToast("Group renamed", 'success');
                }
            });
            
            label.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') label.blur();
                if (e.key === 'Escape') {
                    label.value = originalName || '';
                    label.blur();
                }
            });

            header.appendChild(label);
            container.appendChild(header);
        } 
        else if (block.type === 'color') {
            
            let el: HTMLElement;
            
            if (state.viewMode === 'list') {
                el = createListElement(block, index);
            } else {
                el = createGridElement(block, index);
            }
            
            // Common Events
            el.onclick = () => selectSwatch(index, el);
            el.ondragstart = (e) => handleSwatchDragStart(e, index);
            el.ondragover = (e) => handleSwatchDragOver(e);
            el.ondrop = (e) => handleSwatchDrop(e, index);
            el.ondragend = () => el.classList.remove('opacity-40');

            container.appendChild(el);
            state.flatList.push({ index: index, element: el });
        }
    });

    if (isSearching && !hasMatches) {
        container.innerHTML = `
            <div class="w-full h-full flex flex-col items-center justify-center text-zinc-600 opacity-50">
                <p>No colors found matching "${query}"</p>
            </div>`;
    }
}

/* -------------------------------------------------------------------------- */
/* ELEMENT CREATION FACTORIES                                                 */
/* -------------------------------------------------------------------------- */

function createSwatchIndicator(type: number | undefined, size: 'sm' | 'md'): HTMLElement | null {
    // 0 = Global (Triangle), 1 = Spot (Triangle + Dot), 2 = Normal (None)
    if (type !== 0 && type !== 1) return null;

    const container = document.createElement('div');
    container.className = 'absolute bottom-0 right-0 z-10 pointer-events-none';

    const pxSize = size === 'sm' ? 10 : 16;

    // Use SVG for crisp rendering of the triangle and its outline
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(pxSize));
    svg.setAttribute("height", String(pxSize));
    svg.setAttribute("viewBox", `0 0 ${pxSize} ${pxSize}`);
    svg.style.display = "block";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // Draw a triangle in the bottom-right corner
    // Path moves from bottom-left of the box (0, pxSize) to bottom-right (pxSize, pxSize) to top-right (pxSize, 0)
    path.setAttribute("d", `M0 ${pxSize} L${pxSize} ${pxSize} L${pxSize} 0 Z`);
    path.setAttribute("fill", "white");
    // Subtle black outline for visibility on light backgrounds
    path.setAttribute("stroke", "rgba(0,0,0,0.6)");
    path.setAttribute("stroke-width", "1");
    
    svg.appendChild(path);

    if (type === 1) { // Spot Color Dot
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        // Position dot slightly offset from the corner
        const offset = size === 'sm' ? 2.5 : 4; 
        const r = size === 'sm' ? 1.3 : 1.8;
        
        circle.setAttribute("cx", String(pxSize - offset));
        circle.setAttribute("cy", String(pxSize - offset));
        circle.setAttribute("r", String(r));
        circle.setAttribute("fill", "black");
        
        svg.appendChild(circle);
    }

    container.appendChild(svg);
    return container;
}

function createGridElement(block: Block, index: number): HTMLElement {
    const el = document.createElement('div');
    // Increased width from w-44 to w-52 to accommodate the grid
    el.className = 'w-52 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden cursor-pointer relative flex flex-col group h-auto transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-0.5 hover:shadow-xl hover:z-10 hover:border-zinc-700';
    el.draggable = true; 
    
    if (state.currentSelection === index) {
        el.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-zinc-950', 'z-20');
    }

    const transparency = document.createElement('div');
    transparency.className = `${TRANSPARENCY_CLASS} w-full h-24 relative shrink-0 border-b border-zinc-800 pointer-events-none`;
    
    const colorDiv = document.createElement('div');
    colorDiv.className = 'absolute inset-0 flex items-center justify-center';
    colorDiv.style.backgroundColor = getHexFromBlock(block);
    
    // Contrast Text Overlay
    if (state.showContrastOverlay) {
        const overlay = document.createElement('span');
        overlay.innerText = 'Aa';
        overlay.className = 'font-bold text-3xl select-none';
        overlay.style.color = getBestTextColor(block);
        colorDiv.appendChild(overlay);
    }
    
    transparency.appendChild(colorDiv);

    // Add Global/Spot Indicator
    const indicator = createSwatchIndicator(block.colorType, 'md');
    if (indicator) transparency.appendChild(indicator);

    const meta = document.createElement('div');
    meta.className = 'bg-zinc-900 p-3 flex flex-col pointer-events-none';
    
    // Name Row (Name + Badge)
    const nameRow = document.createElement('div');
    nameRow.className = 'flex items-center gap-1.5 mb-1 w-full';

    const nameLabel = document.createElement('div');
    nameLabel.className = 'text-xs font-bold text-zinc-200 truncate leading-none';
    nameLabel.innerText = block.name || 'Untitled';
    nameRow.appendChild(nameLabel);

    // Verified Badge
    if (isAuthoritative(block)) {
        const badge = document.createElement('div');
        badge.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0'; 
        badge.title = "Verified";
        nameRow.appendChild(badge);
    }
    
    const typeLabel = document.createElement('div');
    typeLabel.className = 'text-[10px] font-mono text-zinc-500 uppercase border-b border-zinc-800 pb-2 mb-2';
    typeLabel.innerText = getTypeLabel(block.colorType);

    // --- VALUES GRID ---
    const nativeModel = (block.model || 'RGB').trim();
    const rgbVals = blockToRgb(block); // normalized 0-1
    const v = block.values || [];

    // Calculation Helpers
    const getRgbStr = () => {
        if (nativeModel === 'RGB') {
             return `${Math.round((v[0]||0)*255)} ${Math.round((v[1]||0)*255)} ${Math.round((v[2]||0)*255)}`;
        }
        return `${Math.round(rgbVals[0]*255)} ${Math.round(rgbVals[1]*255)} ${Math.round(rgbVals[2]*255)}`;
    }
    
    const getCmykStr = () => {
        if (nativeModel === 'CMYK') {
             return `${Math.round((v[0]||0)*100)} ${Math.round((v[1]||0)*100)} ${Math.round((v[2]||0)*100)} ${Math.round((v[3]||0)*100)}`;
        }
        const cmyk = rgbToCmyk(rgbVals[0], rgbVals[1], rgbVals[2]);
        return `${Math.round(cmyk[0]*100)} ${Math.round(cmyk[1]*100)} ${Math.round(cmyk[2]*100)} ${Math.round(cmyk[3]*100)}`;
    }
    
    const getLabStr = () => {
        if (nativeModel === 'LAB') {
             let L = v[0]||0;
             if (L <= 1.05 && L > 0) L = L * 100;
             return `${L.toFixed(0)} ${v[1].toFixed(0)} ${v[2].toFixed(0)}`;
        }
        const lab = rgbToLab(rgbVals[0], rgbVals[1], rgbVals[2]);
        let L = lab[0];
        if (L <= 1.05 && L > 0) L = L * 100;
        return `${L.toFixed(0)} ${lab[1].toFixed(0)} ${lab[2].toFixed(0)}`;
    }

    const getGrayStr = () => {
         if (nativeModel === 'Gray') {
             return `${Math.round((v[0]||0)*100)}%`;
         }
         const g = rgbToGray(rgbVals[0], rgbVals[1], rgbVals[2]);
         return `${Math.round(g[0]*100)}%`;
    }

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-2 gap-x-1 gap-y-2.5';

    const createCell = (label: string, val: string, isNative: boolean) => {
        const cell = document.createElement('div');
        cell.innerHTML = `
            <div class="text-[9px] font-bold leading-none mb-0.5 ${isNative ? 'text-blue-400' : 'text-zinc-600'}">${label}</div>
            <div class="text-[10px] font-mono text-zinc-400 leading-none whitespace-nowrap overflow-hidden text-ellipsis">${val}</div>
        `;
        return cell;
    }

    // Order: CMYK | RGB
    //        LAB  | Gray/Hex
    
    grid.appendChild(createCell('CMYK', getCmykStr(), nativeModel === 'CMYK'));
    grid.appendChild(createCell('RGB', getRgbStr(), nativeModel === 'RGB'));
    grid.appendChild(createCell('LAB', getLabStr(), nativeModel === 'LAB'));
    
    // Bottom Right: Mixed Gray + Hex
    const mixedCell = document.createElement('div');
    const isGray = nativeModel === 'Gray';
    mixedCell.innerHTML = `
        <div class="flex justify-between pr-1">
            <span class="text-[9px] font-bold leading-none mb-0.5 ${isGray ? 'text-blue-400' : 'text-zinc-600'}">GRAY</span>
            <span class="text-[9px] font-bold leading-none mb-0.5 text-zinc-600">HEX</span>
        </div>
        <div class="flex justify-between pr-1 text-[10px] font-mono text-zinc-400 leading-none">
             <span>${getGrayStr()}</span>
             <span class="uppercase">${getHexFromBlock(block).replace('#','')}</span>
        </div>
    `;
    grid.appendChild(mixedCell);

    meta.appendChild(nameRow);
    meta.appendChild(typeLabel);
    meta.appendChild(grid);

    el.appendChild(transparency);
    el.appendChild(meta);

    return el;
}

function createListElement(block: Block, index: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'w-full h-12 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center px-3 cursor-pointer group transition-colors hover:border-zinc-700 hover:bg-zinc-800/50 relative';
    el.draggable = true;
    
    // Selection Style
    if (state.currentSelection === index) {
        el.classList.add('ring-1', 'ring-blue-500', 'bg-zinc-800');
    }

    // Drag Handle (Visual)
    const handle = document.createElement('div');
    handle.className = 'text-zinc-600 mr-3 cursor-grab opacity-0 group-hover:opacity-100';
    handle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;
    el.appendChild(handle);

    // Color Swatch
    const swatch = document.createElement('div');
    // Added 'relative' here to position indicator
    swatch.className = `w-8 h-8 rounded border border-zinc-700/50 shadow-sm mr-3 shrink-0 ${TRANSPARENCY_CLASS} overflow-hidden relative`;
    
    const colorFill = document.createElement('div');
    colorFill.className = 'w-full h-full flex items-center justify-center';
    colorFill.style.backgroundColor = getHexFromBlock(block);
    
    // Contrast Text Overlay
    if (state.showContrastOverlay) {
        const overlay = document.createElement('span');
        overlay.innerText = 'Aa';
        overlay.className = 'font-bold text-xs select-none';
        overlay.style.color = getBestTextColor(block);
        colorFill.appendChild(overlay);
    }

    swatch.appendChild(colorFill);

    // Add Global/Spot Indicator
    const indicator = createSwatchIndicator(block.colorType, 'sm');
    if (indicator) swatch.appendChild(indicator);

    el.appendChild(swatch);

    // Name Container
    const nameDiv = document.createElement('div');
    nameDiv.className = 'flex-1 min-w-0 mr-4 flex flex-col justify-center';
    
    // Name Row
    const nameRow = document.createElement('div');
    nameRow.className = 'flex items-center gap-2 w-full';

    const nameText = document.createElement('div');
    nameText.className = 'text-sm font-medium text-zinc-200 truncate';
    nameText.innerText = block.name || 'Untitled';
    nameRow.appendChild(nameText);

    // Verified Badge
    if (isAuthoritative(block)) {
        const badge = document.createElement('div');
        badge.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
        badge.title = "Verified";
        nameRow.appendChild(badge);
    }
    
    nameDiv.appendChild(nameRow);
    
    // Sub label (Spot/Global)
    const typeLabel = document.createElement('div');
    typeLabel.className = 'text-[9px] text-zinc-500 uppercase leading-none mt-0.5';
    typeLabel.innerText = getTypeLabel(block.colorType);
    nameDiv.appendChild(typeLabel);
    el.appendChild(nameDiv);

    // Model
    const modelDiv = document.createElement('div');
    modelDiv.className = 'w-16 text-xs font-mono text-zinc-400 shrink-0 hidden sm:block';
    modelDiv.innerText = block.model || 'RGB';
    el.appendChild(modelDiv);

    // Values
    const valDiv = document.createElement('div');
    valDiv.className = 'w-48 text-xs font-mono text-zinc-500 truncate shrink-0 text-right mr-4 hidden md:block';
    valDiv.innerText = getChannelValuesText(block);
    el.appendChild(valDiv);

    // Hex
    const hexDiv = document.createElement('div');
    hexDiv.className = 'w-20 text-xs font-mono text-zinc-300 shrink-0 text-right';
    hexDiv.innerText = getHexFromBlock(block);
    el.appendChild(hexDiv);

    return el;
}

/* -------------------------------------------------------------------------- */
/* SELECTION & EDIT LOGIC                                                     */
/* -------------------------------------------------------------------------- */

export function selectSwatch(index: number, el: HTMLElement) {
    state.currentSelection = index;
    
    // Update visual selection state
    state.flatList.forEach(item => {
        if (item.index === index) {
            if (state.viewMode === 'grid') {
                item.element.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-zinc-950', 'z-20');
            } else {
                item.element.classList.add('ring-1', 'ring-blue-500', 'bg-zinc-800');
            }
        } else {
            if (state.viewMode === 'grid') {
                item.element.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-zinc-950', 'z-20');
            } else {
                item.element.classList.remove('ring-1', 'ring-blue-500', 'bg-zinc-800');
            }
        }
    });

    updateEditorPanelState();
}

export function updateEditorPanelState() {
    if (state.currentSelection === null) {
        editorPanel.classList.add('hidden');
        editorEmpty.classList.remove('hidden');
        return;
    }

    const block = state.aseData.blocks[state.currentSelection];
    if (!block || block.type !== 'color') {
        editorPanel.classList.add('hidden');
        editorEmpty.classList.remove('hidden');
        return;
    }

    editorPanel.classList.remove('hidden');
    editorEmpty.classList.add('hidden');

    // Hydrate Inputs
    inpName.value = block.name || '';
    
    // Handle Model Selection (account for padded strings)
    let m = block.model || 'RGB ';
    if (m.trim() === 'RGB') m = 'RGB ';
    if (m.trim() === 'LAB') m = 'LAB ';
    inpModel.value = m;
    
    // Handle Color Type (Spot, Process, etc.)
    inpGlobal.checked = block.colorType !== 2; // 0=Global, 1=Spot, 2=Normal
    if (block.colorType === 1) {
        inpGlobal.disabled = true;
        inpColorType.value = 'spot';
    } else {
        inpGlobal.disabled = false;
        // We simplify to 'process' for anything not 'spot'
        inpColorType.value = 'process';
    }

    inpHex.value = getHexFromBlock(block).replace('#', '');

    renderValueInputs(block);
    updateSidebarPreview();
}

function renderValueInputs(block: Block) {
    inpValuesDiv.innerHTML = '';
    const model = (block.model || 'RGB').trim();
    const values = block.values || [];

    const createInput = (label: string, val: number, step: any, min: number, max: number, idx: number) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center gap-3';
        
        // Label
        const lbl = document.createElement('span');
        lbl.className = 'w-4 text-xs font-bold text-zinc-500 uppercase text-center shrink-0';
        lbl.innerText = label;
        
        // Determine display value
        let displayVal = val;
        // RGB stays integer 0-255
        if (model === 'RGB') displayVal = Math.round(val * 255);
        // CMYK, Gray allow decimals.
        if (model === 'CMYK') displayVal = parseFloat((val * 100).toFixed(2));
        if (model === 'Gray') displayVal = parseFloat((val * 100).toFixed(2));
        if (model === 'LAB') {
             // L might be 0-1 or 0-100 in storage. If small, assume 0-1 and scale up.
             if (idx === 0 && val <= 1.05 && val > 0) displayVal = parseFloat((val * 100).toFixed(2));
             else displayVal = parseFloat(val.toFixed(2)); 
        }

        // Slider
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min.toString();
        slider.max = max.toString();
        slider.step = step.toString();
        slider.value = displayVal.toString();
        slider.className = 'flex-1 accent-blue-600 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500/50 hover:bg-zinc-600 transition-colors';
        slider.dataset.idx = idx.toString();
        slider.dataset.role = 'slider';

        // Number Input
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = min.toString();
        inp.max = max.toString();
        inp.step = step.toString();
        inp.value = displayVal.toString();
        inp.className = 'w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-right';
        inp.dataset.idx = idx.toString();
        inp.dataset.role = 'number';
        
        wrapper.appendChild(lbl);
        wrapper.appendChild(slider);
        wrapper.appendChild(inp);
        inpValuesDiv.appendChild(wrapper);
    };

    // Define ranges and steps
    if (model === 'RGB') {
        createInput('R', values[0], 1, 0, 255, 0);
        createInput('G', values[1], 1, 0, 255, 1);
        createInput('B', values[2], 1, 0, 255, 2);
    } else if (model === 'CMYK') {
        createInput('C', values[0], 1, 0, 100, 0);
        createInput('M', values[1], 1, 0, 100, 1);
        createInput('Y', values[2], 1, 0, 100, 2);
        createInput('K', values[3], 1, 0, 100, 3);
    } else if (model === 'Gray') {
        createInput('K', values[0], 1, 0, 100, 0);
    } else if (model === 'LAB') {
        createInput('L', values[0], 1, 0, 100, 0);
        createInput('A', values[1], 1, -128, 127, 1);
        createInput('B', values[2], 1, -128, 127, 2);
    }
}

// Handle synchronized input from slider or number box
function handleValueInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.dataset.idx) return;

    const idx = target.dataset.idx;
    const row = target.closest('div'); 
    if (!row) return;

    // Find partner input
    const inputs = row.querySelectorAll('input');
    inputs.forEach(input => {
        if (input !== target) {
            input.value = target.value;
        }
    });

    updateSidebarPreview();
}

function updateSidebarPreview() {
    if (state.currentSelection === null) return;
    const block = state.aseData.blocks[state.currentSelection];
    
    // Gather values from number inputs (sliders are synced so this is safe)
    const inputs = inpValuesDiv.querySelectorAll('input[data-role="number"]');
    const newValues = [...(block.values || [])];
    const model = (block.model || 'RGB').trim();

    inputs.forEach(inp => {
        const inputEl = inp as HTMLInputElement;
        const idx = parseInt(inputEl.dataset.idx!);
        let val = parseFloat(inputEl.value);
        if (isNaN(val)) return;

        if (model === 'RGB') val /= 255;
        if (model === 'CMYK' || model === 'Gray') val /= 100;
        if (model === 'LAB' && idx === 0 && val > 1) val /= 100; 
        
        newValues[idx] = val;
    });
    
    // Temporarily set to calculate hex/preview
    const tempBlock = { ...block, values: newValues };
    const hex = getHexFromBlock(tempBlock);
    const bestText = getBestTextColor(tempBlock);
    
    previewColor.style.backgroundColor = hex;
    previewColor.style.color = bestText;
    previewHex.innerText = hex;
    nativePicker.value = hex;
    
    // Contrast Ratio
    const ratios = getContrastRatio(tempBlock);
    // Pick the ratio corresponding to the best text color
    const ratio = bestText === '#FFFFFF' ? ratios.white : ratios.black;
    previewRatio.innerText = ratio.toFixed(1) + ':1';
}

function handleModelChange() {
    if (state.currentSelection === null) return;
    const block = state.aseData.blocks[state.currentSelection];
    const oldModel = (block.model || 'RGB').trim();
    const newModelRaw = inpModel.value;
    const newModel = newModelRaw.trim(); // Normalize to remove space
    
    if (oldModel === newModel) return;
    
    const rgb = blockToRgb(block); 
    
    let newValues: number[] = [];
    if (newModel === 'RGB') {
        newValues = rgb;
        block.model = 'RGB ';
    } else if (newModel === 'CMYK') {
        newValues = rgbToCmyk(rgb[0], rgb[1], rgb[2]);
        block.model = 'CMYK';
    } else if (newModel === 'LAB') {
        newValues = rgbToLab(rgb[0], rgb[1], rgb[2]);
        block.model = 'LAB ';
    } else if (newModel === 'Gray') {
        newValues = rgbToGray(rgb[0], rgb[1], rgb[2]);
        block.model = 'Gray';
    } else {
        newValues = rgb;
        block.model = 'RGB ';
    }
    
    block.values = newValues;
    renderValueInputs(block);
    updateSidebarPreview();
}

function applyChanges() {
    if (state.currentSelection === null) return;
    pushHistory();
    
    const block = state.aseData.blocks[state.currentSelection];
    
    block.name = inpName.value;
    block.model = inpModel.value as any;
    
    const inputs = inpValuesDiv.querySelectorAll('input[data-role="number"]');
    const newValues: number[] = [];
    const model = (block.model || 'RGB').trim();

    inputs.forEach(inp => {
        const inputEl = inp as HTMLInputElement;
        let val = parseFloat(inputEl.value);
        if (isNaN(val)) val = 0;

        if (model === 'RGB') val /= 255;
        if (model === 'CMYK' || model === 'Gray') val /= 100;
        if (model === 'LAB' && parseInt(inputEl.dataset.idx!) === 0 && val > 1) val /= 100; 
        
        newValues.push(val);
    });
    block.values = newValues;
    
    if (inpColorType.value === 'spot') {
        block.colorType = 1;
    } else {
        block.colorType = inpGlobal.checked ? 0 : 2;
    }
    
    renderUI();
    showToast("Changes applied", 'success');
    
    const el = state.flatList.find(i => i.index === state.currentSelection)?.element;
    if (el) selectSwatch(state.currentSelection!, el);
}

export function deleteCurrentSwatch() {
    if (state.currentSelection === null) return;
    
    if (!state.deleteConfirm) {
        state.deleteConfirm = true;
        btnDelete.innerText = 'Confirm?';
        btnDelete.classList.add('bg-red-600', 'text-white', 'border-red-600');
        btnDelete.classList.remove('bg-zinc-900', 'text-zinc-400');
        
        setTimeout(() => {
            state.deleteConfirm = false;
            btnDelete.innerText = 'Delete';
            btnDelete.classList.remove('bg-red-600', 'text-white', 'border-red-600');
            btnDelete.classList.add('bg-zinc-900', 'text-zinc-400');
        }, 2000);
        return;
    }
    
    pushHistory();
    state.aseData.blocks.splice(state.currentSelection, 1);
    state.currentSelection = null;
    state.deleteConfirm = false;
    btnDelete.innerText = 'Delete';
    
    renderUI();
    updateEditorPanelState();
    showToast("Swatch deleted", 'info');
}

function duplicateCurrentSwatch() {
    if (state.currentSelection === null) return;
    pushHistory();
    
    const original = state.aseData.blocks[state.currentSelection];
    const copy: Block = JSON.parse(JSON.stringify(original));
    copy.name = (copy.name || '') + ' Copy';
    
    state.aseData.blocks.splice(state.currentSelection + 1, 0, copy);
    
    renderUI();
    const newIndex = state.currentSelection + 1;
    const el = state.flatList.find(i => i.index === newIndex)?.element;
    if (el) {
        selectSwatch(newIndex, el);
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    showToast("Swatch duplicated", 'success');
}

function handleHexInput() {
    const hex = inpHex.value.replace(/[^0-9A-F]/gi, '').substring(0, 6);
    if (hex.length === 6) {
        const rgb = hexToRgb('#' + hex);
        
        if (state.currentSelection !== null) {
            const block = state.aseData.blocks[state.currentSelection];
            const model = (block.model || 'RGB').trim();
            let newValues: number[] = [];
            
            if (model === 'RGB') newValues = rgb;
            else if (model === 'CMYK') newValues = rgbToCmyk(rgb[0], rgb[1], rgb[2]);
            else if (model === 'LAB') newValues = rgbToLab(rgb[0], rgb[1], rgb[2]);
            else if (model === 'Gray') newValues = rgbToGray(rgb[0], rgb[1], rgb[2]);
            
            // Update DOM inputs (both sliders and numbers)
            // We select by data-idx, and since range/number share it, this updates both
            const inputs = inpValuesDiv.querySelectorAll('input');
            inputs.forEach(inp => {
                const idx = parseInt(inp.dataset.idx!);
                let val = newValues[idx];
                
                if (model === 'RGB') {
                    val *= 255;
                    inp.value = Math.round(val).toString();
                } else if (model === 'CMYK' || model === 'Gray') {
                    val *= 100;
                    inp.value = parseFloat(val.toFixed(2)).toString();
                } else if (model === 'LAB') {
                    // LAB usually doesn't require scaling if rgbToLab returns standard LAB,
                    // but handleValueInput logic relies on standard ranges.
                    inp.value = parseFloat(val.toFixed(2)).toString();
                }
            });
            
            updateSidebarPreview();
        }
    }
}

function handleNativePicker(e: Event) {
    const target = e.target as HTMLInputElement;
    inpHex.value = target.value.replace('#', '').toUpperCase();
    handleHexInput();
}

/* -------------------------------------------------------------------------- */
/* DRAG & DROP (REORDERING)                                                   */
/* -------------------------------------------------------------------------- */

function handleSwatchDragStart(e: DragEvent, index: number) {
    state.dragSourceIndex = index;
    if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', index.toString());
        e.dataTransfer.effectAllowed = 'copyMove';
    }
}

function handleSwatchDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
    }
    
    const target = (e.target as HTMLElement).closest('[draggable]');
    if (target) {
        target.classList.add('opacity-60');
    }
}

function handleSwatchDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('[draggable]');
    if (target) target.classList.remove('opacity-60');

    const sourceIndexStr = e.dataTransfer?.getData('text/plain');
    if (!sourceIndexStr) return;
    
    const sourceIndex = parseInt(sourceIndexStr);
    // Allow drop on self only if copying (Alt key)
    if (isNaN(sourceIndex) || (sourceIndex === targetIndex && !e.altKey)) return;
    
    pushHistory();

    if (e.altKey) {
        // DUPLICATE LOGIC
        const originalItem = state.aseData.blocks[sourceIndex];
        // Deep copy
        const newItem = JSON.parse(JSON.stringify(originalItem));
        newItem.name = (newItem.name || '') + ' Copy';
        
        // Insert at target index
        state.aseData.blocks.splice(targetIndex, 0, newItem);
        
        // Select the new copy
        state.currentSelection = targetIndex;
        
        renderUI();
        updateEditorPanelState();
        showToast("Swatch duplicated", 'success');
    } else {
        // MOVE LOGIC
        const [movedItem] = state.aseData.blocks.splice(sourceIndex, 1);
        state.aseData.blocks.splice(targetIndex, 0, movedItem);
        
        // Correct selection index if needed
        if (state.currentSelection === sourceIndex) {
            state.currentSelection = targetIndex;
        } else {
            // If we inserted before current selection, it shifts up
            if (targetIndex <= state.currentSelection && sourceIndex > state.currentSelection) {
                state.currentSelection++;
            } 
            // If we removed from before current selection, it shifts down
            else if (sourceIndex < state.currentSelection && targetIndex >= state.currentSelection) {
                state.currentSelection--;
            }
        }
        
        renderUI();
        updateEditorPanelState();
    }
}

function getTypeLabel(type: number | undefined): string {
    if (type === 0) return 'Global';
    if (type === 1) return 'Spot';
    return 'Process';
}
