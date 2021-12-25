import * as t from 'io-ts';

import { hasKey } from './utils';

export type AnyDecoder = t.Decoder<any, any>;

export const Codec = {
    is: {
        union: (c: unknown): c is t.UnionType<t.UnknownC[]> => c instanceof t.UnionType,

        intersection: (c: unknown): c is t.IntersectionType<t.UnknownC[]> =>
            c instanceof t.IntersectionType,

        tagged: (codec: AnyDecoder): codec is TaggedCodec =>
            hasKey(codec, '_tag') && t.string.is(codec._tag),
    },
    /**
     * Adapted from https://github.com/gcanti/io-ts/blob/87f6b860001eb4b487429b0547cfa9a4efca33b4/src/index.ts#L515
     */
    getProps: (codec: AnyDecoder): Record<string, AnyDecoder> | null => {
        if (!Codec.is.tagged(codec)) return null;

        switch (codec._tag) {
            case 'RefinementType':
            case 'ReadonlyType':
                return Codec.getProps(codec.type);

            case 'InterfaceType':
            case 'StrictType':
            case 'PartialType':
                return codec.props;

            case 'IntersectionType':
                return codec.types.reduce(
                    (props: Record<string, AnyDecoder>, type: AnyDecoder) =>
                        Object.assign(props, Codec.getProps(type)),
                    {},
                );
            case 'RecursiveType':
                return Codec.getProps(codec.runDefinition());

            default:
                return null;
        }
    },
};

type TaggedCodec =
    | t.NullC
    | t.UndefinedC
    | t.VoidC
    | t.UnknownC
    | t.StringC
    | t.NumberC
    | t.BigIntC
    | t.BooleanC
    | t.UnknownArrayC
    | t.UnknownRecordC
    | t.FunctionC
    | t.RefinementC<any>
    | t.LiteralC<any>
    | t.RecursiveType<any>
    | t.ArrayC<any>
    | t.TypeC<any>
    | t.PartialC<any>
    | t.RecordC<any, any>
    | t.UnionC<any>
    | t.IntersectionC<any>
    | t.TupleC<any>
    | t.ReadonlyC<any>
    | t.ReadonlyArrayC<any>
    | t.TaggedUnionC<any, any>
    | t.AnyC
    | t.ObjectC
    | t.StrictC<any>
    | t.KeyofC<any>
    | t.ExactC<any>;
