import * as t from 'io-ts';

import { reportOne, report, defaultMessages as msg } from '..';

describe('io-ts-friendly-reporter', () => {
    it('should correctly report errors at root level', () => {
        assertRootMismatch(t.string, 42, '', []);
        assertRootMismatch(t.keyof({ a: null, b: null, c: null }), 42, '', []);
        assertRootMismatch(t.literal('asd'), 42, '', []);
        assertRootMismatch(t.array(t.unknown), 42, '', []);
        assertRootMismatch(t.UnknownArray, 42, '', []);
        assertRootMismatch(t.record(t.string, t.unknown), 42, '', []);
        assertRootMismatch(t.UnknownRecord, 42, '', []);
        assertRootMismatch(t.type({}), 42, '', []);
        assertRootMismatch(t.partial({}), 42, '', []);
    });

    it('should respect custom messages', () => {
        const message = 'this is my custom message';
        const custom = new t.Type<number>(
            'custom',
            t.number.is,
            (a, ctx) => t.failure(a, ctx, message),
            t.number.encode,
        );

        expect(reportOne(custom.decode({}))).toEqual(msg.custom(message, []));
        expect(reportOne(t.type({ a: t.type({ b: custom }) }).decode({ a: {} }))).toEqual(
            msg.missing(['b'], ['a']),
        );
    });

    describe('grouping of missing properties', () => {
        it('should group missing fields at the same level', () => {
            expect(
                reportOne(t.type({ a: t.number, b: t.number, c: t.number }).decode({ b: 42 })),
            ).toEqual(msg.missing(['a', 'c'], []));
            expect(
                report(t.type({ a: t.number, b: t.number, c: t.number }).decode({ b: 42 })),
            ).toEqual([msg.missing(['a', 'c'], [])]);
        });

        it('should not group missing fields across array or tuple items', () => {
            const codec = t.array(t.type({ a: t.number, b: t.number }));

            expect(reportOne(codec.decode([{ a: 42 }, { b: 42 }]))).toEqual(
                msg.missing(['b'], ['0']),
            );
            expect(report(codec.decode([{ a: 42 }, { b: 42 }]))).toEqual([
                msg.missing(['b'], ['0']),
                msg.missing(['a'], ['1']),
            ]);
        });

        it('should not group missing fields across array or tuple items', () => {
            const codec = t.tuple([
                t.type({ a: t.number, b: t.number }),
                t.type({ b: t.number, c: t.number }),
            ]);

            expect(reportOne(codec.decode([{ b: 42 }, { b: 42 }]))).toEqual(
                msg.missing(['a'], ['0']),
            );
            expect(report(codec.decode([{ b: 42 }, { b: 42 }]))).toEqual([
                msg.missing(['a'], ['0']),
                msg.missing(['c'], ['1']),
            ]);
        });

        it('should not group missing properties on union variants', () => {
            const codec = t.union([
                t.type({ a: t.number, b: t.number, c: t.number }),
                t.type({ c: t.number, d: t.number }),
            ]);

            expect(reportOne(codec.decode({ a: 42 }))).toEqual(msg.missing(['b', 'c'], []));
            expect(report(codec.decode({ a: 42 }))).toEqual([msg.missing(['b', 'c'], [])]);
        });

        it('should not group missing properties on intersection components', () => {
            const codec = t.intersection([
                t.type({ a: t.number, b: t.number, c: t.number }),
                t.type({ d: t.number }),
            ]);

            expect(reportOne(codec.decode({ a: 42 }))).toEqual(msg.missing(['b', 'c'], []));
            expect(report(codec.decode({ a: 42 }))).toEqual([
                msg.missing(['b', 'c'], []),
                msg.missing(['d'], []),
            ]);
        });
    });

    describe('unions', () => {
        const primitiveUnion = t.union([t.string, t.number]);
        const rootUnion = t.union([t.string, t.number, t.type({ b: t.string })]);
        const unionInObj = t.type({ a: rootUnion });

        it('should not narrow down if property is missing', () => {
            expect(reportOne(primitiveUnion.decode(undefined))).toEqual(msg.missing([''], []));
            expect(report(primitiveUnion.decode(undefined))).toEqual([msg.missing([''], [])]);

            expect(reportOne(rootUnion.decode(undefined))).toEqual(msg.missing([''], []));
            expect(report(rootUnion.decode(undefined))).toEqual([msg.missing([''], [])]);

            expect(reportOne(unionInObj.decode({}))).toEqual(msg.missing(['a'], []));
            expect(report(unionInObj.decode({}))).toEqual([msg.missing(['a'], [])]);
        });

        it('should not narrow down if property is not assignable at all', () => {
            assertRootMismatch(primitiveUnion, null, '', []);
            assertRootMismatch(rootUnion, null, '', []);

            expect(reportOne(unionInObj.decode({ a: null }))).toEqual(
                msg.mismatch('a', [], null, rootUnion),
            );
            expect(report(unionInObj.decode({ a: null }))).toEqual([
                msg.mismatch('a', [], null, rootUnion),
            ]);
        });

        it('should narrow down if property is partially assignable to any variant', () => {
            expect(reportOne(unionInObj.decode({ a: {} }))).toEqual(msg.missing(['b'], ['a']));
            expect(report(unionInObj.decode({ a: {} }))).toEqual([msg.missing(['b'], ['a'])]);
        });

        it('should narrow down union type to variant which has more overlap', () => {
            const union = t.union([t.type({ a: t.number }), t.type({ b: t.number, c: t.number })]);

            expect(reportOne(union.decode({ c: 42 }))).toEqual(msg.missing(['b'], []));
            expect(report(union.decode({ c: 42 }))).toEqual([msg.missing(['b'], [])]);
        });

        it('should narrow down to variant which has more overlap even if it has more errors later', () => {
            const union = t.union([
                t.type({ a: t.number }),
                t.type({ b: t.type({ c: t.number, d: t.number }) }),
            ]);

            expect(reportOne(union.decode({ b: { c: null } }))).toEqual(
                msg.mismatch('c', ['b'], null, t.number),
            );
            expect(report(union.decode({ b: { c: null } }))).toEqual([
                msg.mismatch('c', ['b'], null, t.number),
                msg.missing(['d'], ['b']),
            ]);
        });

        it('should correctly handle nested unions', () => {
            const union = t.union([t.union([t.string, t.number]), t.type({ b: t.string })]);

            expect(reportOne(union.decode('asd'))).toEqual(null);
            expect(report(union.decode('asd'))).toEqual([]);

            expect(reportOne(union.decode({}))).toEqual(msg.missing(['b'], []));
            expect(report(union.decode({}))).toEqual([msg.missing(['b'], [])]);

            expect(reportOne(union.decode({ b: 42 }))).toEqual(msg.mismatch('b', [], 42, t.string));
            expect(report(union.decode({ b: 42 }))).toEqual([msg.mismatch('b', [], 42, t.string)]);
        });

        it('should correctly handle nested unions II', () => {
            const union = t.union([
                t.number,
                t.union([t.string, t.number, t.type({ a: t.literal(1) })]),
            ]);

            expect(reportOne(union.decode({}))).toEqual(msg.missing(['a'], []));
            expect(report(union.decode({}))).toEqual([msg.missing(['a'], [])]);
        });

        it('should correctly handle nested unions III', () => {
            const union = t.union([t.number, t.readonlyArray(t.literal(false))]);

            expect(reportOne(union.decode([true]))).toEqual(
                msg.mismatch('0', [], true, t.literal(false)),
            );
            expect(report(union.decode([true]))).toEqual([
                msg.mismatch('0', [], true, t.literal(false)),
            ]);
        });

        it('should correctly handle nested unions IV', () => {
            const union = t.array(t.union([t.tuple([t.string, t.literal('a')]), t.literal('a')]));

            expect(reportOne(union.decode([{}, []]))).toEqual(
                msg.mismatch(
                    '0',
                    [],
                    {},
                    t.union([t.tuple([t.string, t.literal('a')]), t.literal('a')]),
                ),
            );
            expect(report(union.decode([{}, []]))).toEqual([
                msg.mismatch(
                    '0',
                    [],
                    {},
                    t.union([t.tuple([t.string, t.literal('a')]), t.literal('a')]),
                ),
                msg.missing(['0', '1'], ['1']),
            ]);
        });

        it('should correctly handle nested unions V', () => {
            const union = t.union([
                t.intersection([t.array(t.string), t.number]),
                t.type({ a: t.null }),
            ]);

            expect(reportOne(union.decode({}))).toEqual(msg.missing(['a'], []));
            expect(report(union.decode({}))).toEqual([msg.missing(['a'], [])]);
        });
    });

    describe('intersections', () => {
        const intersection = t.intersection([
            t.type({ a: t.number }),
            t.type({ b: t.string }),
            t.partial({ c: t.type({ d: t.null }) }),
        ]);

        it('should detect missing properties', () => {
            expect(reportOne(intersection.decode({}))).toEqual(msg.missing(['a'], []));
            expect(report(intersection.decode({}))).toEqual([
                msg.missing(['a'], []),
                msg.missing(['b'], []),
            ]);

            expect(reportOne(intersection.decode({ a: 42 }))).toEqual(msg.missing(['b'], []));
            expect(report(intersection.decode({ a: 42 }))).toEqual([msg.missing(['b'], [])]);

            expect(reportOne(intersection.decode({ a: 42, b: 42, c: {} }))).toEqual(
                msg.mismatch('b', [], 42, t.string),
            );
            expect(report(intersection.decode({ a: 42, b: 42, c: {} }))).toEqual([
                msg.mismatch('b', [], 42, t.string),
                msg.missing(['d'], ['c']),
            ]);

            expect(reportOne(intersection.decode({ a: 42, b: 'asd', c: {} }))).toEqual(
                msg.missing(['d'], ['c']),
            );
            expect(report(intersection.decode({ a: 42, b: 'asd', c: {} }))).toEqual([
                msg.missing(['d'], ['c']),
            ]);
        });

        it('should detect mismatched properties', () => {
            expect(reportOne(t.intersection([t.number, t.string]).decode(null))).toEqual(
                msg.mismatch('', [], null, t.number),
            );
            expect(report(t.intersection([t.number, t.string]).decode(null))).toEqual([
                msg.mismatch('', [], null, t.number),
                msg.mismatch('', [], null, t.string),
            ]);

            expect(reportOne(t.intersection([t.number, t.string]).decode(42))).toEqual(
                msg.mismatch('', [], 42, t.string),
            );
            expect(report(t.intersection([t.number, t.string]).decode(42))).toEqual([
                msg.mismatch('', [], 42, t.string),
            ]);

            expect(reportOne(intersection.decode({ a: null, b: 42 }))).toEqual(
                msg.mismatch('a', [], null, t.number),
            );
            expect(report(intersection.decode({ a: null, b: 42 }))).toEqual([
                msg.mismatch('a', [], null, t.number),
                msg.mismatch('b', [], 42, t.string),
            ]);

            expect(reportOne(intersection.decode({ a: 42, b: 42 }))).toEqual(
                msg.mismatch('b', [], 42, t.string),
            );
            expect(report(intersection.decode({ a: 42, b: 42 }))).toEqual([
                msg.mismatch('b', [], 42, t.string),
            ]);

            expect(reportOne(intersection.decode({ a: 42, b: 'asd', c: null }))).toEqual(
                msg.mismatch('c', [], null, t.type({ d: t.null })),
            );
            expect(report(intersection.decode({ a: 42, b: 'asd', c: null }))).toEqual([
                msg.mismatch('c', [], null, t.type({ d: t.null })),
            ]);

            expect(reportOne(intersection.decode({ a: 42, b: 'asd', c: { d: 42 } }))).toEqual(
                msg.mismatch('d', ['c'], 42, t.null),
            );
            expect(report(intersection.decode({ a: 42, b: 'asd', c: { d: 42 } }))).toEqual([
                msg.mismatch('d', ['c'], 42, t.null),
            ]);
        });
    });

    describe('arrays', () => {
        it('should not narrow down to item if thing is not an array', () => {
            expect(reportOne(t.array(t.string).decode(undefined))).toEqual(msg.missing([''], []));
            expect(report(t.array(t.string).decode(undefined))).toEqual([msg.missing([''], [])]);

            expect(reportOne(t.array(t.string).decode('asd'))).toEqual(
                msg.mismatch('', [], 'asd', t.array(t.string)),
            );
            expect(report(t.array(t.string).decode('asd'))).toEqual([
                msg.mismatch('', [], 'asd', t.array(t.string)),
            ]);
        });

        it('should narrow down to invalid item', () => {
            expect(reportOne(t.array(t.string).decode(['asd', undefined]))).toEqual(
                msg.missing(['1'], []),
            );
            expect(report(t.array(t.string).decode(['asd', undefined]))).toEqual([
                msg.missing(['1'], []),
            ]);

            expect(reportOne(t.array(t.string).decode(['asd', 42]))).toEqual(
                msg.mismatch('1', [], 42, t.string),
            );
            expect(report(t.array(t.string).decode(['asd', 42]))).toEqual([
                msg.mismatch('1', [], 42, t.string),
            ]);

            expect(reportOne(t.array(t.string).decode([null, 42]))).toEqual(
                msg.mismatch('0', [], null, t.string),
            );
            expect(report(t.array(t.string).decode([null, 42]))).toEqual([
                msg.mismatch('0', [], null, t.string),
                msg.mismatch('1', [], 42, t.string),
            ]);
        });
    });

    describe('tuples', () => {
        it('should not narrow down to item if thing is not an array', () => {
            expect(reportOne(t.tuple([t.string, t.number]).decode(undefined))).toEqual(
                msg.missing([''], []),
            );
            expect(report(t.tuple([t.string, t.number]).decode(undefined))).toEqual([
                msg.missing([''], []),
            ]);

            expect(reportOne(t.tuple([t.string, t.number]).decode('asd'))).toEqual(
                msg.mismatch('', [], 'asd', t.tuple([t.string, t.number])),
            );
            expect(report(t.tuple([t.string, t.number]).decode('asd'))).toEqual([
                msg.mismatch('', [], 'asd', t.tuple([t.string, t.number])),
            ]);
        });

        it('should narrow down to invalid item', () => {
            expect(reportOne(t.tuple([t.string, t.number]).decode(['asd']))).toEqual(
                msg.missing(['1'], []),
            );
            expect(report(t.tuple([t.string, t.number]).decode(['asd']))).toEqual([
                msg.missing(['1'], []),
            ]);

            expect(reportOne(t.tuple([t.string, t.number]).decode([42]))).toEqual(
                msg.mismatch('0', [], 42, t.string),
            );
            expect(report(t.tuple([t.string, t.number]).decode([42]))).toEqual([
                msg.mismatch('0', [], 42, t.string),
                msg.missing(['1'], []),
            ]);

            expect(reportOne(t.tuple([t.string, t.number]).decode(['asd', undefined]))).toEqual(
                msg.missing(['1'], []),
            );
            expect(report(t.tuple([t.string, t.number]).decode(['asd', undefined]))).toEqual([
                msg.missing(['1'], []),
            ]);

            expect(reportOne(t.tuple([t.string, t.number]).decode(['asd', {}]))).toEqual(
                msg.mismatch('1', [], {}, t.number),
            );
            expect(report(t.tuple([t.string, t.number]).decode(['asd', {}]))).toEqual([
                msg.mismatch('1', [], {}, t.number),
            ]);
        });
    });

    describe('recursion', () => {
        type Foo = {
            bar: Foo | null;
        };

        const codec: t.RecursiveType<t.Type<Foo>> = t.recursion('Foo', () =>
            t.type({ bar: t.union([codec, t.null]) }),
        );

        it('should report missing field on arbitrary level', () => {
            expect(reportOne(codec.decode({}))).toEqual(msg.missing(['bar'], []));
            expect(report(codec.decode({}))).toEqual([msg.missing(['bar'], [])]);

            expect(reportOne(codec.decode({ bar: { bar: {} } }))).toEqual(
                msg.missing(['bar'], ['bar', 'bar']),
            );
            expect(report(codec.decode({ bar: { bar: {} } }))).toEqual([
                msg.missing(['bar'], ['bar', 'bar']),
            ]);
        });

        it('should report mismatched field on arbitrary level', () => {
            expect(reportOne(codec.decode(null))).toEqual(msg.mismatch('', [], null, codec));
            expect(report(codec.decode(null))).toEqual([msg.mismatch('', [], null, codec)]);

            expect(reportOne(codec.decode({ bar: 42 }))).toEqual(
                msg.mismatch('bar', [], 42, t.union([codec, t.null])),
            );
            expect(report(codec.decode({ bar: 42 }))).toEqual([
                msg.mismatch('bar', [], 42, t.union([codec, t.null])),
            ]);

            expect(reportOne(codec.decode({ bar: { bar: [42] } }))).toEqual(
                msg.mismatch('bar', ['bar'], [42], t.union([codec, t.null])),
            );
            expect(report(codec.decode({ bar: { bar: [42] } }))).toEqual([
                msg.mismatch('bar', ['bar'], [42], t.union([codec, t.null])),
            ]);
        });
    });

    describe('miscellaneous', () => {
        const codec = t.intersection([
            t.type({
                a: t.string,
                b: t.array(t.keyof({ k1: null, k2: null })),
                c: t.type({ c1: t.string }),
                d: t.array(
                    t.union([
                        t.type({
                            d1: t.string,
                            d2: t.type({
                                d21: t.union([t.string, t.type({ d211: t.number })]),
                                d22: t.array(t.union([t.string, t.type({ d211: t.number })])),
                            }),
                        }),
                        t.intersection([
                            t.type({ d1: t.string, d3: t.string, d4: t.null }),
                            t.partial({
                                d2: t.type({
                                    d21: t.union([t.string, t.type({ d211: t.number })]),
                                    d22: t.array(t.union([t.string, t.type({ d211: t.number })])),
                                }),
                            }),
                        ]),
                    ]),
                ),
            }),
            t.partial({
                e: t.record(t.string, t.union([t.string, t.number])),
            }),
        ]);

        it('should report missing root level property', () => {
            const data = { b: [], c: { c1: 'asd' }, d: [] };

            expect(reportOne(codec.decode(data))).toEqual(msg.missing(['a'], []));
            expect(report(codec.decode(data))).toEqual([msg.missing(['a'], [])]);
        });

        it('should report missing root level property despite error in next intersection item', () => {
            const data = { b: [], c: { c1: 'asd' }, d: [], e: 42 };

            expect(reportOne(codec.decode(data))).toEqual(msg.missing(['a'], []));
            expect(report(codec.decode(data))).toEqual([
                msg.missing(['a'], []),
                msg.mismatch('e', [], 42, t.record(t.string, t.union([t.string, t.number]))),
            ]);
        });

        it('should report invalid property', () => {
            const data = { a: 'asd', b: ['asd'], c: { c1: 'asd' }, d: [] };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.mismatch('0', ['b'], 'asd', t.keyof({ k1: null, k2: null })),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.mismatch('0', ['b'], 'asd', t.keyof({ k1: null, k2: null })),
            ]);
        });

        it('should report invalid property in next intersection section', () => {
            const data = { a: 'asd', b: ['k1'], c: { c1: 'asd' }, d: [], e: null };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.mismatch('e', [], null, t.record(t.string, t.union([t.string, t.number]))),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.mismatch('e', [], null, t.record(t.string, t.union([t.string, t.number]))),
            ]);
        });

        it('should report invalid property union variant in next intersection section', () => {
            const data = { a: 'asd', b: ['k1'], c: { c1: 'asd' }, d: [], e: { foo: true } };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.mismatch('foo', ['e'], true, t.union([t.string, t.number])),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.mismatch('foo', ['e'], true, t.union([t.string, t.number])),
            ]);
        });

        it('should report missing property in nested union', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{}] };

            expect(reportOne(codec.decode(data))).toEqual(msg.missing(['d1', 'd2'], ['d', '0']));
            expect(report(codec.decode(data))).toEqual([msg.missing(['d1', 'd2'], ['d', '0'])]);
        });

        it('should report invlid property in nested union', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d1: 42 }] };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.mismatch('d1', ['d', '0'], 42, t.string),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.mismatch('d1', ['d', '0'], 42, t.string),
                msg.missing(['d2'], ['d', '0']),
            ]);
        });

        it('should report report from variant which has more overlap', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d3: 'asd' }] };

            expect(reportOne(codec.decode(data))).toEqual(msg.missing(['d1', 'd4'], ['d', '0']));
            expect(report(codec.decode(data))).toEqual([msg.missing(['d1', 'd4'], ['d', '0'])]);
        });

        it('should report report from variant which has more overlap II', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d1: 'asd', d3: 'asd' }] };

            expect(reportOne(codec.decode(data))).toEqual(msg.missing(['d4'], ['d', '0']));
            expect(report(codec.decode(data))).toEqual([msg.missing(['d4'], ['d', '0'])]);
        });

        it('should report deep variant missing props', () => {
            const data = {
                a: 'asd',
                b: [],
                c: { c1: 'asd' },
                d: [
                    {
                        d1: 'asd',
                        d2: {
                            d21: 'asd',
                            d22: ['asd', {}],
                        },
                    },
                ],
            };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.missing(['d211'], ['d', '0', 'd2', 'd22', '1']),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.missing(['d211'], ['d', '0', 'd2', 'd22', '1']),
            ]);
        });

        it('should report deep variant mismatched props', () => {
            const data = {
                a: 'asd',
                b: [],
                c: { c1: 'asd' },
                d: [
                    {
                        d1: 'asd',
                        d2: {
                            d21: 'asd',
                            d22: ['asd', { d211: null }],
                        },
                    },
                ],
            };

            expect(reportOne(codec.decode(data))).toEqual(
                msg.mismatch('d211', ['d', '0', 'd2', 'd22', '1'], null, t.number),
            );
            expect(report(codec.decode(data))).toEqual([
                msg.mismatch('d211', ['d', '0', 'd2', 'd22', '1'], null, t.number),
            ]);
        });
    });
});

function assertRootMismatch(
    type: t.Decoder<any, any>,
    actual: unknown,
    key: string,
    path: string[],
) {
    expect(reportOne(type.decode(actual))).toEqual(msg.mismatch(key, path, actual, type));
    expect(report(type.decode(actual))).toEqual([msg.mismatch(key, path, actual, type)]);
}
