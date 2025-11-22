
import { Block } from "./types";
import Color from "colorjs.io";
import { getOfficialHex, getOfficialEntry, PantoneEntry } from "./pantone-library";
import { cmykToProfileRGB } from "./color-engine";

/**
 * Converts a block to a valid CSS color string.
 * Wraps the raw RGB array in rgb() format.
 */
export function getCSSColor(block: Block): string {
    const rgb = blockToRgb(block);
    
    // Clamp values to 0-1 range to prevent CSS errors if profile returns outliers
    const r = Math.min(1, Math.max(0, rgb[0]));
    const g = Math.min(1, Math.max(0, rgb[1]));
    const b = Math.min(1, Math.max(0, rgb[2]));
    
    return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`;
}

export function getHexFromBlock(block: Block): string {
   const css = getCSSColor(block);
   const match = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
   if (match) {
       const r = parseInt(match[1]);
       const g = parseInt(match[2]);
       const b = parseInt(match[3]);
       // Bitwise shift to convert to Hex
       return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
   }
   return '#000000';
}

// Helper: Convert Hex String to Normalized RGB Array [0-1, 0-1, 0-1]
export function hexToRgb(hex: string): number[] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];
    return [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
    ];
}

/**
 * Checks if the block's current values closely match the official definition.
 * If they deviate, the user likely edited them, so we should not enforce the Authority Hex.
 */
function isStandardPantone(block: Block, entry: PantoneEntry): boolean {
    const values = block.values || [];
    const model = (block.model || 'RGB').trim();
    
    // Reduced tolerance to avoid snapping custom colors (was 0.15)
    const TOLERANCE = 0.01; 

    if (model === 'CMYK') {
        // Entry values are strings 0-100
        const c = parseInt(entry.C) / 100;
        const m = parseInt(entry.M) / 100;
        const y = parseInt(entry.Y) / 100;
        const k = parseInt(entry.K) / 100;
        
        return Math.abs(values[0] - c) < TOLERANCE &&
               Math.abs(values[1] - m) < TOLERANCE &&
               Math.abs(values[2] - y) < TOLERANCE &&
               Math.abs(values[3] - k) < TOLERANCE;
    } 
    else if (model === 'RGB') {
        // Entry values are strings 0-255
        const r = parseInt(entry.R) / 255;
        const g = parseInt(entry.G) / 255;
        const b = parseInt(entry.B) / 255;

        return Math.abs(values[0] - r) < TOLERANCE &&
               Math.abs(values[1] - g) < TOLERANCE &&
               Math.abs(values[2] - b) < TOLERANCE;
    }

    // For LAB or Gray, we assume if it's a named Pantone, it matches.
    // Users rarely manually edit LAB values to 'almost' match a Pantone.
    return true; 
}

/**
 * Determines if the block is using Authoritative Data (Verified).
 * Returns true if the hex is derived from the library/overrides rather than math.
 */
export function isAuthoritative(block: Block): boolean {
    if (!block.name) return false;

    const officialEntry = getOfficialEntry(block.name);
    
    if (officialEntry) {
        // It is verified if the values match the standard
        return isStandardPantone(block, officialEntry);
    }
    
    // If not in main DB, check if it's a manual override (e.g. Neon) that we forcefully fixed.
    return !!getOfficialHex(block.name);
}

/**
 * MAIN CONVERSION PIPELINE
 * Hierarchy of Truth:
 * 1. Authority (Name Check) - Fixes Neons & Corrupt Data (ONLY if values haven't been edited)
 * 2. ICC Profile (Wasm) - Professional Print Simulation
 * 3. LAB Values - Spectral Accuracy
 * 4. RGB/Gray - Pass through
 */
export function blockToRgb(block: Block): number[] {
    const m = (block.model || 'RGB').trim();
    const v = block.values || [];
    
    if (!v || v.length === 0) return [0, 0, 0];

    // 1. AUTHORITY CHECK (Reference-Based Rendering)
    // This overrides the math if we know the "True" color by name AND the values haven't been touched.
    if (block.name) {
        const officialEntry = getOfficialEntry(block.name);
        
        if (officialEntry) {
            // Only use the authoritative hex if the current values actually match 
            // the standard definition. If they differ, user edited them -> Use Math.
            if (isStandardPantone(block, officialEntry)) {
                return hexToRgb(officialEntry.Hex);
            }
        } else {
            // Fallback for overrides that might not be in the main JSON (like PANTONE_OVERRIDES specific keys)
            const officialHex = getOfficialHex(block.name);
            if (officialHex) return hexToRgb(officialHex);
        }
    }

    // 2. CMYK: THE PROFESSIONAL PIPELINE (LittleCMS)
    if (m === 'CMYK') {
        // ASE files store 0.0 - 1.0 floats
        const c = v[0] || 0;
        const mVal = v[1] || 0;
        const y = v[2] || 0;
        const k = v[3] || 0;

        // Call the Wasm Engine (returns 0-255)
        const [r255, g255, b255] = cmykToProfileRGB(c, mVal, y, k);

        // Normalize back to 0.0 - 1.0 for app consistency
        return [r255 / 255, g255 / 255, b255 / 255];
    }
    
    // 3. LAB: Standard Math
    if (m === 'LAB') {
        return labToRgbValues(v[0]||0, v[1]||0, v[2]||0);
    }

    // 4. RGB: Pass through
    if (m === 'RGB') {
        return [v[0]||0, v[1]||0, v[2]||0];
    }

    // 5. Gray: Simple Gray
    if (m === 'Gray') {
        return [v[0]||0, v[0]||0, v[0]||0];
    }

    return [0, 0, 0];
}

/* -------------------------------------------------------------------------- */
/* HELPER CONVERSIONS & ACCESSIBILITY                                         */
/* -------------------------------------------------------------------------- */

export function labToRgbValues(L: number, a: number, b: number): number[] {
    let validL = L;
    // ASE usually stores 0.0-1.0 for Lightness? Actually L is typically 0-100.
    // But some parsers normalize it. If it's small, we scale it up.
    if (validL <= 1.05 && validL > 0) validL = validL * 100;

    let y = (validL + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    const refX = 96.422; 
    const refY = 100.000;
    const refZ = 82.521;

    const epsilon = 0.008856;
    const kappa = 903.3;

    const x3 = Math.pow(x, 3);
    const y3 = Math.pow(y, 3);
    const z3 = Math.pow(z, 3);

    x = (x3 > epsilon ? x3 : (116 * x - 16) / kappa) * refX;
    y = (y3 > epsilon ? y3 : (116 * y - 16) / kappa) * refY;
    z = (z3 > epsilon ? z3 : (116 * z - 16) / kappa) * refZ;

    x = x / 100;
    y = y / 100;
    z = z / 100;

    // Bradford Adaptation to D65
    const X50 = x; const Y50 = y; const Z50 = z;
    x = X50 * 0.9555766 + Y50 * -0.0230393 + Z50 * 0.0631636;
    y = X50 * -0.0282895 + Y50 * 1.0099416 + Z50 * 0.0210077;
    z = X50 * 0.0122982 + Y50 * -0.0204830 + Z50 * 1.3299098;

    // Linear RGB
    const rLin = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    const gLin = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
    const bLin = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

    const toSrgb = (v: number) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;

    return [
        Math.min(1, Math.max(0, toSrgb(rLin))),
        Math.min(1, Math.max(0, toSrgb(gLin))),
        Math.min(1, Math.max(0, toSrgb(bLin)))
    ];
}

export function rgbToLab(r: number, g: number, b: number): number[] {
    // Convert RGB to XYZ first
    let rLin = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    let gLin = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    let bLin = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    rLin *= 100;
    gLin *= 100;
    bLin *= 100;

    const x = rLin * 0.4124 + gLin * 0.3576 + bLin * 0.1805;
    const y = rLin * 0.2126 + gLin * 0.7152 + bLin * 0.0722;
    const z = rLin * 0.0193 + gLin * 0.1192 + bLin * 0.9505;

    // XYZ to Lab
    const refX = 96.422; 
    const refY = 100.000;
    const refZ = 82.521;

    let xVal = x / refX;
    let yVal = y / refY;
    let zVal = z / refZ;

    const epsilon = 0.008856;
    const kappa = 903.3;

    xVal = xVal > epsilon ? Math.pow(xVal, 1/3) : (kappa * xVal + 16) / 116;
    yVal = yVal > epsilon ? Math.pow(yVal, 1/3) : (kappa * yVal + 16) / 116;
    zVal = zVal > epsilon ? Math.pow(zVal, 1/3) : (kappa * zVal + 16) / 116;

    const L = (116 * yVal) - 16;
    const A = 500 * (xVal - yVal);
    const B = 200 * (yVal - zVal);

    return [L, A, B];
}

export function rgbToCmyk(r: number, g: number, b: number): number[] {
    let c = 1 - r;
    let m = 1 - g;
    let y = 1 - b;
    let k = Math.min(c, Math.min(m, y));
    
    if (k === 1) return [0, 0, 0, 1];
    
    c = (c - k) / (1 - k);
    m = (m - k) / (1 - k);
    y = (y - k) / (1 - k);
    
    return [c, m, y, k];
}

export function rgbToGray(r: number, g: number, b: number): number[] {
    // Standard Rec. 601 Luma
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    return [gray];
}

function getLuminance(r: number, g: number, b: number) {
    const a = [r, g, b].map(v => {
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function getContrastRatio(block: Block) {
    const rgb = blockToRgb(block);
    const lum = getLuminance(rgb[0], rgb[1], rgb[2]);
    
    // Contrast against White (1.0)
    const whiteLum = 1.0;
    const ratioWhite = (whiteLum + 0.05) / (lum + 0.05);
    
    // Contrast against Black (0.0)
    const blackLum = 0.0;
    const ratioBlack = (lum + 0.05) / (blackLum + 0.05);
    
    return {
        white: parseFloat(ratioWhite.toFixed(2)),
        black: parseFloat(ratioBlack.toFixed(2))
    };
}

export function getBestTextColor(block: Block): string {
    const ratios = getContrastRatio(block);
    return ratios.white > ratios.black ? '#FFFFFF' : '#000000';
}

export function getChannelValuesText(block: Block): string {
    const v = block.values || [];
    const m = (block.model || 'RGB').trim();
    
    if (m === 'RGB') {
        return `R:${Math.round((v[0]||0)*255)} G:${Math.round((v[1]||0)*255)} B:${Math.round((v[2]||0)*255)}`;
    }
    if (m === 'CMYK') {
        return `C:${Math.round((v[0]||0)*100)} M:${Math.round((v[1]||0)*100)} Y:${Math.round((v[2]||0)*100)} K:${Math.round((v[3]||0)*100)}`;
    }
    if (m === 'LAB') {
        let L = v[0]||0;
        if (L <= 1.05 && L > 0) L = L * 100;
        return `L:${L.toFixed(0)} A:${(v[1]||0).toFixed(0)} B:${(v[2]||0).toFixed(0)}`;
    }
    if (m === 'Gray') {
        return `K:${Math.round((v[0]||0)*100)}%`;
    }
    return '';
}
