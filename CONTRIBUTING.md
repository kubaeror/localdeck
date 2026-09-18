# Contributing to LocalDeck

Thanks for taking an interest in LocalDeck, the open-source web console for
LocalStack. This guide covers the setup a contributor needs, the checks a pull
request must pass, and the rules that keep the project legally and technically
clean.

## Prerequisites

- **Node.js 22** (the CI version) or Node 20.11+ for local work.
- **pnpm 10** — `corepack enable pnpm`.
- **A LocalStack instance you manage yourself.** LocalDeck never starts, stops,
  reconfigures or wipes LocalStack; the smoke tests and the live verification
  scripts simply talk to the endpoint you point them at.
  - Current LocalStack releases (2026.03 and later) require an auth token to
    start; obtain one from your LocalStack account and export it in _your_
    LocalStack environment. This repository never stores or forwards it.
  - The EKS module needs a LocalStack entitlement that includes EKS, and the
    k3d provider needs the Docker socket mounted into _your_ LocalStack
    (`-v /var/run/docker.sock:/var/run/docker.sock`).

## Setup

```bash
git clone https://github.com/kubaeror/localdeck.git
cd localdeck
pnpm install
LOCALSTACK_ENDPOINT=http://localhost:4566 pnpm dev
```

- ui: <http://localhost:5173>
- api: <http://localhost:3001>

`packages/shared` must be compiled before the apps run; `pnpm dev` does that
through turbo. If you change shared types while a dev server is running, start
`pnpm --filter @localdeck/shared dev` in a second terminal.

## Checks every pull request runs

```bash
pnpm typecheck          # TypeScript strict in every workspace
pnpm lint               # ESLint (flat config)
pnpm lint:format        # Prettier --check
pnpm test               # Vitest for shared, api and ui
pnpm build              # shared + api + ui
pnpm verify:repo        # disclaimer, MIT license, no secret material
pnpm gen:parity:check   # README parity table is current
```

CI (`.github/workflows/ci.yml`) runs exactly these on Node 22 and then a smoke
job that spins up a **throwaway LocalStack service container** and drives the
console with Playwright. That container is the single allowed exception to
"LocalDeck never manages LocalStack": it exists only inside the workflow.

## End-to-end smoke tests

The Playwright suite lives in `e2e/` and drives the real console against a real
LocalStack:

```bash
# with your own LocalStack already running (node process, not containers):
LOCALSTACK_ENDPOINT=http://localhost:4566 pnpm test:e2e

# or while `pnpm dev` runs: Playwright reuses the servers on 3001/5173
pnpm test:e2e
```

The suite starts the api and ui itself (unless they are already running), then
asserts:

- `GET /api/health` answers 200 against the emulator and the ui index loads;
- a bucket is created through the S3 wizard, its detail page opens, and the
  bucket is deleted again;
- EKS cluster creation starts through the wizard when the emulator reports EKS
  (Ultimate-plan feature). On an emulator without EKS the test asserts the
  console's honest "not enabled" page instead and annotates the run — it never
  fakes a cluster.

Useful environment variables: `LOCALSTACK_ENDPOINT`, `E2E_UI_PORT`,
`E2E_API_PORT`. CI uploads `e2e/playwright-report/` when the smoke job fails.

### Running the smoke job with licensed LocalStack features

The CI default image is the last LocalStack release published before the
unified-image licensing change, so a fresh clone's pipeline is green without
any secrets. To smoke-test a current image (and EKS if your entitlement
includes it), configure the repository:

- variable `LOCALSTACK_IMAGE`, for example `localstack/localstack:2026.8.3`;
- secret `LOCALSTACK_AUTH_TOKEN`, a CI auth token from your LocalStack account.

## Screenshots in the README

Only screenshots of LocalDeck's own ui may be committed, and only under
`docs/screens/`. Never commit a screenshot of another cloud console. To refresh
them, run the dev stack or `docker compose up`, then:

```bash
LOCALDECK_SCREENSHOT_BASE_URL=http://localhost:5173 pnpm test:e2e:screens
```

The script creates and removes a demo bucket so the S3 pages show real data.

## Code rules

- TypeScript strict, **zero `any`**, no `@ts-expect-error` without an
  explanatory reason. ESLint enforces both; `pnpm verify:repo` and the
  architecture guard tests catch the rest.
- The browser never calls LocalStack or the AWS SDK directly. Every service
  call goes through `apps/ui/src/lib/apiClient.ts` to the api dispatcher; the
  ui architecture tests fail the build otherwise.
- AWS SDK clients are constructed only by
  `apps/api/src/lib/awsClients.ts`.
- Compose every page from the shared primitives in
  `apps/ui/src/components/`; service modules must not re-implement them.
- New services belong in the registry
  (`packages/shared/src/catalog/`) and, if they get hand-written pages, a
  module folder generated with `pnpm turbo gen service`.
- The parity table in the README is generated: run `pnpm gen:parity` after
  changing the registry.

## Legal rules

- Do not use "AWS" in the brand, repository name, package names or domains.
  Service names in UI text (for example "Lambda" or "S3 Buckets") are fine.
- The README and the app footer must keep the trademark disclaimer; do not
  remove it.
- Never add screenshots of the real cloud console to the repository, the docs
  or the README.
- Icon artwork is not covered by the project's MIT license. Keep official
  filenames and never recolor or crop icons; see `NOTICE`.

## Pull requests

1. Fork and branch from `main`.
2. Keep the change focused; include tests for behaviour and update the docs
   the change touches.
3. Run the full check list above locally (the same commands CI runs).
4. Describe what you verified against your own LocalStack, including the
   LocalStack version, because emulator coverage varies between releases and
   plans.

## License

By contributing you agree that your contribution is licensed under the MIT
License (see `LICENSE`). Third-party artwork and components keep their own
terms (see `NOTICE`).
