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
    DeepPartial,
} from './utils';
import { Codec, AnyDecoder } from './codecs';
import { Messages } from './messages';

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
export type Options = { path: string[]; parentType: AnyDecoder | null; messages: Messages };
export { Messages };

export const defaultMessages = Messages.default();

const Options = {
    default: (): Options => ({ path: [], parentType: null, messages: defaultMessages }),
    withDefault: (opts: DeepPartial<Options>): Options => ({
        ...Options.default(),
        ...opts,
        messages: Messages.withDefault(opts.messages),
    }),
};

/**
 * Returns description of first validation error or null
 */
export function reportOne(
    validation: t.Validation<unknown>,
    opts: DeepPartial<Options> = {},
): string | null {
    return isLeft(validation) ? explain(validation.left, Options.withDefault(opts)) : null;
}

/**
 * Returns descriptions of all validation errors found
 */
export function report(
    validation: t.Validation<unknown>,
    opts: DeepPartial<Options> = {},
): string[] {
    return isLeft(validation) ? explainAll(validation.left, Options.withDefault(opts)) : [];
}

function explain(errors: Array<InputError>, opts: Options): string | null {
    const errorsOnLevelsBelow = errors.map(attachExtraInfoToError).filter(isNotNullable);
    const errorsByPath = groupBy(errorsOnLevelsBelow, ({ key }) => key);

    const errorToReport =
        head(detectTypeMismatches(errorsByPath, opts)) ||
        head(detectMissingProperties(errorsOnLevelsBelow, opts));

    if (errorToReport) return errorToReport;

    const branch = head(filterBranches(opts.parentType, errorsByPath));

    if (!branch) return null;

    const [branchKey, branchSubErrors] = branch;
    const firstError = head(branchSubErrors);

    if (!firstError) return null;

    return explain(branchSubErrors, {
        ...opts,
        path: extendPath(branchKey, opts),
        parentType: firstError.type,
    });
}

function explainAll(errors: Array<InputError>, opts: Options): string[] {
    const errorsOnLevelsBelow = errors.map(attachExtraInfoToError).filter(isNotNullable);
    const errorsByPath = groupBy(errorsOnLevelsBelow, ({ key }) => key);

    const errorsToReport = dedupe([
        ...detectTypeMismatches(errorsByPath, opts),
        ...detectMissingProperties(errorsOnLevelsBelow, opts),
    ]);

    const branches = filterBranches(opts.parentType, errorsByPath);

    const subReports = branches.flatMap(([branchKey, branchSubErrors]) => {
        const firstError = head(branchSubErrors);

        if (!firstError) return [];

        return explainAll(branchSubErrors, {
            ...opts,
            path: extendPath(branchKey, opts),
            parentType: firstError.type,
        });
    });

    return [...errorsToReport, ...subReports];
}

function detectTypeMismatches(
    currentErrorContextsRecord: Record<string, Array<ErrorsExt>>,
    { path, parentType, messages }: Options,
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

function detectMissingProperties(
    currentErrorContexts: Array<ErrorsExt>,
    { path, messages }: Options,
): string[] {
    const missingFields = filterMap(
        currentErrorContexts,
        getMissingPropertyFromErrorContext,
        isNotNullable,
    );
    const uniqMissingFields = dedupe(missingFields);

    return uniqMissingFields.length ? [messages.missing(uniqMissingFields, path)] : [];
}

function getMissingPropertyFromErrorContext({
    key,
    actual,
    wasParentExhausted,
}: ErrorsExt): string | null {
    if (actual !== undefined) return null;

    // we only report as long as the missing key was not already reported
    if (wasParentExhausted) return null;

    return key;
}

/**
 * Extends io-ts t.ValidationError with metadata obtained from `context`
 */
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
        levelsUntilExhaustion: context.findIndex(findLevelsUntilExhaustion),
        wasParentExhausted: !!rest.isExhausted,
    };
}

function extendPath(branchKey: string, { path, parentType }: Options): string[] {
    const isRoot = !path.length && !branchKey;
    const shouldExtendPath =
        !Codec.is.union(parentType) && !Codec.is.intersection(parentType) && !isRoot;

    return shouldExtendPath ? [...path, branchKey] : path;
}

/**
 * find first change of `actual`
 */
function findLevelsUntilExhaustion(
    { actual }: t.ContextEntry,
    idx: number,
    context: t.Context,
): boolean {
    const next = context[idx + 1];
    return !!next && actual !== next.actual;
}

function maxLevelsUntilExhaustion(errors: Array<ErrorsExt>): number {
    return Math.max(...errors.map(({ levelsUntilExhaustion }) => levelsUntilExhaustion));
}

/**
 * Returns array of errors which happend under specific sub branch.
 * In case of union types, tries to guess the most plausible variant
 * and returns its errors for further analysis
 */
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
