import * as t from 'io-ts';
import { isLeft } from 'fp-ts/Either';

import {
    head,
    groupBy,
    multiMaxByAll,
    intersection,
    filterMap,
    isNotFalsy,
    isNotNullable,
    sortBy,
    dedupe,
    initTail,
} from './utils';
import { Codec, AnyDecoder } from './codecs';

export type ErrorFirstContextInfo = {
    key: string;
    type: AnyDecoder;
    actual: unknown;
    isExhausted: boolean;
    levelsUntilExhaustion: number;
    wasParentExhausted: boolean;
};
export type ErrorsExt = t.ValidationError & ErrorFirstContextInfo;
export type InputError = t.ValidationError & Partial<ErrorFirstContextInfo>;
export type Options = Partial<{ path: string[]; parentType: AnyDecoder | null }>;

export const messages = {
    path: (path: string[]) => path.join('.'),

    missing: (key: string, path: string[]) =>
        `missing property '${key}' at '${messages.path(path)}'`,

    mismatch: (key: string, path: string[], actual: unknown, expected: AnyDecoder) =>
        `got '${actual}' expected '${expected.name}' at '${messages.path([...path, key])}'`,

    custom: (msg: string, path: string[]) => `${msg} at '${messages.path(path)}'`,
};

export function report(validation: t.Validation<unknown>): string | null {
    return isLeft(validation) ? explain(validation.left) : null;
}

export function reportAll(validation: t.Validation<unknown>): string[] {
    return isLeft(validation) ? explainAll(validation.left) : [];
}

function explain(
    errors: Array<InputError>,
    { path = [], parentType = null }: Options = {},
): string | null {
    const errorsOnLevelsBelow = errors.map(attachExtraInfoToError).filter(isNotNullable);
    const errorsByPath = groupBy(errorsOnLevelsBelow, ({ key }) => key);

    const errorToReport =
        head(detectTypeMismatches(parentType, path, errorsByPath)) ||
        head(detectMissingProperties(path, errorsOnLevelsBelow));

    if (errorToReport) return errorToReport;

    const branch = head(filterBranches(parentType, errorsByPath));

    if (!branch) return null;

    const [branchKey, branchSubErrors] = branch;
    const firstError = head(branchSubErrors);

    if (!firstError) return null;

    return explain(branchSubErrors, {
        path: shouldExtendPath(branchKey, path, parentType) ? [...path, branchKey] : path,
        parentType: firstError.type,
    });
}

function explainAll(
    errors: Array<InputError>,
    { path = [], parentType = null }: Options = {},
): string[] {
    const errorsOnLevelsBelow = errors.map(attachExtraInfoToError).filter(isNotNullable);
    const errorsByPath = groupBy(errorsOnLevelsBelow, ({ key }) => key);

    const errorsToReport = dedupe([
        ...detectTypeMismatches(parentType, path, errorsByPath),
        ...detectMissingProperties(path, errorsOnLevelsBelow),
    ]);

    const branches = filterBranches(parentType, errorsByPath);

    const subReports = branches.flatMap(([branchKey, branchSubErrors]) => {
        const firstError = head(branchSubErrors);

        if (!firstError) return [];

        return explainAll(branchSubErrors, {
            path: shouldExtendPath(branchKey, path, parentType) ? [...path, branchKey] : path,
            parentType: firstError.type,
        });
    });

    return [...errorsToReport, ...subReports];
}

function detectTypeMismatches(
    parentType: AnyDecoder | null,
    path: string[],
    currentErrorContextsRecord: Record<string, Array<ErrorsExt>>,
): string[] {
    return Object.values(currentErrorContextsRecord).flatMap(currentErrorContexts => {
        const allExhausted = currentErrorContexts.every(({ isExhausted }) => isExhausted);

        return filterMap(
            currentErrorContexts,
            ({ key, type, actual, message, isExhausted }) => {
                // property missing/undefined
                if (actual === undefined) return null;
                // if parent type is union, we do not want to report the error yet
                // (will happen in deeper recursion level)
                if (Codec.is.union(parentType)) return null;
                // if current type is intersection, we also do not want to report yet
                // (will happen when analysing intersection components)
                if (Codec.is.intersection(type)) return null;

                // keys of intersection components relate to inner intersection ordering,
                // which probably is not what the end user is interested in
                const [adjustedPath, adjustedKey] = Codec.is.intersection(parentType)
                    ? initTail(path)
                    : [path, key];

                const error =
                    message !== undefined
                        ? messages.custom(message, adjustedPath)
                        : messages.mismatch(adjustedKey || '', adjustedPath, actual, type);

                // no way to narrow down the type
                if (allExhausted) return error;

                // not all errors are exhausted, try to narrow down the union later
                if (Codec.is.union(type) || !isExhausted) return null;

                // cannot be narrowed down - report error now
                return error;
            },
            isNotFalsy,
        );
    });
}

