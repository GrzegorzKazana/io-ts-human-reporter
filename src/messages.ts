import { AnyDecoder } from './codecs';

export type Messages = {
    path: (path: string[]) => string;
    stringify: (thing: unknown) => string;
    missing: (keys: string[], path: string[]) => string;
    mismatch: (key: string, path: string[], actual: unknown, expected: AnyDecoder) => string;
    custom: (msg: string, path: string[]) => string;
};

const defaultPath: Messages['path'] = path => path.join('.');
const defaultStringify: Messages['stringify'] = thing => {
    switch (typeof thing) {
        case 'bigint':
        case 'number':
            return `\`${thing}\``;
        case 'boolean':
            return `\`${thing}\``;
        case 'string':
            return `"${thing.length > 15 ? thing.slice(0, 12).concat('...') : thing}"`;
        case 'function':
        case 'symbol':
        case 'undefined':
            return `\`${typeof thing}\``;
        case 'object': {
            if (!thing) return `\`null\``;

            if (Array.isArray(thing))
                return thing.length === 0
                    ? `\`[]\``
                    : thing.length === 1
                    ? `\`[1 item]\``
                    : `\`[${thing.length} items]\``;

            const keys = Object.keys(thing);

            return keys.length === 0
                ? `\`{}\``
                : keys.length <= 3
                ? `\`{${keys.join(',')}}\``
                : `\`{${keys.slice(0, 3).join(',').concat('...')}}\``;
        }
    }
};

export const Messages = {
    default: ({
        path: stringifyPath = defaultPath,
        stringify: stringifyValue = defaultStringify,
    }: Partial<Pick<Messages, 'path' | 'stringify'>> = {}): Messages => ({
        path: stringifyPath,
        stringify: stringifyValue,
        missing: (keys, path) =>
            `missing ${keys.length === 1 ? 'property' : 'properties'} '${keys.join(
                `', '`,
            )}' at '${stringifyPath(path)}'`,

        mismatch: (key, path, actual, expected) =>
            `got ${stringifyValue(actual)} expected '${expected.name}' at '${stringifyPath([
                ...path,
                key,
            ])}'`,

        custom: (msg, path) => `${msg} at '${stringifyPath(path)}'`,
    }),

    withDefault: (messages: Partial<Messages> = {}): Messages => ({
        ...Messages.default(messages),
        ...messages,
    }),
};
