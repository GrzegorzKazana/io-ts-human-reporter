import { Refinement } from 'fp-ts/Refinement';
import { Predicate } from 'fp-ts/Predicate';

export type DeepPartial<T> = T extends Record<keyof any, unknown>
    ? {
          [P in keyof T]?: DeepPartial<T[P]>;
      }
    : T;

export function head<T>(arr: ReadonlyArray<T>): T | null {
    return arr[0] || null;
}

export function initTail<T>(arr: ReadonlyArray<T>): [T[], T | null] {
    return [arr.slice(0, arr.length - 1), arr[arr.length - 1] || null];
}

export function groupBy<T, K extends string>(arr: T[], by: (a: T) => K): Record<K, T[]> {
    return arr.reduce((acc, item) => {
        const key = by(item);
        const group = acc[key] || [];

        group.push(item);
        acc[key] = group;

        return acc;
    }, {} as Record<string, T[]>);
}

export function isNotNullable<T>(a: T | null | undefined): a is T {
    return a !== null && a !== undefined;
}

export function isNotFalsy<T>(a: T): a is Exclude<T, null | undefined | '' | 0 | false> {
    return !!a;
}

export function isNotEmpty(obj: Record<string, unknown>): boolean {
    return Object.keys(obj).length !== 0;
}

export function findMap<T, U>(
    arr: T[],
    mapper: (a: T, i: number) => U,
    pred: Predicate<U> = Boolean,
): U | null {
    for (const [idx, element] of Array.from(arr.entries())) {
        const mapped = mapper(element, idx);
        if (pred(mapped)) return mapped;
    }
    return null;
}

export function filterMap<T, U, V extends U>(
    arr: T[],
    mapper: (a: T, i: number) => U,
    pred: Refinement<U, V>,
): V[];
export function filterMap<T, U>(
    arr: T[],
    mapper: (a: T, i: number) => U,
    pred: Predicate<U> = Boolean,
): U[] {
    return arr.reduce((acc, item, idx) => {
        const mapped = mapper(item, idx);
        if (pred(mapped)) acc.push(mapped);
        return acc;
    }, [] as U[]);
}

export function mapMaxBy<T>(arr: T[], by: (a: T) => number): number {
    return Math.max(...arr.map(by));
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

export function multiMaxByAll<T>(arr: T[], by: (a: T) => number[]): T[] {
    return arr.reduce<[T[], number[]]>(
        ([maxUtilNow, max], item) => {
            const value = by(item);

            switch (multiCriterionCompare(value, max)) {
                case Order.EQ:
                    return [[...maxUtilNow, item], max];
                case Order.GT:
                    return [[item], value];
                case Order.LT:
                    return [maxUtilNow, max];
            }
        },
        [[], [Number.NEGATIVE_INFINITY]],
    )[0];
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

export function sortBy<T>(arr: T[], by: (a: T) => number): T[] {
    return arr
        .map(a => [a, by(a)] as const)
        .sort(([, a], [, b]) => b - a)
        .map(([a]) => a);
}

enum Order {
    GT = 1,
    LT = -1,
    EQ = 0,
}

/**
 * Returns true if any of numbers from A will be grater before any number from B will be grater
 * [1,2,3], [1,1,1] -> 1
 * [1,2,3], [1,3,1] -> -1
 * [1,2,3], [1,2,3] -> 0
 */
export function multiCriterionCompare(arrA: number[], arrB: number[]): Order {
    return (
        findMap(arrA, (a, idx) => {
            const corresponding = arrB[idx];

            return corresponding === undefined
                ? Order.EQ
                : a > corresponding
                ? Order.GT
                : a < corresponding
                ? Order.LT
                : Order.EQ;
        }) || Order.EQ
    );
}

export function dedupe<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}
