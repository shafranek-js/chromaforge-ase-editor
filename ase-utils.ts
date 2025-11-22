
import { AseData } from "./types";

export function parseASE(buffer: ArrayBuffer): AseData {
    const view = new DataView(buffer);
    let offset = 0;

    const signature = getChar(view, offset, 4); offset += 4;
    if (signature !== 'ASEF') throw new Error("Invalid File Signature (Not ASE)");

    const verMaj = view.getUint16(offset); offset += 2;
    const verMin = view.getUint16(offset); offset += 2;
    const blockCount = view.getUint32(offset); offset += 4;

    const data: AseData = { version: [verMaj, verMin], blocks: [] };

    for (let i = 0; i < blockCount; i++) {
        const blockType = view.getUint16(offset); offset += 2;
        const blockLen = view.getUint32(offset); offset += 4;
        const endOfBlock = offset + blockLen;

        if (blockType === 0xC001) { 
            const nameLen = view.getUint16(offset); offset += 2;
            const name = getUTF16String(view, offset, nameLen); offset += (nameLen * 2);
            data.blocks.push({ type: 'groupStart', name: name });
        } 
        else if (blockType === 0xC002) { 
            data.blocks.push({ type: 'groupEnd' });
        } 
        else if (blockType === 0x0001) { 
            const nameLen = view.getUint16(offset); offset += 2;
            const name = getUTF16String(view, offset, nameLen); offset += (nameLen * 2);
            const model = getChar(view, offset, 4) as any; offset += 4;
            
            let values: number[] = [];
            let numChannels = 0;
            if (model === 'CMYK') numChannels = 4;
            else if (model === 'RGB ' || model === 'LAB ') numChannels = 3;
            else if (model === 'Gray') numChannels = 1;

            for(let k=0; k<numChannels; k++){
                values.push(view.getFloat32(offset)); offset += 4;
            }

            const colorType = view.getUint16(offset); 
            offset += 2; // Explicitly advance past colorType

            data.blocks.push({
                type: 'color',
                name: name.replace(/\0/g, ''), 
                model: model,
                values: values,
                colorType: colorType
            });
        }
        offset = endOfBlock; 
    }
    return data;
}

export function createASEBuffer(data: AseData): Blob {
    const parts: ArrayBuffer[] = [];
    parts.push(strToBytes("ASEF"));
    parts.push(u16(data.version[0]));
    parts.push(u16(data.version[1]));
    parts.push(u32(data.blocks.length));

    for (let block of data.blocks) {
        if (block.type === 'groupStart' && block.name) {
            let chunk: ArrayBuffer[] = [u16(0xC001)];
            let nameBytes = strToUTF16Bytes(block.name + '\0');
            let len = 2 + nameBytes.byteLength;
            chunk.push(u32(len));
            chunk.push(u16(block.name.length + 1));
            chunk.push(nameBytes);
            parts.push(mergeBuffers(chunk));
        } 
        else if (block.type === 'groupEnd') {
            parts.push(mergeBuffers([u16(0xC002), u32(0)]));
        } 
        else if (block.type === 'color' && block.name && block.values) {
            let chunk: ArrayBuffer[] = [u16(0x0001)];
            
            let nameBytes = strToUTF16Bytes(block.name + '\0');
            let modelBytes = strToBytes(block.model || 'RGB ');
            let valBytesLen = block.values.length * 4;
            let payloadLen = 2 + nameBytes.byteLength + 4 + valBytesLen + 2;

            chunk.push(u32(payloadLen));
            chunk.push(u16(block.name.length + 1));
            chunk.push(nameBytes);
            chunk.push(modelBytes);
            
            let fView = new DataView(new ArrayBuffer(valBytesLen));
            block.values.forEach((v, i) => fView.setFloat32(i*4, v)); 
            chunk.push(fView.buffer);

            chunk.push(u16(block.colorType || 2));
            parts.push(mergeBuffers(chunk));
        }
    }

    return new Blob(parts, { type: "application/octet-stream" });
}

// Internal Helpers
function getChar(view: DataView, offset: number, length: number) {
    let str = '';
    for(let i=0; i<length; i++) str += String.fromCharCode(view.getUint8(offset+i));
    return str;
}

function getUTF16String(view: DataView, offset: number, length: number) {
    let str = '';
    for(let i=0; i<length-1; i++) { 
        str += String.fromCharCode(view.getUint16(offset + (i*2)));
    }
    return str;
}

function u16(val: number) {
    const b = new ArrayBuffer(2);
    new DataView(b).setUint16(0, val);
    return b;
}

function u32(val: number) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, val);
    return b;
}

function strToBytes(str: string) {
    const buf = new Uint8Array(str.length);
    for(let i=0; i<str.length; i++) buf[i] = str.charCodeAt(i);
    return buf.buffer;
}

function strToUTF16Bytes(str: string) {
    const buf = new ArrayBuffer(str.length * 2);
    const view = new DataView(buf);
    for(let i=0; i<str.length; i++) view.setUint16(i*2, str.charCodeAt(i));
    return buf;
}

function mergeBuffers(chunks: ArrayBuffer[]) {
    let total = 0;
    chunks.forEach(c => total += c.byteLength);
    let res = new Uint8Array(total);
    let off = 0;
    chunks.forEach(c => {
        res.set(new Uint8Array(c), off);
        off += c.byteLength;
    });
    return res.buffer;
}
