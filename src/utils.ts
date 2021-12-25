import { Refinement } from 'fp-ts/Refinement';
import { Predicate } from 'fp-ts/Predicate';

export function head<T>(arr: ReadonlyArray<T>): T | null {
    return arr[0] || null;
}

export function groupBy<T, K extends string>(arr: T[], by: (a: T) => K): Record<K, T[]> {
    return arr.reduce((acc, item) => {
        const key = by(item);
        if (!acc[key]) acc[key] = [];

        acc[key].push(item);

        return acc;
    }, {} as Record<string, T[]>);
}

export function isNotNullable<T>(a: T | null | undefined): a is T {
    return a !== null && a !== undefined;
}

export function isNotFalsy<T>(a: T): a is Exclude<T, null | undefined | '' | 0 | false> {
    return a !== null && a !== undefined;
}

export function findMap<T, U>(arr: T[], mapper: (a: T) => U, pred = Boolean): U | null {
    for (const element of arr) {
        const mapped = mapper(element);
        if (pred(mapped)) return mapped;
    }
    return null;
}

export function filterMap<T, U, V extends U>(
    arr: T[],
    mapper: (a: T) => U,
    pred: Refinement<U, V>,
): V[];
export function filterMap<T, U, P extends Predicate<U>>(
    arr: T[],
    mapper: (a: T) => U,
    pred: P,
): U[] {
    return arr.reduce((acc, item) => {
        const mapped = mapper(item);
        if (pred(mapped)) acc.push(mapped);
        return acc;
    }, [] as U[]);
}

export function maxByAll<T>(arr: T[], by: (a: T) => number): T[] {
    return arr.reduce<[T[], number]>(
        ([maxUtilNow, max], item) => {
            const value = by(item);

            if (value < max) return [maxUtilNow, max];
            if (value === max) return [[...maxUtilNow, item], max];

            return [[item], value];
        },
        [[], Number.NEGATIVE_INFINITY],
    )[0];
}

export function minByAll<T>(arr: T[], by: (a: T) => number): T[] {
    return maxByAll(arr, a => -by(a));
}

export function intersection<T>(arrA: T[], arrB: T[]): T[] {
    return arrA.filter(a => arrB.includes(a));
}

export function hasKey<K extends string, R extends object>(
    obj: R,
    key: K,
): obj is R & { [key in K]: unknown } {
    return key in obj;
}

export function isNotEmpty(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).length !== 0;
}
