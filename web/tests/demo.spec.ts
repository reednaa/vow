import { expect, test } from "@playwright/test";
import type { WitnessResult } from "../src/lib/types.js";

const MOCK_SIGNER = "0x2222222222222222222222222222222222222222";
const GET_SIGNER_SELECTOR = "0x3ffefe4e";

const MOCK_WITNESS: WitnessResult = {
  signer: MOCK_SIGNER,
  chainId: 1,
  rootBlockNumber: 100,
  proof: [],
  signature:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  event: {
    emitter: "0x1111111111111111111111111111111111111111",
    topics: [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ],
    data: "0xdeadbeef",
  },
};

const MOCK_GET_SIGNER_RESULT =
  `0x${"0".repeat(24)}${MOCK_SIGNER.slice(2).toLowerCase()}`;

const MOCK_PROCESS_VOW_RESULT =
  "0x0000000000000000000000000000000000000000000000000000000000000001" +
  "0000000000000000000000000000000000000000000000000000000000000064" +
  "0000000000000000000000001111111111111111111111111111111111111111" +
  "00000000000000000000000000000000000000000000000000000000000000a0" +
  "00000000000000000000000000000000000000000000000000000000000000e0" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
  "0000000000000000000000000000000000000000000000000000000000000004" +
  "deadbeef00000000000000000000000000000000000000000000000000000000";

function buildEthCallResult(data?: string): string {
  if (data?.startsWith(GET_SIGNER_SELECTOR)) {
    return MOCK_GET_SIGNER_RESULT;
  }
  return MOCK_PROCESS_VOW_RESULT;
}

function buildRpcResponse(body: any) {
  if (Array.isArray(body)) {
    return body.map((entry: any) => ({
      id: entry.id ?? 1,
      jsonrpc: "2.0",
      result: buildEthCallResult(entry?.params?.[0]?.data),
    }));
  }
  return {
    id: body.id ?? 1,
    jsonrpc: "2.0",
    result: buildEthCallResult(body?.params?.[0]?.data),
  };
}

test("page loads with title and form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vow Demo" })).toBeVisible();
  await expect(page.getByPlaceholder("https://witness.example.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
});

test("form validation shows error on empty RPC URL", async ({ page }) => {
  await page.goto("/");

  // Fill enough to pass other checks, leave RPC URL blank
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("validation-error")).toBeVisible();
  await expect(page.getByTestId("validation-error")).toContainText("RPC URL");
});

test("chain and contract fields are hardcoded and disabled", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Chain ID")).toBeDisabled();
  await expect(page.getByLabel("Chain ID")).toHaveValue("1");
  await expect(page.getByLabel("WitnessDirectory")).toBeDisabled();
  await expect(page.getByLabel("WitnessDirectory")).toHaveValue(
    "0x5826BcAc448CA0951789f6EaC3056D07CBf88cF0"
  );
  await expect(page.getByLabel("MockVowLib")).toBeDisabled();
  await expect(page.getByLabel("MockVowLib")).toHaveValue(
    "0xb484F80cCb6Aa6e1e4c698e70B4ccF790b1cF9b9"
  );
});

test("add and remove witness sources", async ({ page }) => {
  await page.goto("/");

  await page.getByText("+ Add witness").click();
  const inputs = page.getByPlaceholder("https://witness.example.com");
  await expect(inputs).toHaveCount(2);

  await page.getByRole("button", { name: "Remove witness source" }).first().click();
  await expect(inputs).toHaveCount(1);
});

test("mock witness flow completes with proof step", async ({ page }) => {
  await page.route("**/witness/eip155:1/100/0", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", witness: MOCK_WITNESS }),
    });
  });

  // Mock the RPC call (eth_call)
  await page.route("https://mock-rpc.example.com", async (route) => {
    const body = JSON.parse((route.request().postData() ?? "{}") as string);
    if (body.method === "eth_call" || Array.isArray(body)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildRpcResponse(body)),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/");

  await page.getByLabel("Block Number").fill("100");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");

  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("proof-results")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("steps")).toBeVisible();
});

test("run fails when witness signer does not match selected on-chain signer index", async ({ page }) => {
  await page.route("**/witness/eip155:1/100/0", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        witness: { ...MOCK_WITNESS, signer: "0x3333333333333333333333333333333333333333" },
      }),
    });
  });

  await page.route("https://mock-rpc.example.com", async (route) => {
    const body = JSON.parse((route.request().postData() ?? "{}") as string);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRpcResponse(body)),
    });
  });

  await page.goto("/");

  await page.getByLabel("Block Number").fill("100");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("run-error")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("run-error")).toContainText("signer validation failure");
});

test("result table renders all fields when mock returns decoded data", async ({ page }) => {
  await page.route("**/witness/eip155:1/100/0", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", witness: MOCK_WITNESS }),
    });
  });

  await page.route("https://mock-rpc.example.com", async (route) => {
    const body = JSON.parse((route.request().postData() ?? "{}") as string);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRpcResponse(body)),
    });
  });

  await page.goto("/");

  await page.getByLabel("Block Number").fill("100");
  await page.fill('input[placeholder="https://rpc.example.com"]', "https://mock-rpc.example.com");
  await page.fill('[placeholder="https://witness.example.com"]', "https://witness.example.com");

  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByTestId("result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("result-chainId")).toContainText("1");
  await expect(page.getByTestId("result-rootBlockNumber")).toContainText("100");
  await expect(page.getByTestId("result-emitter")).toContainText(
    "0x1111111111111111111111111111111111111111"
  );
  await expect(page.getByTestId("result-data")).toContainText("0xdeadbeef");
});
