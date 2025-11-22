
export interface Block {
    type: 'groupStart' | 'groupEnd' | 'color';
    name?: string;
    model?: 'RGB ' | 'CMYK' | 'Gray' | 'LAB ';
    values?: number[];
    colorType?: number; // 0=Global, 1=Spot, 2=Normal
}

export interface AseData {
    version: [number, number];
    blocks: Block[];
}

export interface FlatListItem {
    index: number;
    element: HTMLElement;
}
