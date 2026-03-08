import { expect, test } from "@playwright/test";
import type { WitnessResult } from "../src/lib/types.js";

const MOCK_WITNESS: WitnessResult = {
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

const MOCK_VOW_RESULT = {
  chainId: "1",
  rootBlockNumber: "100",
  emitter: "0x1111111111111111111111111111111111111111",
  topics: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  data: "0xdeadbeef",
};

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
        body: JSON.stringify({
          id: body.id,
          jsonrpc: "2.0",
          // ABI-encode: (uint256 1, uint256 100, address 0x111...111, bytes32[] [...], bytes 0xdeadbeef)
          // We'll return a minimal mock that viem can decode
          result:
            "0x0000000000000000000000000000000000000000000000000000000000000001" + // chainId = 1
            "0000000000000000000000000000000000000000000000000000000000000064" + // rootBlockNumber = 100
            "0000000000000000000000001111111111111111111111111111111111111111" + // emitter
            "00000000000000000000000000000000000000000000000000000000000000a0" + // topics offset
            "00000000000000000000000000000000000000000000000000000000000000e0" + // data offset
            "0000000000000000000000000000000000000000000000000000000000000001" + // topics.length = 1
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + // topics[0]
            "0000000000000000000000000000000000000000000000000000000000000004" + // data.length = 4
            "deadbeef00000000000000000000000000000000000000000000000000000000", // data
        }),
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
      body: JSON.stringify({
        id: body.id ?? 1,
        jsonrpc: "2.0",
        result:
          "0x0000000000000000000000000000000000000000000000000000000000000001" +
          "0000000000000000000000000000000000000000000000000000000000000064" +
          "0000000000000000000000001111111111111111111111111111111111111111" +
          "00000000000000000000000000000000000000000000000000000000000000a0" +
          "00000000000000000000000000000000000000000000000000000000000000e0" +
          "0000000000000000000000000000000000000000000000000000000000000001" +
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
          "0000000000000000000000000000000000000000000000000000000000000004" +
          "deadbeef00000000000000000000000000000000000000000000000000000000",
      }),
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
