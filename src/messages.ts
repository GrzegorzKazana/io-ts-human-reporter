import { AnyDecoder } from './codecs';

export type Messages = typeof messages;

export const messages = {
    path: (path: string[]) => path.join('.'),

    missing: (keys: string[], path: string[]) =>
        `missing ${keys.length === 1 ? 'property' : 'properties'} '${keys.join(
            `', '`,
        )}' at '${messages.path(path)}'`,

    mismatch: (key: string, path: string[], actual: unknown, expected: AnyDecoder) =>
        `got '${actual}' expected '${expected.name}' at '${messages.path([...path, key])}'`,

    custom: (msg: string, path: string[]) => `${msg} at '${messages.path(path)}'`,
};
