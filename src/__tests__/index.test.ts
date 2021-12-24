import * as t from 'io-ts';

import { report, messages } from '..';

describe('io-ts-friendly-reporter', () => {
    it('should correctly report errors at root level', () => {
        assertMismatch(t.string, 42, '', []);
        assertMismatch(t.keyof({ a: null, b: null, c: null }), 42, '', []);
        assertMismatch(t.literal('asd'), 42, '', []);
        assertMismatch(t.array(t.unknown), 42, '', []);
        assertMismatch(t.UnknownArray, 42, '', []);
        assertMismatch(t.record(t.string, t.unknown), 42, '', []);
        assertMismatch(t.UnknownRecord, 42, '', []);
        assertMismatch(t.type({}), 42, '', []);
        assertMismatch(t.partial({}), 42, '', []);
        assertMismatch(t.intersection([t.number, t.string]), 42, '', []);
    });

    describe('unions', () => {
        const rootUnion = t.union([t.string, t.number, t.type({ b: t.string })]);
        const unionInObj = t.type({ a: rootUnion });

        it('should not narrow down if property is missing', () => {
            assertMissing(rootUnion, undefined, '', []);
            assertMissing(unionInObj, {}, 'a', []);
        });

        it('should not narrow down if property is not assignable at all', () => {
            assertMismatch(rootUnion, null, '', []);
            expect(report(unionInObj.decode({ a: null }))).toEqual(
                messages.mismatch('a', [], null, rootUnion),
            );
        });

        it('should narrow down if property is partially assignable to any variant', () => {
            expect(report(unionInObj.decode({ a: {} }))).toEqual(messages.missing('b', ['a']));
        });

        it('should narrow down union type to variant which has more overlap', () => {
            const union = t.union([t.type({ a: t.number }), t.type({ b: t.number, c: t.number })]);

            expect(report(union.decode({ c: 42 }))).toEqual(messages.missing('b', []));
        });

        it('should narrow down to variant which has more overlap even if it has more errors later', () => {
            const union = t.union([
                t.type({ a: t.number }),
                t.type({ b: t.type({ c: t.number, d: t.number }) }),
            ]);

            expect(report(union.decode({ b: { c: null } }))).toEqual(
                messages.mismatch('c', ['b'], null, t.number),
            );
        });

        it('should correctly handle nested unions', () => {
            const union = t.union([t.union([t.string, t.number]), t.type({ b: t.string })]);

            expect(report(union.decode('asd'))).toEqual(null);
            expect(report(union.decode({}))).toEqual(messages.missing('b', []));
            expect(report(union.decode({ b: 42 }))).toEqual(
                messages.mismatch('b', [], 42, t.string),
            );
        });
    });

    describe('intersections', () => {
        const intersection = t.intersection([
            t.type({ a: t.number }),
            t.type({ b: t.string }),
            t.partial({ c: t.type({ d: t.null }) }),
        ]);

        it('should detect missing properties', () => {
            expect(report(intersection.decode({ a: 42 }))).toEqual(messages.missing('b', []));
            expect(report(intersection.decode({ a: 42, b: 'asd', c: {} }))).toEqual(
                messages.missing('d', ['c']),
            );
        });

        it('should detect mismatched properties', () => {
            expect(report(intersection.decode({ a: 42, b: 42 }))).toEqual(
                messages.mismatch('b', [], 42, t.string),
            );
            expect(report(intersection.decode({ a: 42, b: 'asd', c: null }))).toEqual(
                messages.mismatch('c', [], null, t.type({ d: t.null })),
            );
            expect(report(intersection.decode({ a: 42, b: 'asd', c: { d: 42 } }))).toEqual(
                messages.mismatch('d', ['c'], 42, t.null),
            );
        });
    });

    describe('arrays', () => {
        it('should not narrow down to item if thing is not an array', () => {
            expect(report(t.array(t.string).decode(undefined))).toEqual(messages.missing('', []));
            expect(report(t.array(t.string).decode('asd'))).toEqual(
                messages.mismatch('', [], 'asd', t.array(t.string)),
            );
        });

        it('should narrow down to invalid item', () => {
            expect(report(t.array(t.string).decode(['asd', undefined]))).toEqual(
                messages.missing('1', []),
            );
            expect(report(t.array(t.string).decode(['asd', 42]))).toEqual(
                messages.mismatch('1', [], 42, t.string),
            );
        });
    });

    describe('tuples', () => {
        it('should not narrow down to item if thing is not an array', () => {
            expect(report(t.tuple([t.string, t.number]).decode(undefined))).toEqual(
                messages.missing('', []),
            );
            expect(report(t.tuple([t.string, t.number]).decode('asd'))).toEqual(
                messages.mismatch('', [], 'asd', t.tuple([t.string, t.number])),
            );
        });

        it('should narrow down to invalid item', () => {
            expect(report(t.tuple([t.string, t.number]).decode(['asd']))).toEqual(
                messages.missing('1', []),
            );
            expect(report(t.tuple([t.string, t.number]).decode(['asd', undefined]))).toEqual(
                messages.missing('1', []),
            );
            expect(report(t.tuple([t.string, t.number]).decode(['asd', {}]))).toEqual(
                messages.mismatch('1', [], {}, t.number),
            );
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
            expect(report(codec.decode({}))).toEqual(messages.missing('bar', []));
            expect(report(codec.decode({ bar: { bar: {} } }))).toEqual(
                messages.missing('bar', ['bar', 'bar']),
            );
        });

        it('should report mismatched field on arbitrary level', () => {
            expect(report(codec.decode(null))).toEqual(messages.mismatch('', [], null, codec));
            expect(report(codec.decode({ bar: 42 }))).toEqual(
                messages.mismatch('bar', [], 42, t.union([codec, t.null])),
            );
            expect(report(codec.decode({ bar: { bar: [42] } }))).toEqual(
                messages.mismatch('bar', ['bar'], [42], t.union([codec, t.null])),
            );
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

            expect(report(codec.decode(data))).toEqual(messages.missing('a', []));
        });

        it('should report missing root level property despite error in next intersection item', () => {
            const data = { b: [], c: { c1: 'asd' }, d: [], e: 42 };

            expect(report(codec.decode(data))).toEqual(messages.missing('a', []));
        });

        it('should report invalid property', () => {
            const data = { a: 'asd', b: ['asd'], c: { c1: 'asd' }, d: [] };

            expect(report(codec.decode(data))).toEqual(
                messages.mismatch('0', ['b'], 'asd', t.keyof({ k1: null, k2: null })),
            );
        });

        it('should report invalid property in next intersection section', () => {
            const data = { a: 'asd', b: ['k1'], c: { c1: 'asd' }, d: [], e: null };

            expect(report(codec.decode(data))).toEqual(
                messages.mismatch('e', [], null, t.record(t.string, t.union([t.string, t.number]))),
            );
        });

        it('should report invalid property union variant in next intersection section', () => {
            const data = { a: 'asd', b: ['k1'], c: { c1: 'asd' }, d: [], e: { foo: true } };

            expect(report(codec.decode(data))).toEqual(
                messages.mismatch('foo', ['e'], true, t.union([t.string, t.number])),
            );
        });

        it('should report missing property in nested union', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{}] };

            expect(report(codec.decode(data))).toEqual(messages.missing('d1', ['d', '0']));
        });

        it('should report invlid property in nested union', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d1: 42 }] };

            expect(report(codec.decode(data))).toEqual(
                messages.mismatch('d1', ['d', '0'], 42, t.string),
            );
        });

        it('should report report from variant which has more overlap', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d3: 'asd' }] };

            expect(report(codec.decode(data))).toEqual(messages.missing('d1', ['d', '0']));
        });

        it('should report report from variant which has more overlap', () => {
            const data = { a: 'asd', b: [], c: { c1: 'asd' }, d: [{ d1: 'asd', d3: 'asd' }] };

            expect(report(codec.decode(data))).toEqual(messages.missing('d4', ['d', '0']));
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

            expect(report(codec.decode(data))).toEqual(
                messages.missing('d211', ['d', '0', 'd2', 'd22', '1']),
            );
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

            expect(report(codec.decode(data))).toEqual(
                messages.mismatch('d211', ['d', '0', 'd2', 'd22', '1'], null, t.number),
            );
        });
    });
});

function assertMismatch(type: t.Decoder<any, any>, actual: unknown, key: string, path: string[]) {
    expect(report(type.decode(actual))).toEqual(messages.mismatch(key, path, actual, type));
}

function assertMissing(type: t.Decoder<any, any>, actual: unknown, key: string, path: string[]) {
    expect(report(type.decode(actual))).toEqual(messages.missing(key, path));
}
