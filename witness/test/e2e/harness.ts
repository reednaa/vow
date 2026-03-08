import { Instance, Server } from "prool";

const TEST_ANVIL_PORT = 18545;
export const TEST_RPC_URL = `http://127.0.0.1:${TEST_ANVIL_PORT}/1`;
export const TEST_CHAIN_ID = 31337;

export const anvilServer = Server.create({
  instance: Instance.anvil({
    loadState: new URL("./anvil.state", import.meta.url).pathname,
    chainId: TEST_CHAIN_ID,
  } as any),
  port: TEST_ANVIL_PORT,
});

export async function startAnvil() {
  try {
    await anvilServer.start();
  } catch (error) {
    throw new Error(
      `Failed to start test anvil server on port ${TEST_ANVIL_PORT}: ${(error as Error).message}`
    );
  }
}

export async function stopAnvil() {
  await anvilServer.stop();
}
