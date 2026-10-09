# @openlinguo/core

Domain model shared by the web app, the API and the language packs.

## Error conventions

- Domain code does not throw. Fallible functions return `Result<T, E>` (`ok` / `err`), with `E` a typed union of known failures.
- Every I/O boundary (network, storage, files, AI output) parses its input with a zod schema through `parseWith`, which returns `Result<T, ValidationError>`.
- Absence is modeled with `T | null`. `undefined`, optional properties and optional parameters are rejected by lint.
- A failure is never replaced by a silent default: callers either handle the error case or surface it to the user.
