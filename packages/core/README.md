# @openlinguo/core

Domain model shared by the web app, the API and the language packs.

## Error conventions

- Domain code does not throw. Fallible functions return `Result<T, E>` (`ok` / `err`), with `E` a typed union of known failures.
- Every I/O boundary (network, storage, files, AI output) parses its input with a zod schema through `parseWith`, which returns `Result<T, ValidationError>`.
- Absence is modeled with `T | null`. `undefined`, optional properties and optional parameters are rejected by lint.
- A failure is never replaced by a silent default: callers either handle the error case or surface it to the user.

## AI client

`chat` and `listModels` (`src/ai-client.ts`) call an OpenAI-compatible endpoint from the device, as ADR 0012 decides. Their tests replay real provider responses from `src/testing/ai-responses/<provider>/<scenario>.json`, stripped of ids and keys.

To record them again, run from the repository root, with a model per provider (a second model, one that refuses strict `json_schema`, records the fallback):

```sh
pnpm --filter @openlinguo/core record:ai groq=<model>,<model without strict json_schema> openrouter=<model> mistral=<model> local=<model>
```

Keys come from `GROQ_API_KEY`, `OPENROUTER_API_KEY` and `MISTRAL_API_KEY`, or from a hidden prompt; they are never written. The rate-limit scenario sends up to 60 quick calls. Lines starting with `!` got another outcome than expected: read the file before committing it.

## Wikidata client

`lookupWikidata` (`src/wikidata.ts`) checks unknown character sequences on Wikidata with one SPARQL `GET` per 50 sequences, as ADR 0014 decides. It returns the answers of the requests that succeeded and the first error, retries nothing and caches nothing. Its tests replay real answers from `src/testing/wikidata-responses/<scenario>.json`; the 429 is tested on the user manual's shape, as it cannot be triggered on demand.

To record them again, run from the repository root:

```sh
pnpm --filter @openlinguo/core record:wikidata
```

It sends three requests, two seconds apart, with the User-Agent `OpenLinguo-recorder/1.0 (https://github.com/R4z4kk/OpenLinguo)`, as the Wikimedia User-Agent policy asks of scripts, and only for the public names of `src/testing/wikidata-recordings.ts`. Lines starting with `!` got another outcome than expected: nothing was written for them.
