/** Симуляция обмена в CLMM-пуле, цена пула, отправка транзакций. Без node-зависимостей. */
import { ComputeBudgetProgram, PublicKey, SendOptions, Transaction } from "@solana/web3.js";
import {
  swapInternal,
  getPdaExBitmapAccount,
  TickArrayBitmapExtensionLayout,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { CLMM_PROGRAM_ID } from "./raydium-core";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Цена пула в «tUSDC за 1 tSOL» (mintA = tSOL, mintB = tUSDC). */
export async function poolPrice(raydium: any, poolId: string) {
  const rpc = await raydium.clmm.getRpcClmmPoolInfo({ poolId });
  return { price: rpc.currentPrice as number, tick: rpc.tickCurrent as number, rpc };
}

/**
 * Ожидаемый результат обмена — тем же симулятором, что и в raydium-sdk-V2-demo/src/clmm/swap.ts.
 * zeroForOne=true: mintA → mintB (tSOL → tUSDC); false: tUSDC → tSOL.
 */
export async function simulateSwap(raydium: any, poolId: string, amountIn: BN, zeroForOne: boolean) {
  const { rpcData, configInfo, tickArrays } = await raydium.clmm.getSwapPoolInfo(poolId, zeroForOne);
  const poolPk = new PublicKey(poolId);
  const exBitmap = getPdaExBitmapAccount(CLMM_PROGRAM_ID, poolPk).publicKey;
  const exInfo = await raydium.connection.getAccountInfo(exBitmap);
  const sim = swapInternal({
    programId: CLMM_PROGRAM_ID,
    poolId: poolPk,
    poolInfo: rpcData,
    tickArrays,
    configInfo,
    tickarrayBitmapExtension: TickArrayBitmapExtensionLayout.decode(exInfo!.data),
    amountSpecified: amountIn,
    sqrtPriceLimitX64: new BN(0),
    zeroForOne,
    isBaseInput: true,
    blockTimestamp: Math.floor(Date.now() / 1000),
    includeExtraTickArrays: true,
  });
  const expectedOut = sim.amountCalculated.abs();
  // remaining accounts для swap_v2: bitmap extension + tick arrays по пути обмена
  const seen = new Set<string>();
  const remaining = [
    { pubkey: exBitmap, isWritable: false, isSigner: false },
    ...sim.accounts.map((pubkey: PublicKey) => ({ pubkey, isWritable: true, isSigner: false })),
  ].filter((m) => !seen.has(m.pubkey.toBase58()) && seen.add(m.pubkey.toBase58()));
  return { expectedOut, remaining, sim };
}

export const computeBudget = (units = 600_000) => ComputeBudgetProgram.setComputeUnitLimit({ units });

/** Отправить транзакцию без preflight, чтобы даже неуспешная попала в блокчейн и в Explorer. */
export async function sendRaw(connection: any, payer: any, tx: Transaction, extraSigners: any[] = []) {
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(payer, ...extraSigners);
  const opts: SendOptions = { skipPreflight: true };
  const sig = await connection.sendRawTransaction(tx.serialize(), opts);
  const res = await connection.confirmTransaction(sig, "confirmed");
  return { sig, err: res.value.err };
}