function detectMissingProperties(path: string[], currentErrorContexts: Array<ErrorsExt>): string[] {
    return filterMap(
        currentErrorContexts,
        ({ key, actual, message, wasParentExhausted }) => {
            if (actual !== undefined) return null;

            // we only report as long as the missing key was not already reported
            if (wasParentExhausted) return null;

            return message !== undefined
                ? messages.custom(message, path)
                : messages.missing(key, path);
        },
        isNotFalsy,
    );
}

function attachExtraInfoToError({ context, ...rest }: InputError): ErrorsExt | null {
    const [head, ...tail] = context;
    if (!head) return null;

    return {
        ...rest,
        context: tail,
        key: head.key,
        type: head.type,
        actual: head.actual,
        isExhausted: tail.every(({ actual }) => actual === head.actual),
        // find first change of `actual`
        levelsUntilExhaustion: context.findIndex(
            ({ actual }, idx) => context[idx + 1] && actual !== context[idx + 1].actual,
        ),
        wasParentExhausted: !!rest.isExhausted,
    };
}

function shouldExtendPath(
    branchKey: string,
    path: string[],
    parentType: AnyDecoder | null,
): boolean {
    const isRoot = !path.length && !branchKey;

    return !Codec.is.union(parentType) && !Codec.is.intersection(parentType) && !isRoot;
}

function maxLevelsUntilExhaustion(errors: Array<ErrorsExt>): number {
    return Math.max(...errors.map(({ levelsUntilExhaustion }) => levelsUntilExhaustion));
}

function filterBranches(
    parentType: AnyDecoder | null,
    branchRecord: Record<string, Array<ErrorsExt>>,
): Array<[string, Array<ErrorsExt>]> {
    const branches = sortBy(Object.entries(branchRecord), ([_, errorsInBranch]) =>
        maxLevelsUntilExhaustion(errorsInBranch),
    );

    return Codec.is.union(parentType) ? selectBestUnionVariant(branches) : branches;
}

function selectBestUnionVariant(
    branches: Array<[string, Array<ErrorsExt>]>,
): Array<[string, Array<ErrorsExt>]> {
    return multiMaxByAll(branches, ([_, errorsInBranch]) => {
        const scores = errorsInBranch.map(
            ({ type, actual }) =>
                scoreObjectSimilarity(type, actual) ??
                scoreArraySimilarity(type, actual) ??
                scoreTupleSimilarity(type, actual) ??
                -1,
        );

        return [
            Math.max(...scores),
            // in case any above scoring method fails,
            // pick the variant which can be narrowed down the most
            maxLevelsUntilExhaustion(errorsInBranch),
        ];
    }).slice(0, 1);
}

function scoreObjectSimilarity(type: AnyDecoder, actual: unknown): number | null {
    const props = Codec.getProps(type);

    if (!props) return null;
    if (!t.UnknownRecord.is(actual)) return null;

    const actualKeys = Object.keys(actual);
    const propsKeys = Object.keys(props);
    const matchedKeys = intersection(actualKeys, propsKeys);
    const missingKeys = propsKeys.length - matchedKeys.length;

    return matchedKeys.length
        ? // `1+` so that object with at least one matched property is always preferable
          // than object without any matches, regardless of the missingKeys penalty `missingKeys / (missingKeys + 1)`
          1 + matchedKeys.length - missingKeys / (missingKeys + 1)
        : // in case of empty objects, return value from
          // range (0, 0.5> so that types with more properties are penalised
          // `+1` in `1 / (propsKeys.length + 1)` makes sure that `matchedKeys.length === 1` is less desired than than 0/1 keys
          1 / (propsKeys.length + 1);
}

function scoreArraySimilarity(type: AnyDecoder, actual: unknown): number | null {
    const itemType = Codec.getArrayItemType(type);

    if (!itemType) return null;
    if (!t.UnknownArray.is(actual)) return null;

    return actual.filter(itemType.is).length;
}

function scoreTupleSimilarity(type: AnyDecoder, actual: unknown): number | null {
    const itemTypes = Codec.getTupleTypes(type);

    if (!itemTypes) return null;
    if (!t.UnknownArray.is(actual)) return null;

    return Math.max(0, actual.length - itemTypes.length);
}
