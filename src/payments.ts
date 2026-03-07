// src/payments.ts
import * as solanaWeb3 from "@solana/web3.js";
import bs58 from "bs58";
import { measure } from "measure-fn";
import type { ProgressCallback } from './types';

export async function fetchWithPayment(
  url: string,
  options: RequestInit,
  description: string,
  progressCallback?: ProgressCallback,
  solanaWallet?: { privateKey: string; rpcUrl?: string }
): Promise<Response> {
  let retries = 0;
  const maxRetries = 1;

  while (true) {
    const res = await measure(description, () => fetch(url, options));

    if (!res) throw new Error(`${description}: fetch returned null`);
    if (res.ok) return res;

    if (res.status !== 402 || retries >= maxRetries || !solanaWallet) {
      const errorText = await res.text();
      throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const paymentInfo = await res.json() as { amount: number; recipient: string };
    const { amount, recipient } = paymentInfo;

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

    const signature = await measure.assert(
      `Solana tx → ${recipient}`,
      () => connection.sendTransaction(transaction, [fromKeypair])
    );

    await measure.assert(
      `Confirm tx ${signature}`,
      () => connection.confirmTransaction(signature)
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
}
