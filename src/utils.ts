export function head<T>(arr: ReadonlyArray<T>): T | null {
    return arr[0] || null;
}

export function initTail<T>(arr: ReadonlyArray<T>): [T[], T | null] {
    return [arr.slice(0, arr.length - 1), arr[arr.length - 1] || null];
}

export function isNotNullable<T>(a: T | null | undefined): a is T {
    return a !== null && a !== undefined;
}

export function dedupe<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}

export type DeepPartial<T> = T extends Record<keyof any, unknown>
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;
