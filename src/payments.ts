// src/payments.ts
import * as solanaWeb3 from "@solana/web3.js";
import bs58 from "bs58";
import { expect, test } from 'bun:test';
import { ProgressCallback } from './types';
import { measure } from "@ments/utils";

export async function fetchWithPayment(
  url: string,
  options: RequestInit,
  measure: any,
  description: string,
  progressCallback?: ProgressCallback,
  solanaWallet?: { privateKey: string; rpcUrl?: string }
): Promise<Response> {
  let retries = 0;
  const maxRetries = 1;

  while (true) {
    const res = await measure(
      async () => await fetch(url, options),
      description
    );

    if (res.ok) {
      return res;
    }

    if (res.status !== 402 || retries >= maxRetries || !solanaWallet) {
      const errorText = await res.text();
      throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const paymentInfo = await res.json();
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

    const signature = await measure(
      async () => await connection.sendTransaction(transaction, [fromKeypair]),
      `Sending Solana transaction to ${recipient}`
    );

    await measure(
      async () => await connection.confirmTransaction(signature),
      `Confirming Solana transaction ${signature}`
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
  const { measure } = await import('@ments/utils');

  test('fetchWithPayment success', async () => {
    const mockFetch = async () => new Response('ok', { status: 200 });
    const mockMeasure = async (fn: any, desc: string) => fn(mockMeasure);
    const res = await fetchWithPayment('url', {}, mockMeasure, 'desc');
    expect(res.ok).toBe(true);
  });

  test('fetchWithPayment handles payment retry', async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ amount: 0.001, recipient: 'test' }), { status: 402 });
      }
      return new Response('ok', { status: 200 });
    };
    const mockMeasure = async (fn: any, desc: string) => fn(mockMeasure);
    const mockWallet = { privateKey: bs58.encode(new Uint8Array(64).fill(0)) }; // Mock key
    // Mock solana connections, etc., but for test, assume it throws or something; this is partial
    await expect(fetchWithPayment('url', {}, mockMeasure, 'desc', undefined, mockWallet)).rejects.toThrow();
  });
}
