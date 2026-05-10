import { context, trace, metrics, SpanStatusCode, type Context } from "@opentelemetry/api";
import type { RpcClient } from "./client.ts";
import type { SolanaRpcClient } from "./solana-client.ts";

type RpcMethod = "getBlock" | "getLogs" | "getBlockNumber";
type SolanaRpcMethod = "getSlot" | "getBlock" | "getTransaction";

export function instrumentRpcClient(
  client: RpcClient,
  attrs: { url: string; chainId: number },
  parentContext?: Context
): RpcClient {
  const tracer = trace.getTracer("vow-witness");
  const meter = metrics.getMeter("vow-witness");
  const durationHistogram = meter.createHistogram("vow.rpc.duration", {
    description: "RPC call duration in milliseconds",
    unit: "ms",
  });
  const errorsCounter = meter.createCounter("vow.rpc.errors", {
    description: "RPC call error count",
  });

  function wrapMethod<T extends (...args: any[]) => Promise<any>>(
    method: T,
    name: RpcMethod,
    commonAttrs: { "rpc.url": string; "chain.id": number }
  ): T {
    return (async (...args: any[]) => {
      const spanAttrs = { "rpc.method": name, ...commonAttrs };
      const start = Date.now();
      const span = tracer.startSpan(
        `rpc.${name}`,
        { attributes: spanAttrs },
        parentContext ?? context.active()
      );

      try {
        const result = await method(...args);
        durationHistogram.record(Date.now() - start, spanAttrs);
        return result;
      } catch (err: any) {
        durationHistogram.record(Date.now() - start, spanAttrs);
        errorsCounter.add(1, { ...spanAttrs, "error.type": err?.constructor?.name ?? "Error" });
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    }) as T;
  }

  const commonAttrs = { "rpc.url": attrs.url, "chain.id": attrs.chainId };
  return {
    getBlock: wrapMethod(client.getBlock.bind(client), "getBlock", commonAttrs),
    getLogs: wrapMethod(client.getLogs.bind(client), "getLogs", commonAttrs),
    getBlockNumber: wrapMethod(client.getBlockNumber.bind(client), "getBlockNumber", commonAttrs),
  };
}

export function instrumentSolanaRpcClient(
  client: SolanaRpcClient,
  attrs: { url: string; chainId: number },
  parentContext?: Context,
): SolanaRpcClient {
  const tracer = trace.getTracer("vow-witness");
  const meter = metrics.getMeter("vow-witness");
  const durationHistogram = meter.createHistogram("vow.solana.rpc.duration", {
    description: "Solana RPC call duration in milliseconds",
    unit: "ms",
  });
  const errorsCounter = meter.createCounter("vow.solana.rpc.errors", {
    description: "Solana RPC call error count",
  });

  function wrapMethod<T extends (...args: any[]) => Promise<any>>(
    method: T,
    name: SolanaRpcMethod,
    commonAttrs: { "rpc.url": string; "chain.id": number },
  ): T {
    return (async (...args: any[]) => {
      const spanAttrs = { "rpc.method": name, ...commonAttrs };
      const start = Date.now();
      const span = tracer.startSpan(
        `solana.rpc.${name}`,
        { attributes: spanAttrs },
        parentContext ?? context.active(),
      );

      try {
        const result = await method(...args);
        durationHistogram.record(Date.now() - start, spanAttrs);
        return result;
      } catch (err: any) {
        durationHistogram.record(Date.now() - start, spanAttrs);
        errorsCounter.add(1, {
          ...spanAttrs,
          "error.type": err?.constructor?.name ?? "Error",
        });
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    }) as T;
  }

  const commonAttrs = { "rpc.url": attrs.url, "chain.id": attrs.chainId };
  return {
    getSlot: wrapMethod(client.getSlot.bind(client), "getSlot", commonAttrs),
    getBlock: wrapMethod(client.getBlock.bind(client), "getBlock", commonAttrs),
    getTransaction: wrapMethod(client.getTransaction.bind(client), "getTransaction", commonAttrs),
  };
}
