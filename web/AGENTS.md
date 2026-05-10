# AGENTS.md

## Commands

```bash
bun run dev
bun run build
bun run preview

bun run check
bun run lint
bun run format

bun run test
```

## Before Marking A Task Complete

- [ ] `bun run check`
- [ ] `bun run lint`
- [ ] `bun run test`
- [ ] `bun run build`

## Structure

- `src/routes/+page.svelte` contains the main demo flow and UI state machine.
- `src/lib/encoding.ts` contains client-side Vow encoding logic.
- `src/lib/witnessClient.ts` contains witness polling and fetch behavior.
- `src/lib/contract.ts` contains on-chain read/call helpers.
- `src/lib/types.ts` contains shared UI and protocol-facing types.
- `tests/` contains Playwright coverage.
- `static/` contains static assets.

## Rules

- Keep client-side encoding, signer validation, and witness polling aligned with `../witness/` and `../solidity/`.
- This app is a protocol inspection tool, not a marketing page. Preserve clear step-by-step status, explicit errors, and inspectable output.
- When a protocol rule is shared within `web/`, define it once in `src/lib/` instead of duplicating literals in the page component.
- UI or network-flow changes should come with updated Playwright coverage when behavior changes materially.

## Documentation

- Update the root `README.md` when demo usage, required endpoints, or contract addresses/workflows change.
