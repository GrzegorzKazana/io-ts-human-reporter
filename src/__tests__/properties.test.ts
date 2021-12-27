import * as fc from 'fast-check';
import * as t from 'io-ts';
import { isRight } from 'fp-ts/Either';

import { report, reportOne } from '../index';
import { isNotEmpty } from '../utils';

/**
 * Narrows down generated strings used as literals or object keys
 */
const stringSubsetArbitrary = fc.constantFrom('a', 'b', 'c');
const integerSubsetArbitrary = fc.constantFrom(1, 2, 3);

/**
 * Generates random codecs 🔥😩👌
 * https://github.com/dubzzz/fast-check/blob/main/documentation/Arbitraries.md#more-specific-strings
 */
const jsonCodecArbitrary = fc.letrec(tie => {
    const typedTie = tie as (key: string) => fc.Arbitrary<t.Mixed>;
    const anyTie = fc.oneof(
        { depthFactor: 0.5, maxDepth: 3, withCrossShrink: true },
        typedTie('primitive'),
        typedTie('array'),
        typedTie('object'),
        typedTie('algebraic'),
    );

    return {
        primitive: fc.frequency(
            { arbitrary: fc.constant(t.string), weight: 3 },
            { arbitrary: fc.constant(t.number), weight: 3 },
            { arbitrary: fc.constant(t.null), weight: 2 },
            {
                arbitrary: fc
                    .dictionary(stringSubsetArbitrary, fc.constant(null))
                    .filter(isNotEmpty)
                    .map(t.keyof),
                weight: 1,
            },
            { arbitrary: stringSubsetArbitrary.map(t.literal), weight: 1 },
            { arbitrary: integerSubsetArbitrary.map(t.literal), weight: 1 },
            { arbitrary: fc.float().map(t.literal), weight: 1 },
            { arbitrary: fc.boolean().map(t.literal), weight: 1 },
        ),
        array: fc.oneof(
            anyTie.map(t.array),
            anyTie.map(t.readonlyArray),
            fc
                .array(anyTie, { minLength: 2, maxLength: 4 })
                .map(items => t.tuple(items as unknown as [t.Mixed, t.Mixed])),
        ),
        object: fc.oneof(
            fc.dictionary(stringSubsetArbitrary, anyTie).map(t.type),
            fc.dictionary(stringSubsetArbitrary, anyTie).map(t.partial),
            fc.dictionary(stringSubsetArbitrary, anyTie).map(t.strict),
            fc.dictionary(stringSubsetArbitrary, anyTie).map(t.type).map(t.exact),
            fc.tuple(fc.constant(t.string), anyTie).map(([key, value]) => t.record(key, value)),
        ),
        algebraic: fc.oneof(
            fc
                .array(anyTie, { minLength: 2, maxLength: 3 })
                .map(items => t.union(items as unknown as [t.Mixed, t.Mixed])),
            fc
                .array(anyTie, { minLength: 2, maxLength: 3 })
                .map(items => t.intersection(items as unknown as [t.Mixed, t.Mixed])),
        ),
    };
});

describe('error formatting properties', () => {
    it('should always return an error message if validation fails', () => {
        fc.assert(
            fc.property(
                fc
                    .oneof(
                        jsonCodecArbitrary.primitive,
                        jsonCodecArbitrary.object,
                        jsonCodecArbitrary.array,
                        jsonCodecArbitrary.algebraic,
                    )
                    .map(value => Object.assign(value, { [fc.toStringMethod]: () => value.name })),
                fc.anything({ key: stringSubsetArbitrary, maxDepth: 3 }),
                (codec, value) => {
                    const result = codec.decode(value);
                    if (isRight(result)) return true;

                    const message = reportOne(result);
                    const messages = report(result);

                    return !!message && !!messages.length;
                },
            ),
            { numRuns: 10000 },
        );
    });
});
