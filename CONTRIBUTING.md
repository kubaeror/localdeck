# Contributing to LocalDeck

Thanks for taking an interest in LocalDeck, the open-source web console for
local AWS emulators (LocalStack, MiniStack, Floci and any endpoint that speaks
the AWS wire protocol). This guide covers the setup a contributor needs, the
checks a pull request must pass, and the rules that keep the project legally
and technically clean.

## Prerequisites

- **Node.js 22** (the CI version) or Node 20.19+ for local work (`.nvmrc`
  pins 22 for version managers).
- **pnpm 10** — `corepack enable pnpm`. `.npmrc` sets `engine-strict=true`, so
  an older Node fails the install instead of failing later in Vite.
- **A local emulator you manage yourself.** LocalDeck never starts, stops,
  reconfigures or wipes it; the smoke tests and the live verification scripts
  simply talk to the endpoint you point them at. LocalStack, MiniStack
  (`ministackorg/ministack`) and Floci (`floci/floci:latest`) are supported and
  tested; other AWS-compatible endpoints work through the generic fallback.
  - Current LocalStack releases (2026.03 and later) require an auth token to
    start; obtain one from your LocalStack account and export it in _your_
    LocalStack environment. This repository never stores or forwards it.
  - The EKS module needs a provider that starts real Kubernetes containers
    (LocalStack with an EKS entitlement, Floci real mode, MiniStack k3s) and
    the Docker socket mounted into _your_ emulator
    (`-v /var/run/docker.sock:/var/run/docker.sock`).

## Setup

```bash
git clone https://github.com/kubaeror/localdeck.git
cd localdeck
pnpm install
EMULATOR_ENDPOINT=http://localhost:4566 pnpm dev
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

CI (`.github/workflows/ci.yml`) runs exactly these on Node 22, builds the three
Docker images without pushing them, and then runs browser jobs: a smoke matrix
that spins up a **throwaway emulator service container per leg** (LocalStack,
MiniStack and Floci) and drives the console through `vite preview`, a container
job that runs the shipped `docker compose` stack (nginx + api) and uploads an
S3 object larger than nginx's 1 MiB default, and a sidecar job that starts
Floci plus the single-container console image and asserts the Floci Console
Contract v1 surface. Those containers are the single allowed exception to
"LocalDeck never manages an emulator": they exist only inside the workflow.

## End-to-end smoke tests

The Playwright suite lives in `e2e/` and drives the real console against a real
emulator:

```bash
# with your own emulator already running (node process, not containers):
EMULATOR_ENDPOINT=http://localhost:4566 pnpm test:e2e

# or while `pnpm dev` runs: Playwright reuses the servers on 3001/5173
pnpm test:e2e
```

The suite starts the api and ui itself (unless they are already running), then
asserts:

- `GET /api/health` answers 200 against the emulator and the ui index loads;
- a bucket is created through the S3 wizard, its detail page opens, and the
  bucket is deleted again;
- an object uploads and downloads through the S3 proxy routes;
- an EC2 instance is launched and terminated through the dispatcher;
- unknown services, non-whitelisted operations, missing SDK packages and an
  unreachable emulator answer the documented 404/400/501/503 contracts;
- EKS cluster creation starts through the wizard when the emulator reports EKS.
  On an emulator without EKS the test asserts the console's honest "not enabled"
  page instead and annotates the run — it never fakes a cluster. Set
  `LOCALDECK_E2E_SKIP_EKS=1` in matrix legs that only smoke-test the rest of the
  console (the MiniStack/Floci CI legs do).

The shipped containers have their own minimal project:

```bash
docker compose up --build            # nginx serves the bundle, api proxies /api
pnpm test:e2e:container              # uploads >1 MiB through nginx
```

Useful environment variables: `EMULATOR_ENDPOINT` (`LOCALSTACK_ENDPOINT` is an
alias), `EMULATOR_PROVIDER`, `LOCALDECK_E2E_SKIP_EKS`, `E2E_UI_PORT`,
`E2E_API_PORT`, `E2E_CONTAINER_UI_PORT`. The specs record every resource they
create under `e2e/test-results/e2e-cleanup.jsonl`; a global teardown sweeps
anything left behind (only names with the `localdeck-e2e` prefix and instances
tagged `localdeck:e2e` are touched). CI uploads `e2e/playwright-report/` and
`e2e/playwright-report-container/` when a browser job fails.

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
# or against the containers: LOCALDECK_SCREENSHOT_BASE_URL=http://localhost:8080
```

The script creates and removes a demo bucket so the S3 pages show real data,
and waits for each page's own locators (no fixed sleeps). CI runs the same
script against the container stack and uploads the generated images as the
`docs-screens` artifact, so a stale committed screenshot is visible in the PR
without CI touching the working tree.

## Code rules

- TypeScript strict, **zero `any`**, no `@ts-expect-error` without an
  explanatory reason. ESLint enforces both; `pnpm verify:repo` and the
  architecture guard tests catch the rest.
- The browser never calls the emulator or the AWS SDK directly. Every service
  call goes through `apps/ui/src/lib/apiClient.ts` to the api dispatcher; the
  ui architecture tests fail the build otherwise.
- Provider differences live in `packages/shared/src/providers/`: health
  fingerprints, status normalization (Floci's `available` means disabled) and
  service-key aliases. Never compare raw provider statuses outside that module.
  Operations an emulator does not implement must surface as
  `EMULATOR_OPERATION_UNSUPPORTED` and a disabled action, never a raw 5xx.
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
- LocalDeck is not affiliated with LocalStack, MiniStack or Floci. Name them
  factually for interoperability; never use their logos or imply endorsement.

## Pull requests

1. Fork and branch from `main`.
2. Keep the change focused; include tests for behaviour and update the docs
   the change touches.
3. Run the full check list above locally (the same commands CI runs).
4. Describe what you verified against your own emulator (`pnpm
verify:emulator` prints the detected provider and version), because coverage
   varies between emulators, releases and plans.

## License

By contributing you agree that your contribution is licensed under the MIT
License (see `LICENSE`). Third-party artwork and components keep their own
terms (see `NOTICE`).
