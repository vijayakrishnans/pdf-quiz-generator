# web-tests

The app's vitest suite (the quiz route streaming from a Workers AI stand-in, the PDF decoding and conversion, the model choice and its middleware, the template's page in jsdom, the schema and the site's identity), run with pnpm test

The test suite for **web**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/web`          |
| Package      | `@app/web-tests`     |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
