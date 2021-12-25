import * as t from 'io-ts';
import { isLeft } from 'fp-ts/Either';

import {
    head,
    isNotNullable,
    groupBy,
    maxByAll,
    intersection,
    filterMap,
    isNotFalsy,
} from './utils';
import { Codec, AnyDecoder } from './codecs';

export type ErrorsExt = Array<t.ValidationError & { type: AnyDecoder; actual: unknown }>;
export type ContextExt = Array<t.ContextEntry & { isExhausted: boolean }>;
export type Options = Partial<{ path: string[]; parentType: AnyDecoder | null }>;

export const messages = {
    path: (path: string[]) => path.join('.'),

    missing: (key: string, path: string[]) =>
        `missing property '${key}' at '${messages.path(path)}'`,

    mismatch: (key: string, path: string[], actual: unknown, expected: AnyDecoder) =>
        `got '${actual}' expected '${expected.name}' at '${messages.path([...path, key])}'`,
};

export function report(validation: t.Validation<unknown>): string | null {
    return isLeft(validation) ? explain(validation.left) : null;
}

function explain(errors: t.Errors, { path = [], parentType = null }: Options = {}): string | null {
    const currentErrorContexts = errors
        .map(({ context: [head, ...rest] }) => ({
            ...head,
            isExhausted: rest.every(({ actual }) => actual === head.actual),
        }))
        .filter(isNotNullable);

    const errorToReport =
        head(detectTypeMismatches(parentType, path, currentErrorContexts)) ||
        head(detectMissingProperties(path, currentErrorContexts));

    if (errorToReport) return errorToReport;

    const errorsOnLevelsBelow = errors
        .filter(({ context }) => context.length)
        .map(({ context: [head, ...tail], ...rest }) => ({
            ...rest,
            context: tail,
            key: head.key,
            type: head.type,
            actual: head.actual,
        }));

    const errorsByPath = groupBy(errorsOnLevelsBelow, ({ key }) => key);
    const branch = head(filterBranches(parentType, errorsByPath));

    if (!branch) return null;

    const [branchKey, branchSubErrors] = branch;
    const firstError = head(branchSubErrors);

    if (!firstError) return null;

    const isRoot = !path.length && !branchKey;
    const shouldExtendPath =
        !Codec.is.union(parentType) && !Codec.is.intersection(parentType) && !isRoot;

    return explain(branchSubErrors, {
        path: shouldExtendPath ? [...path, branchKey] : path,
        parentType: firstError.type,
    });
}

function detectTypeMismatches(
    parentType: AnyDecoder | null,
    path: string[],
    currentErrorContexts: ContextExt,
): string[] {
    const allExhausted = currentErrorContexts.every(({ isExhausted }) => isExhausted);

    // if parent type is union, we do not want to report the error yet
    // (will happen in deeper recursion level)
    if (Codec.is.union(parentType)) return [];

    return filterMap(
        currentErrorContexts,
        ({ key, type, actual, isExhausted }) => {
            // property missing/undefined
            if (actual === undefined) return null;

            // no way to narrow down the type
            if (allExhausted) return messages.mismatch(key, path, actual, type);

            // not all errors are exhausted, try to narrow down the union error
            if (Codec.is.union(type)) return null;

            // cannot be narrowed down - report error now
            return isExhausted && messages.mismatch(key, path, actual, type);
        },
        isNotFalsy,
    );
}

function detectMissingProperties(path: string[], currentErrorContexts: ContextExt): string[] {
    return filterMap(
        currentErrorContexts,
        ({ key, actual }) => actual === undefined && messages.missing(key, path),
        isNotFalsy,
    );
}

function filterBranches(
    parentType: AnyDecoder | null,
    branchRecord: Record<string, ErrorsExt>,
): Array<[string, ErrorsExt]> {
    const branches = Object.entries(branchRecord);

    return Codec.is.union(parentType) ? selectBestUnionVariant(branches) : branches;
}

function selectBestUnionVariant(branches: Array<[string, ErrorsExt]>): Array<[string, ErrorsExt]> {
    return maxByAll(branches, ([_, [{ type, actual }]]) => {
        const props = Codec.getProps(type);

        if (!props) return -1;
        if (!t.UnknownRecord.is(actual)) return -1;

        return intersection(Object.keys(actual), Object.keys(props)).length;
    });
}
