import { expect, test, type Page } from "@playwright/test";
import { encodeAbiParameters, toFunctionSelector } from "viem";

const MOCK_SIGNER = "0x2222222222222222222222222222222222222222";
const GET_SIGNER_SELECTOR = toFunctionSelector("getSigner(uint256)");
const PROCESS_VOW_SELECTOR = toFunctionSelector("processVow(address,bytes)");
const DECODE_EVENT_SELECTOR = toFunctionSelector("decodeEvent(bytes)");
const DECODE_EMIT_CPI_SELECTOR = toFunctionSelector("decodeEmitCPI(bytes)");

const DEFAULT_ETHEREUM_BLOCK_NUMBER = 25_061_118;
const DEFAULT_ETHEREUM_LOG_INDEX = 2820;
const DEFAULT_SOLANA_TX_SIGNATURE =
  "HYtVCbkEaJ1tVqwEvfDUJQg1T65g1wtiFJJyVo9TZEygezeA9aTUTaZTZ2hJDumns4C4WnGDEp7387u2UAE2ukY";
const DEFAULT_WITNESS_DIRECTORY = "0x0bCd1123AfB2088084847bF4B4b10C2B2dfa5963";
const DEFAULT_MOCK_VOW_LIB = "0xb58fB4D3eA84Eb4845Fc7e1CC727b307f26fd856";

const MOCK_ETHEREUM_WITNESS = {
  signer: MOCK_SIGNER,
  chainId: "eip155:1",
  rootBlockNumber: 100,
  proof: [],
  signature:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  event: {
    emitter: "0x1111111111111111111111111111111111111111",
    topics: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    data: "0xdeadbeef",
  },
};

const MOCK_SOLANA_WITNESS = {
  signer: MOCK_SIGNER,
  chainId: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  rootSlot: 200,
  proof: [],
  signature:
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  event: {
    programId: "11".repeat(32),
    discriminator: "22".repeat(8),
    data: "deadbeef",
  },
};

const ETHEREUM_EVT = (`0x1111111111111111111111111111111111111111` +
  `01` +
  `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` +
  `deadbeef`) as `0x${string}`;

const SOLANA_EVT = (`0x${MOCK_SOLANA_WITNESS.event.programId}` +
  `${MOCK_SOLANA_WITNESS.event.discriminator}` +
  `${MOCK_SOLANA_WITNESS.event.data}`) as `0x${string}`;

const MOCK_GET_SIGNER_RESULT = `0x${"0".repeat(24)}${MOCK_SIGNER.slice(2).toLowerCase()}`;

const MOCK_PROCESS_VOW_GAS_ESTIMATE = "0x1e240";

const MOCK_PROCESS_VOW_ETHEREUM_RESULT = encodeAbiParameters(
  [
    { name: "chainId", type: "uint256" },
    { name: "rootBlockNumber", type: "uint256" },
    { name: "evt", type: "bytes" },
  ],
  [1n, 100n, ETHEREUM_EVT]
);

const MOCK_DECODE_EVENT_RESULT = encodeAbiParameters(
  [
    { name: "emitter", type: "address" },
    { name: "topics", type: "bytes32[]" },
    { name: "data", type: "bytes" },
  ],
  [
    MOCK_ETHEREUM_WITNESS.event.emitter as `0x${string}`,
    MOCK_ETHEREUM_WITNESS.event.topics as `0x${string}`[],
    MOCK_ETHEREUM_WITNESS.event.data as `0x${string}`,
  ]
);

const MOCK_PROCESS_VOW_SOLANA_RESULT = encodeAbiParameters(
  [
    { name: "chainId", type: "uint256" },
    { name: "rootBlockNumber", type: "uint256" },
    { name: "evt", type: "bytes" },
  ],
  [123n, 200n, SOLANA_EVT]
);

const MOCK_DECODE_EMIT_CPI_RESULT = encodeAbiParameters(
  [
    { name: "programId", type: "bytes32" },
    { name: "discriminator", type: "bytes8" },
    { name: "data", type: "bytes" },
  ],
  [
    `0x${MOCK_SOLANA_WITNESS.event.programId}`,
    `0x${MOCK_SOLANA_WITNESS.event.discriminator}`,
    `0x${MOCK_SOLANA_WITNESS.event.data}`,
  ]
);

