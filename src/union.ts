import * as t from 'io-ts';
import { pipe } from 'fp-ts/function';
import { map as mapOption } from 'fp-ts/Option';
import { fromOption, intersection } from 'fp-ts/Array';
import { Eq as StrEq } from 'fp-ts/string';
import { Ord, contramap, fromCompare } from 'fp-ts/Ord';
import { Ord as NumOrd } from 'fp-ts/number';
import { NonEmptyArray, fromArray as NEFromArray, max, map } from 'fp-ts/NonEmptyArray';

import { Codec, AnyDecoder } from './codecs';
import type { ErrorsExt } from './index';

/**
 * Given the possible branches that errors can be divided into,
 * tries to select one that has in most in common with expected type
 */
export function selectBestUnionVariant(
    branches: Array<[string, NonEmptyArray<ErrorsExt>]>,
): Array<[string, Array<ErrorsExt>]> {
    return pipe(branches, NEFromArray, mapOption(max(BranchesOrd)), fromOption);
}

const ErrorsExtOrd = fromCompare<NonEmptyArray<ErrorsExt>>((first, second) => {
    const similarityA = getSimilarityScoreOfErrors(first);
    const similarityB = getSimilarityScoreOfErrors(second);

    return (
        NumOrd.compare(similarityA, similarityB) ||
        // in case scoring by similarity fails,
        // pick the variant which can be narrowed down the most
        NumOrd.compare(getNarrowingScoreOfErrors(first), getNarrowingScoreOfErrors(second))
    );
});

const BranchesOrd: Ord<[string, NonEmptyArray<ErrorsExt>]> = pipe(
    ErrorsExtOrd,
    contramap(([_, errors]) => errors),
);

function getSimilarityScoreOfErrors(errors: NonEmptyArray<ErrorsExt>): number {
    return pipe(
        errors,
        map(
            ({ type, actual }) =>
                scoreObjectSimilarity(type, actual) ??
                scoreArraySimilarity(type, actual) ??
                scoreTupleSimilarity(type, actual) ??
                -1,
        ),
        max(NumOrd),
    );
}

function getNarrowingScoreOfErrors(errors: NonEmptyArray<ErrorsExt>): number {
    return pipe(
        errors,
        map(({ levelsUntilExhaustion }) => levelsUntilExhaustion),
        max(NumOrd),
    );
}

function scoreObjectSimilarity(type: AnyDecoder, actual: unknown): number | null {
    const props = Codec.getProps(type);

    if (!props) return null;
    if (!t.UnknownRecord.is(actual)) return null;

    const actualKeys = Object.keys(actual);
    const propsKeys = Object.keys(props);
    const matchedKeys = intersection(StrEq)(actualKeys)(propsKeys);
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
