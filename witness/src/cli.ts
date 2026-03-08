#!/usr/bin/env bun
import { parseArgs } from "util";
import { fetchAndEncodeVow, type WitnessEndpoint } from "./client/index.ts";

const USAGE = `Usage:
  vow-witness fetch-and-encode \\
    --endpoint <signerIndex>@<url> [--endpoint ...] \\
    --chain <caip2ChainId> \\
    --block <blockNumber> \\
    --log-index <logIndex> \\
    [--poll-interval <ms>] \\
    [--timeout <ms>]

Example:
  vow-witness fetch-and-encode \\
    --endpoint 1@http://localhost:3000 \\
    --chain eip155:1 \\
    --block 12345 \\
    --log-index 0
`;

function die(msg: string): never {
  process.stderr.write(`Error: ${msg}\n\n${USAGE}`);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    endpoint: { type: "string", multiple: true },
    chain: { type: "string" },
    block: { type: "string" },
    "log-index": { type: "string" },
    "poll-interval": { type: "string" },
    timeout: { type: "string" },
  },
  allowPositionals: true,
});

const [command] = positionals;
if (command !== "fetch-and-encode") {
  die(`Unknown command: "${command ?? ""}". Expected "fetch-and-encode".`);
}

if (!values.endpoint || values.endpoint.length === 0) {
  die("At least one --endpoint is required.");
}
if (!values.chain) die("--chain is required.");
if (!values.block) die("--block is required.");
if (values["log-index"] === undefined) die("--log-index is required.");

const blockNumber = Number(values.block);
if (!Number.isInteger(blockNumber) || blockNumber < 0) {
  die(`Invalid --block value: "${values.block}"`);
}

const logIndex = Number(values["log-index"]);
if (!Number.isInteger(logIndex) || logIndex < 0) {
  die(`Invalid --log-index value: "${values["log-index"]}"`);
}

const endpoints: WitnessEndpoint[] = values.endpoint.map((s) => {
  const atIdx = s.indexOf("@");
  if (atIdx <= 0) {
    die(`Invalid --endpoint format "${s}". Expected "<signerIndex>@<url>".`);
  }
  const signerIndex = Number(s.slice(0, atIdx));
  if (!Number.isInteger(signerIndex) || signerIndex < 1 || signerIndex > 255) {
    die(`Invalid signer index in endpoint "${s}". Must be 1–255.`);
  }
  return { signerIndex, url: s.slice(atIdx + 1) };
});

const pollIntervalMs = values["poll-interval"]
  ? Number(values["poll-interval"])
  : undefined;
const timeoutMs = values.timeout ? Number(values.timeout) : undefined;

try {
  const result = await fetchAndEncodeVow(
    endpoints,
    values.chain,
    blockNumber,
    logIndex,
    { pollIntervalMs, timeoutMs }
  );
  process.stdout.write(result + "\n");
} catch (err) {
  process.stderr.write(
    `Error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
}