function buildEthCallResult(data?: string): string {
  const selector = data?.slice(0, 10);
  if (selector === GET_SIGNER_SELECTOR) return MOCK_GET_SIGNER_RESULT;
  if (selector === PROCESS_VOW_SELECTOR) return MOCK_PROCESS_VOW_ETHEREUM_RESULT;
  if (selector === DECODE_EVENT_SELECTOR) return MOCK_DECODE_EVENT_RESULT;
  if (selector === DECODE_EMIT_CPI_SELECTOR) return MOCK_DECODE_EMIT_CPI_RESULT;
  return "0x0";
}

function buildRpcResult(method?: string, data?: string): string {
  if (method === "eth_estimateGas") return MOCK_PROCESS_VOW_GAS_ESTIMATE;
  if (method === "eth_call") return buildEthCallResult(data);
  return "0x0";
}

function buildRpcResponse(body: unknown) {
  if (Array.isArray(body)) {
    const entries = body as Array<{
      id?: number;
      method?: string;
      params?: Array<{ data?: string }>;
    }>;
    return entries.map((entry) => ({
      id: entry.id ?? 1,
      jsonrpc: "2.0",
      result: buildRpcResult(entry?.method, entry?.params?.[0]?.data),
    }));
  }
  const entry = body as { id?: number; method?: string; params?: Array<{ data?: string }> };
  return {
    id: entry.id ?? 1,
    jsonrpc: "2.0",
    result: buildRpcResult(entry.method, entry.params?.[0]?.data),
  };
}

async function mockRpc(page: Page) {
  await page.route("https://mock-rpc.example.com", async (route) => {
    const body = JSON.parse((route.request().postData() ?? "{}") as string);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRpcResponse(body)),
    });
  });
}

test("page loads with title and form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vow Demo" })).toBeVisible();
  await expect(page.getByPlaceholder("https://witness.example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
});

test("form validation shows error on empty RPC URL", async ({ page }) => {
  await page.goto("/");

  await page.fill('input[placeholder="https://rpc.example.com"]', "");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("validation-error")).toBeVisible();
  await expect(page.getByTestId("validation-error")).toContainText("RPC URL");
});

test("ethereum defaults and verifier contract fields are visible", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Source Mode")).toHaveValue("ethereum");
  await expect(page.getByLabel("Source Chain ID")).toHaveValue("eip155:1");
  await expect(page.getByLabel("Block Number")).toHaveValue(String(DEFAULT_ETHEREUM_BLOCK_NUMBER));
  await expect(page.getByLabel("Log Index")).toHaveValue(String(DEFAULT_ETHEREUM_LOG_INDEX));
  await expect(page.getByLabel("WitnessDirectory")).toBeDisabled();
  await expect(page.getByLabel("MockVowLib")).toBeDisabled();
  await expect(page.getByLabel("WitnessDirectory")).toHaveValue(DEFAULT_WITNESS_DIRECTORY);
  await expect(page.getByLabel("MockVowLib")).toHaveValue(DEFAULT_MOCK_VOW_LIB);
});

test("switching to solana resets the source-specific defaults", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Source Mode").selectOption("solana");

  await expect(page.getByLabel("Source Chain ID")).toHaveValue("solana:mainnet");
  await expect(page.getByLabel("Transaction Signature")).toHaveValue(DEFAULT_SOLANA_TX_SIGNATURE);
  await expect(page.getByLabel("Event Index")).toHaveValue("0");
});

test("add and remove witness sources", async ({ page }) => {
  await page.goto("/");

  await page.getByText("+ Add witness").click();
  const inputs = page.getByPlaceholder("https://witness.example.com");
  await expect(inputs).toHaveCount(2);

  await page.getByRole("button", { name: "Remove witness source" }).first().click();
  await expect(inputs).toHaveCount(1);
});

