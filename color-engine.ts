
import { instantiate } from "./lcms.js";

// --- PIXEL TYPE CONSTANTS ---
const DEFAULT_TYPE_RGB_8 = 262169;
const DEFAULT_TYPE_CMYK_8 = 393249; 

// State
let cmykTransform: any = null;
let isReady = false;
let Module: any = null;

// Fallback math
function simpleCmykToRgb(c: number, m: number, y: number, k: number): number[] {
    const r = 255 * (1 - c) * (1 - k);
    const g = 255 * (1 - m) * (1 - k);
    const b = 255 * (1 - y) * (1 - k);
    return [Math.round(r), Math.round(g), Math.round(b)];
}

// Helper to fetch binary with 404 check
async function fetchProfileData(url: string): Promise<ArrayBuffer | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[ColorEngine] Failed to fetch ${url}: ${res.status} ${res.statusText}`);
            return null;
        }
        return await res.arrayBuffer();
    } catch (e) {
        console.warn(`[ColorEngine] Network error fetching ${url}`, e);
        return null;
    }
}

export async function initColorEngine() {
    console.log("Initializing ICC Color Engine (LittleCMS)...");

    try {
        // 1. Instantiate WASM
        Module = await instantiate({
            print: (text: string) => console.log('[LCMS]', text),
            printErr: (text: string) => console.warn('[LCMS Error]', text),
            locateFile: (path: string, prefix: string) => {
                if (path.endsWith('.wasm')) {
                    return 'https://cdn.jsdelivr.net/npm/lcms-wasm@1.0.5/dist/lcms.wasm';
                }
                return prefix + path;
            }
        });

        // 2. FETCH PROFILES
        // Ensure these filenames match exactly what is in your public folder
        const cmykUrl = '/CoatedFOGRA39.icc'; 
        const srgbUrl = '/sRGB_v4_ICC_preference.icc'; // Or 'sRGB Color Space Profile.icm'

        const cmykData = await fetchProfileData(cmykUrl);
        const srgbData = await fetchProfileData(srgbUrl);

        if (!cmykData) {
            console.error("CRITICAL: CoatedFOGRA39.icc could not be loaded. CMYK conversion will be incorrect.");
            return; // Cannot proceed without Source Profile
        }

        // 3. Setup LCMS Functions
        const openProfile = Module._cmsOpenProfileFromMem;
        const createSRGB = Module._cmsCreate_sRGBProfile;
        const createTransform = Module._cmsCreateTransform;
        const malloc = Module._malloc;
        const free = Module._free;

        // Helper to load buffer into WASM heap
        const loadToHeap = (buffer: ArrayBuffer) => {
            const arr = new Uint8Array(buffer);
            const ptr = malloc(arr.length);
            Module.HEAPU8.set(arr, ptr);
            return { ptr, len: arr.length };
        };

        // 4. Create Profile Handles
        // A) CMYK Source
        const cmykMem = loadToHeap(cmykData);
        const cmykPtr = openProfile(cmykMem.ptr, cmykMem.len);
        free(cmykMem.ptr); // Free buffer immediately

        // B) RGB Destination
        let srgbPtr = 0;
        if (srgbData) {
            const srgbMem = loadToHeap(srgbData);
            srgbPtr = openProfile(srgbMem.ptr, srgbMem.len);
            free(srgbMem.ptr);
        } 
        
        if (!srgbPtr) {
            console.log("[ColorEngine] sRGB profile missing or invalid. Using built-in sRGB generator.");
            srgbPtr = createSRGB();
        }

        if (!cmykPtr || !srgbPtr) {
            throw new Error("Failed to create internal profile handles.");
        }

        // 5. Create Transform Link
        cmykTransform = createTransform(
            cmykPtr, DEFAULT_TYPE_CMYK_8,
            srgbPtr, DEFAULT_TYPE_RGB_8,
            1, // INTENT_RELATIVE_COLORIMETRIC
            0x2000 | 0x0040 // BPC | NOCACHE
        );

        // Clean up handles (transform keeps what it needs)
        if (Module._cmsCloseProfile) {
            Module._cmsCloseProfile(cmykPtr);
            Module._cmsCloseProfile(srgbPtr);
        }

        if (cmykTransform) {
            isReady = true;
            console.log("✅ ICC Color Engine Ready: Fogra39 -> sRGB");
        }

    } catch (e) {
        console.warn("❌ Color Engine Init Failed:", e);
    }
}

export function cmykToProfileRGB(c: number, m: number, y: number, k: number): number[] {
    // Fallback Logic
    if (!isReady || !cmykTransform) return simpleCmykToRgb(c, m, y, k);

    try {
        const malloc = Module._malloc;
        const free = Module._free;
        const doTransform = Module._cmsDoTransform;

        const srcData = new Uint8Array([
            Math.round(c * 255), Math.round(m * 255), 
            Math.round(y * 255), Math.round(k * 255)
        ]);

        const srcPtr = malloc(4);
        const dstPtr = malloc(3);

        Module.HEAPU8.set(srcData, srcPtr);
        doTransform(cmykTransform, srcPtr, dstPtr, 1);

        const r = Module.HEAPU8[dstPtr];
        const g = Module.HEAPU8[dstPtr + 1];
        const b = Module.HEAPU8[dstPtr + 2];

        free(srcPtr);
        free(dstPtr);

        return [r, g, b];
    } catch (e) {
        return simpleCmykToRgb(c, m, y, k);
    }
}
