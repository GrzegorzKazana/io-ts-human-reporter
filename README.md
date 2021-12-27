# io-ts-humman-reporter

Customizable and _smart_ io-ts error reporting.

Have you ever got yourself into position that you wanted to present [io-ts](https://github.com/gcanti/io-ts) validation
errors to actual end users?\
Or perhaps, your types are quite complex and error messages are not really helpful even during development?\
Or maybe you are just looking for a customizable way to display missing or invalid fields on API request payloads?

If the answer for any of the above questions is yes - I think I got you covered.

## goal

Provide human-friendly error messages based on [io-ts](https://github.com/gcanti/io-ts) validation. So human friendly,
that you could even show them to anyone having basic idea about json.

## usage/examples

```ts
import * as t from 'io-ts';
import { report, reportOne } from 'io-ts-humman-reporter';

const codec = t.type({
    root: t.type({
        a: t.number,
        b: t.string,
        c: t.union([
            t.type({ c1: t.string, c2: t.string }),
            t.type({ d1: t.string, d2: t.string }),
        ]),
    }),
});

const validation = codec.decode({ root: { a: 1, b: '', c: { d1: 1 } } });

report(validation);
// [
//   "got '1' expected 'string' at 'root.c.d1'",
//   "missing property 'd2' at 'root.c'",
// ]

reportOne(validation);
// "got '1' expected 'string' at 'root.c.d1'"
```

## features

-   ### _smart_ handling of unions

    errors will be reported only from the variant which has the most in common with the given input

```ts
const codec = t.union([t.type({ a: t.number, b: t.null }), t.type({ c: t.string, d: t.number })]);

const data = { c: null };

report(codec.decode(data));
// [
//   "got `null` expected 'string' at 'c'",
//   "missing property 'd' at ''",
// ]
```

-   ### message customization

    e.g. for translations

```ts
const codec = t.type({ a: t.number, b: t.null });
const data = { a: '11' };

report(codec.decode(data), {
    messages: {
        missing: (keys, path) =>
            `YOINKS! You forgot to add "${keys.join(',')}" at "${path.join('/')}".`,
    },
});
// [
//     "got `11` expected 'number' at 'a'",
//     'YOINKS! You forgot to add "b" at "."'
// ]
```

-   ### short-circuiting report of the first error

    for greater efficiency on huge objects

```ts
const codec = t.type({ a: t.number, b: t.null });

reportOne(codec.decode({ a: '11' }));
// "got `11` expected 'number' at 'a'"
reportOne(codec.decode({ a: 11, b: null }));
// null
```

-   ### respecting custom codec names

```ts
const codec = t.type({ a: t.number, b: t.null }, 'FooBar');
const data = null;

report(codec.decode(data));
// [
//     "got `null` expected 'FooBar' at ''"
// ]
```
