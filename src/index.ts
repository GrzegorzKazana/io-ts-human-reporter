import { isLeft } from 'fp-ts/Either';
import * as t from 'io-ts';

type ErrorsExt = Array<t.ValidationError & { type: t.Decoder<any, any>; actual: unknown }>;

export const messages = {
    path: (path: string[]) => path.join('.'),
    missing: (key: string, path: string[]) =>
        `missing property '${key}' at '${messages.path(path)}'`,
    mismatch: (key: string, path: string[], actual: unknown, expected: t.Decoder<any, any>) =>
        `got '${actual}' expected '${expected.name}' at '${messages.path([...path, key])}'`,
};

export function report(validation: t.Validation<unknown>): string | null {
    return isLeft(validation) ? buildTree(validation.left) : null;
}

export function buildTree(
    errors: t.Errors,
    { path, parentType }: { path: string[]; parentType: t.Decoder<any, any> | null } = {
        path: [],
        parentType: null,
    },
): string | null {
    // const type = errors[0]?.context[0]?.type;
    // if (!type) return null;

    const isUnion = parentType instanceof t.UnionType;
    const isIntersection = parentType instanceof t.IntersectionType;

    const context = errors
        .map(({ context: [head, ...rest] }) => ({
            ...head,
            isExhausted: rest.every(({ actual }) => actual === head.actual),
            isLast: rest.length === 0,
        }))
        .filter(isNotNullable);

    const allExhausted = context.every(({ isExhausted }) => isExhausted);
    //

    const typeMismatch =
        !(isUnion && !allExhausted) &&
        findMap(context, ({ key, type, actual, isExhausted, isLast }) => {
            if (allExhausted)
                return actual !== undefined && messages.mismatch(key, path, actual, type);

            return (
                !(type instanceof t.UnionType) &&
                isExhausted &&
                // isLast &&
                actual !== undefined &&
                messages.mismatch(key, path, actual, type)
            );
        });

    if (typeMismatch) return typeMismatch;

    const missingProperty = findMap(
        context,
        ({ key, actual }) => actual === undefined && messages.missing(key, path),
    );

    if (missingProperty) return missingProperty;

    const subErrors = errors
        .filter(({ context }) => context.length)
        .map(({ context: [head, ...tail], ...rest }) => ({
            ...rest,
            context: tail,
            key: head.key,
            type: head.type,
            actual: head.actual,
        }));

    const errorsByPath = groupBy(subErrors, ({ key }) => key);

    const branch = selectBranch(parentType, errorsByPath);
    if (!branch) return null;

    const [branchKey, branchSubErrors] = branch;
    const type = branchSubErrors[0]?.type;

    if (!type) return null;

    return buildTree(branchSubErrors, {
        path:
            isUnion || isIntersection || (path.length === 0 && !branchKey)
                ? path
                : [...path, branchKey],
        parentType: type,
    });
}

function selectBranch(
    parentType: t.Decoder<any, any> | null,
    branchRecord: Record<string, ErrorsExt>,
): [string, ErrorsExt] | null {
    const branches = Object.entries(branchRecord);
    if (branches.length === 1) return branches[0];

    if (parentType instanceof t.UnionType) {
        const candidates = maxByAll(branches, ([_, [{ type, actual }]]) => {
            const props = getProps(type);
            if (!props) return -1;
            if (!t.UnknownRecord.is(actual)) return -1;

            return intersection(Object.keys(actual), Object.keys(props)).length;
        });

        const [bestBranch] = minByAll(candidates, ([_, context]) => context.length);

        return bestBranch;
    }

    return branches[0];
}

function head<T>(arr: ReadonlyArray<T>): T | undefined {
    return arr[0];
}

function groupBy<T, K extends string>(arr: T[], by: (a: T) => K): Record<K, T[]> {
    return arr.reduce((acc, item) => {
        const key = by(item);
        if (!acc[key]) acc[key] = [];

        acc[key].push(item);

        return acc;
    }, {} as Record<string, T[]>);
}

function isNotNullable<T>(a: T | null | undefined): a is T {
    return a !== null && a !== undefined;
}

function findMap<T, U>(arr: T[], mapper: (a: T) => U, pred = Boolean) {
    for (const element of arr) {
        const mapped = mapper(element);
        if (pred(mapped)) return mapped;
    }
    return null;
}

function maxByAll<T>(arr: T[], by: (a: T) => number): T[] {
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

function minByAll<T>(arr: T[], by: (a: T) => number): T[] {
    return maxByAll(arr, a => -by(a));
}

function intersection<T>(arrA: T[], arrB: T[]): T[] {
    return arrA.filter(a => arrB.includes(a));
}

function getProps(codec: t.Decoder<any, any>): Record<string, t.Decoder<any, any>> | null {
    if (!isTaggedCodec(codec)) return null;

    switch (codec._tag) {
        case 'RefinementType':
        case 'ReadonlyType':
            return getProps(codec.type);
        case 'InterfaceType':
        case 'StrictType':
        case 'PartialType':
            return codec.props;
        case 'IntersectionType':
            return codec.types.reduce(
                (props: Record<string, t.Decoder<any, any>>, type: t.Decoder<any, any>) =>
                    Object.assign(props, getProps(type)),
                {},
            );
        case 'RecursiveType':
            return getProps(codec.runDefinition());
        default:
            return null;
    }
}

export type TaggedCodec =
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

function isTaggedCodec(codec: t.Decoder<any, any>): codec is TaggedCodec {
    return hasKey(codec, '_tag') && t.string.is(codec._tag) && hasKey(CodecTags, codec._tag);
}

function hasKey<K extends string, R extends object>(
    obj: R,
    key: K,
): obj is R & { [key in K]: unknown } {
    return key in obj;
}

export const CodecTags: Record<TaggedCodec['_tag'], TaggedCodec['_tag']> = {
    NullType: 'NullType',
    StringType: 'StringType',
    NumberType: 'NumberType',
    BooleanType: 'BooleanType',
    LiteralType: 'LiteralType',
    ArrayType: 'ArrayType',
    InterfaceType: 'InterfaceType',
    PartialType: 'PartialType',
    DictionaryType: 'DictionaryType',
    UnionType: 'UnionType',
    IntersectionType: 'IntersectionType',
    TupleType: 'TupleType',
    ReadonlyType: 'ReadonlyType',
    ReadonlyArrayType: 'ReadonlyArrayType',
    StrictType: 'StrictType',
    KeyofType: 'KeyofType',
    ExactType: 'ExactType',
    UndefinedType: 'UndefinedType',
    VoidType: 'VoidType',
    UnknownType: 'UnknownType',
    BigIntType: 'BigIntType',
    AnyArrayType: 'AnyArrayType',
    AnyDictionaryType: 'AnyDictionaryType',
    FunctionType: 'FunctionType',
    RefinementType: 'RefinementType',
    RecursiveType: 'RecursiveType',
    AnyType: 'AnyType',
    ObjectType: 'ObjectType',
} as const;
