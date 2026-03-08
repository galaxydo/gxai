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
  solanaWallet?: { privateKey: string; rpcUrl?: string; allowedRecipients?: string[] }
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
}
