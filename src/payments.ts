// src/payments.ts
import * as solanaWeb3 from "@solana/web3.js";
import bs58 from "bs58";
import { measure } from "measure-fn";
import type { ProgressCallback } from './types';

const wsConnections = new Map<string, { ws: WebSocket, pending: Map<string, { resolve: (val: Response) => void, reject: (err: any) => void }> }>();

async function multiplexWebSocketRequest(url: string, options: RequestInit): Promise<Response> {
  const parsedUrl = new URL(url);
  const baseWsUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const path = parsedUrl.pathname + parsedUrl.search;

  if (!wsConnections.has(baseWsUrl)) {
    const ws = new WebSocket(baseWsUrl);
    const pending = new Map<string, { resolve: (val: Response) => void, reject: (err: any) => void }>();

    ws.onmessage = (event) => {
      try {
        const res = JSON.parse(event.data);
        if (res.id && pending.has(res.id)) {
          const { resolve } = pending.get(res.id)!;
          pending.delete(res.id);
          // Reconstruct a standard Response object from the WS payload
          const mockResponse = new Response(typeof res.body === 'string' ? res.body : JSON.stringify(res.body), {
            status: res.status || 200,
            statusText: res.statusText || 'OK'
          });
          resolve(mockResponse);
        }
      } catch (err) {
        console.error('Failed to parse WS MCP message', err);
      }
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error(`WebSocket connection failed for ${baseWsUrl}`));
    });

    wsConnections.set(baseWsUrl, { ws, pending });
  }

  const { ws, pending } = wsConnections.get(baseWsUrl)!;
  const requestId = Math.random().toString(36).substring(2, 11);

  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });

    ws.send(JSON.stringify({
      id: requestId,
      method: options.method || 'GET',
      path: path,
      body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body,
      headers: options.headers,
    }));
  });
}

export async function fetchWithPayment(
  url: string,
  options: RequestInit,
  description: string,
  progressCallback?: ProgressCallback,
  solanaWallet?: { privateKey: string; rpcUrl?: string; allowedRecipients?: string[] }
): Promise<Response> {
  let retries = 0;
  const maxRetries = 1;

  while (true) {
    const isWebSocket = url.startsWith('ws://') || url.startsWith('wss://');

    const res = await measure(description, () =>
      isWebSocket ? multiplexWebSocketRequest(url, options) : fetch(url, options)
    );

    if (!res) throw new Error(`${description}: fetch returned null`);
    if (res.ok) return res;

    if (res.status !== 402 || retries >= maxRetries || !solanaWallet) {
      const errorText = await res.text();
      throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const paymentInfo = await res.json() as { amount: number; recipient: string };
    const { amount, recipient } = paymentInfo;

    if (solanaWallet.allowedRecipients && solanaWallet.allowedRecipients.length > 0) {
      if (!solanaWallet.allowedRecipients.includes(recipient)) {
        throw new Error(`Security Error: Payment requested by an unregistered recipient address (${recipient}).`);
      }
    }

    progressCallback?.({
      stage: "payment",
      message: `Processing payment of ${amount} SOL to ${recipient}...`,
    });

    const lamports = Math.floor(amount * 1_000_000_000);
    const privateKeyBytes = bs58.decode(solanaWallet.privateKey);
    const fromKeypair = solanaWeb3.Keypair.fromSecretKey(privateKeyBytes);
    const toPubkey = new solanaWeb3.PublicKey(recipient);

    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports,
      })
    );

    const rpcUrl = solanaWallet.rpcUrl || "https://api.mainnet-beta.solana.com";
    const connection = new solanaWeb3.Connection(rpcUrl, "confirmed");

    const signature = await measure.retry(
      `Solana tx → ${recipient}`,
      { attempts: 3, delay: 2000, backoff: 2 },
      async () => {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fromKeypair.publicKey;

        const sig = await connection.sendTransaction(transaction, [fromKeypair]);
        const confirmation = await connection.confirmTransaction({
          signature: sig,
          blockhash,
          lastValidBlockHeight
        });

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }
        return sig;
      }
    );

    progressCallback?.({
      stage: "payment",
      message: `Payment confirmed. Retrying request...`,
    });

    retries++;
  }
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('fetchWithPayment success', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('ok', { status: 200 }) as any) as any;
    try {
      const res = await fetchWithPayment('https://example.com', {}, 'test fetch');
      expect(res.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchWithPayment throws on non-402 error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('Not Found', { status: 404 }) as any) as any;
    try {
      await expect(fetchWithPayment('https://example.com', {}, 'test fetch')).rejects.toThrow('404');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchWithPayment rejects unregistered 402 recipient spoofing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ amount: 0.1, recipient: "EVIL_ADDRESS" }), { status: 402 }) as any) as any;
    try {
      await expect(
        fetchWithPayment('https://example.com', {}, 'test fetch', undefined, {
          privateKey: "dummy",
          allowedRecipients: ["GOOD_ADDRESS"]
        })
      ).rejects.toThrow(/Security Error: Payment requested by an unregistered recipient address/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  test('fetchWithPayment websocket multiplexing', async () => {
    // We can't easily mock native `WebSocket` comprehensively in a short test without overriding it,
    // so we will create a mock WebSocket class and inject it into globalThis.
    const originalWebSocket = globalThis.WebSocket;
    let sentPayload: any = null;

    class MockWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;

      constructor(public url: string) {
        setTimeout(() => this.onopen?.(), 10);
      }

      send(data: string) {
        sentPayload = JSON.parse(data);
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              id: sentPayload.id,
              status: 200,
              body: { tools: ["t1", "t2"] }
            })
          });
        }, 10);
      }
    }

    (globalThis as any).WebSocket = MockWebSocket;
    try {
      const res = await fetchWithPayment('ws://example.com/api', { method: 'GET' }, 'ws fetch');
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({ tools: ["t1", "t2"] });
      expect(sentPayload.path).toBe('/api');
      expect(sentPayload.method).toBe('GET');
    } finally {
      globalThis.WebSocket = originalWebSocket;
      wsConnections.clear(); // Cleanup the pool
    }
  });
}
