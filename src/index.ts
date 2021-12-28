import * as t from 'io-ts';
import { isLeft } from 'fp-ts/Either';
import { pipe } from 'fp-ts/function';
import { NonEmptyArray, groupBy } from 'fp-ts/NonEmptyArray';

import { Codec, AnyDecoder } from './codecs';
import { Messages } from './messages';
import { selectBestUnionVariant } from './union';
import { DeepPartial, head, initTail, isNotNullable, dedupe } from './utils';

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
    const errorsByPath = pipe(
        errorsOnLevelsBelow,
        groupBy(({ key }) => key),
    );

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
    const errorsByPath = pipe(
        errorsOnLevelsBelow,
        groupBy(({ key }) => key),
    );

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

        return currentErrorContexts
            .map(({ key, type, actual, message, isExhausted }) => {
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
            })
            .filter(isNotNullable);
    });
}

function detectMissingProperties(
    currentErrorContexts: Array<ErrorsExt>,
    { path, messages }: Options,
): string[] {
    const missingFields = currentErrorContexts
        .map(({ key, actual, wasParentExhausted }) => {
            if (actual !== undefined) return null;

            // we only report as long as the missing key was not already reported
            if (wasParentExhausted) return null;

            return key;
        })
        .filter(isNotNullable);

    const uniqMissingFields = dedupe(missingFields);

    return uniqMissingFields.length ? [messages.missing(uniqMissingFields, path)] : [];
}

/**
 * Extends io-ts t.ValidationError with metadata obtained from `context`
 */
function attachExtraInfoToError({ context, ...rest }: InputError): ErrorsExt | null {
    const [head, ...tail] = context;

    return head
        ? {
              ...rest,
              context: tail,
              key: head.key,
              type: head.type,
              actual: head.actual,
              isExhausted: tail.every(({ actual }) => actual === head.actual),
              levelsUntilExhaustion: context.findIndex(findLevelsUntilExhaustion),
              wasParentExhausted: !!rest.isExhausted,
          }
        : null;
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

/**
 * Returns array of errors which happend under specific sub branch.
 * In case of union types, tries to guess the most plausible variant
 * and returns its errors for further analysis
 */
function filterBranches(
    parentType: AnyDecoder | null,
    branchRecord: Record<string, NonEmptyArray<ErrorsExt>>,
): Array<[string, Array<ErrorsExt>]> {
    const branches = Object.entries(branchRecord);

    return Codec.is.union(parentType) ? selectBestUnionVariant(branches) : branches;
}