test("mock ethereum witness flow completes with proof and decode steps", async ({ page }) => {
  await page.route(
    `**/witness/eip155:1/${DEFAULT_ETHEREUM_BLOCK_NUMBER}/${DEFAULT_ETHEREUM_LOG_INDEX}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", witness: MOCK_ETHEREUM_WITNESS }),
      });
    }
  );
  await mockRpc(page);

  await page.goto("/");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("proof-results")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("steps")).toContainText("Decoding evt with decodeEvent");
});

test("run fails when witness signer does not match selected on-chain signer index", async ({
  page,
}) => {
  await page.route(
    `**/witness/eip155:1/${DEFAULT_ETHEREUM_BLOCK_NUMBER}/${DEFAULT_ETHEREUM_LOG_INDEX}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          witness: {
            ...MOCK_ETHEREUM_WITNESS,
            signer: "0x3333333333333333333333333333333333333333",
          },
        }),
      });
    }
  );
  await mockRpc(page);

  await page.goto("/");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("run-error")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("run-error")).toContainText("signer validation failure");
});

test("ethereum result table renders processed vow and decoded event fields", async ({ page }) => {
  await page.route(
    `**/witness/eip155:1/${DEFAULT_ETHEREUM_BLOCK_NUMBER}/${DEFAULT_ETHEREUM_LOG_INDEX}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", witness: MOCK_ETHEREUM_WITNESS }),
      });
    }
  );
  await mockRpc(page);

  await page.goto("/");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("result-decoder")).toContainText("Ethereum (decodeEvent)");
  await expect(page.getByTestId("result-chainId")).toContainText("1");
  await expect(page.getByTestId("result-rootBlockNumber")).toContainText("100");
  await expect(page.getByTestId("result-gas-estimate")).toContainText("123456");
  await expect(page.getByTestId("result-evt")).toContainText(ETHEREUM_EVT);
  await expect(page.getByTestId("result-emitter")).toContainText(
    MOCK_ETHEREUM_WITNESS.event.emitter
  );
  await expect(page.getByTestId("result-data")).toContainText(MOCK_ETHEREUM_WITNESS.event.data);
});

test("solana result table renders processed vow and decoded emit_cpi fields", async ({ page }) => {
  await page.route(
    `**/witness/solana/solana:mainnet/${DEFAULT_SOLANA_TX_SIGNATURE}/0`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ready", witness: MOCK_SOLANA_WITNESS }),
      });
    }
  );
  await page.route("https://mock-rpc.example.com", async (route) => {
    const body = JSON.parse((route.request().postData() ?? "{}") as string);
    const request = Array.isArray(body) ? body[0] : body;
    const selector = request?.params?.[0]?.data?.slice(0, 10);
    const response =
      selector === PROCESS_VOW_SELECTOR
        ? {
            id: request.id ?? 1,
            jsonrpc: "2.0",
            result:
              request.method === "eth_estimateGas"
                ? MOCK_PROCESS_VOW_GAS_ESTIMATE
                : MOCK_PROCESS_VOW_SOLANA_RESULT,
          }
        : selector === DECODE_EMIT_CPI_SELECTOR
          ? { id: request.id ?? 1, jsonrpc: "2.0", result: MOCK_DECODE_EMIT_CPI_RESULT }
          : {
              id: request.id ?? 1,
              jsonrpc: "2.0",
              result: buildRpcResult(request.method, request?.params?.[0]?.data),
            };

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });

  await page.goto("/");
  await page.getByLabel("Source Mode").selectOption("solana");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("result-decoder")).toContainText("Solana (decodeEmitCPI)");
  await expect(page.getByTestId("result-rootBlockNumber")).toContainText("200");
  await expect(page.getByTestId("result-evt")).toContainText(SOLANA_EVT);
  await expect(page.getByTestId("result-programId")).toContainText(
    `0x${MOCK_SOLANA_WITNESS.event.programId}`
  );
  await expect(page.getByTestId("result-discriminator")).toContainText(
    `0x${MOCK_SOLANA_WITNESS.event.discriminator}`
  );
  await expect(page.getByTestId("result-data")).toContainText(
    `0x${MOCK_SOLANA_WITNESS.event.data}`
  );
});
