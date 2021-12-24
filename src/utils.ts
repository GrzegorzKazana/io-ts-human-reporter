export function mapValues<R extends Record<keyof any, unknown>, T>(
    obj: R,
    fn: (v: R[keyof R], k: string) => T,
): { [K in keyof R]: T } {
    const typedEntries = Object.entries(obj) as Array<[keyof R, R[keyof R]]>;

    return typedEntries.reduce((acc, [k, v]) => {
        acc[k] = fn(v, k as string);
        return acc;
    }, {} as { [K in keyof R]: T });
}

export function isNotEmpty<R extends Record<string, unknown>>(obj: R): boolean {
    return Object.keys(obj).length !== 0;
}

export function hasKey<K extends string, R extends object>(
    obj: R,
    key: K,
): obj is R & { [key in K]: unknown } {
    return key in obj;
}

export function isObject(item: unknown): item is Record<keyof any, unknown> {
    return !!item && typeof item === 'object';
}

export function isString(item: unknown): item is string {
    return typeof item === 'string';
}
