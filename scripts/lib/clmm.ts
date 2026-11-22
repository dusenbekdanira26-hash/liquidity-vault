/** Позиция vault в CLMM-пуле, обмены vault и трейдера. Без node-зависимостей (скрипты + веб). */
import * as anchor from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  getPdaExBitmapAccount,
  getPdaMetadataKey,
  getPdaPersonalPositionAddress,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
  LiquidityMathUtil,
  TickUtil,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import { CLMM_PROGRAM_ID, txVersion } from "./raydium-core";
import { computeBudget, MEMO_PROGRAM_ID, simulateSwap } from "./swap";

export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const TICKS_PER_ARRAY = 60;

export const tickArrayStart = (tick: number, tickSpacing: number) =>
  Math.floor(tick / (tickSpacing * TICKS_PER_ARRAY)) * tickSpacing * TICKS_PER_ARRAY;

/** Цена «tUSDC за tSOL» -> тик пула (mintA = tSOL 9 знаков, mintB = tUSDC 6 знаков), выровненный по шагу. */
export const priceToTick = (price: number, tickSpacing: number) =>
  TickUtil.toTickIndex(TickUtil.priceToTick(new Decimal(price), 9, 6), tickSpacing);
export const tickToPrice = (tick: number) => TickUtil.tickToPrice(tick, 9, 6).toNumber();


export type Ctx = {
  program: anchor.Program;
  connection: anchor.web3.Connection;
  admin: PublicKey;
  d: Record<string, string>;
  a: { vault: PublicKey; authority: PublicKey; tokenVault: PublicKey };
  s: { strategy: PublicKey; tokenVaultB: PublicKey };
};

/** Аккаунты позиции, общие для collect/close. token_0 = tSOL (mintA), token_1 = tUSDC (mintB). */
export function positionAccounts(c: Ctx, nftMint: PublicKey, tickLower: number, tickUpper: number) {
  const pool = new PublicKey(c.d.poolId);
  const ts = Number(c.d.poolTickSpacing);
  return {
    admin: c.admin,
    vault: c.a.vault,
    strategy: c.s.strategy,
    authority: c.a.authority,
    positionNftMint: nftMint,
    positionNftAccount: getAssociatedTokenAddressSync(nftMint, c.a.authority, true),
    personalPosition: getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey,
    poolState: pool,
    protocolPosition: getPdaProtocolPositionAddress(CLMM_PROGRAM_ID, pool, tickLower, tickUpper).publicKey,
    poolVault0: new PublicKey(c.d.poolVaultA),
    poolVault1: new PublicKey(c.d.poolVaultB),
    tickArrayLower: getPdaTickArrayAddress(CLMM_PROGRAM_ID, pool, tickArrayStart(tickLower, ts)).publicKey,
    tickArrayUpper: getPdaTickArrayAddress(CLMM_PROGRAM_ID, pool, tickArrayStart(tickUpper, ts)).publicKey,
    vaultToken0: c.s.tokenVaultB,
    vaultToken1: c.a.tokenVault,
    mint0: new PublicKey(c.d.tSolMint),
    mint1: new PublicKey(c.d.depositMint),
    clmmProgram: CLMM_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
    tokenProgram2022: TOKEN_2022_PROGRAM_ID,
    memoProgram: MEMO_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

export const exBitmapMeta = (c: Ctx) => [
  {
    pubkey: getPdaExBitmapAccount(CLMM_PROGRAM_ID, new PublicKey(c.d.poolId)).publicKey,
    isWritable: false,
    isSigner: false,
  },
];

export async function vaultBalances(c: Ctx) {
  const sol = Number((await getAccount(c.connection, c.s.tokenVaultB)).amount);
  const usdc = Number((await getAccount(c.connection, c.a.tokenVault)).amount);
  return { sol, usdc };
}

/** Открыть позицию vault: максимум ликвидности из того, что есть в хранилищах. */
export async function openVaultPosition(c: Ctx, raydium: any, priceLow: number, priceHigh: number) {
  const ts = Number(c.d.poolTickSpacing);
  const tickLower = priceToTick(priceLow, ts);
  const tickUpper = priceToTick(priceHigh, ts);
  const rpc = await raydium.clmm.getRpcClmmPoolInfo({ poolId: c.d.poolId });
  const bal = await vaultBalances(c);
  const sqrtCur: BN = rpc.sqrtPriceX64;
  const sqrtLow = TickUtil.getSqrtPriceAtTick(tickLower);
  const sqrtHigh = TickUtil.getSqrtPriceAtTick(tickUpper);
  // 98% балансов — запас на округление внутри Raydium
  const liquidity = LiquidityMathUtil.getLiquidityFromAmounts(
    sqrtCur,
    sqrtLow,
    sqrtHigh,
    new BN(Math.floor(bal.sol * 0.98)),
    new BN(Math.floor(bal.usdc * 0.98))
  );
  const { amountA, amountB } = LiquidityMathUtil.getAmountsForLiquidity(sqrtCur, sqrtLow, sqrtHigh, liquidity, true);
  // максимум, который vault готов отдать: расчёт +1%, но не больше баланса
  const max0 = BN.min(amountA.muln(101).divn(100), new BN(bal.sol));
  const max1 = BN.min(amountB.muln(101).divn(100), new BN(bal.usdc));

  const nft = Keypair.generate();
  const acc = positionAccounts(c, nft.publicKey, tickLower, tickUpper);
  const sig = await c.program.methods
    .openPosition(
      tickLower,
      tickUpper,
      tickArrayStart(tickLower, ts),
      tickArrayStart(tickUpper, ts),
      new anchor.BN(liquidity.toString()),
      new anchor.BN(max0.toString()),
      new anchor.BN(max1.toString())
    )
    .accountsPartial({
      admin: acc.admin,
      vault: acc.vault,
      strategy: acc.strategy,
      authority: acc.authority,
      positionNftMint: nft.publicKey,
      positionNftAccount: acc.positionNftAccount,
      metadataAccount: getPdaMetadataKey(nft.publicKey).publicKey,
      poolState: acc.poolState,
      protocolPosition: acc.protocolPosition,
      tickArrayLower: acc.tickArrayLower,
      tickArrayUpper: acc.tickArrayUpper,
      personalPosition: acc.personalPosition,
      vaultToken0: acc.vaultToken0,
      vaultToken1: acc.vaultToken1,
      poolVault0: acc.poolVault0,
      poolVault1: acc.poolVault1,
      mint0: acc.mint0,
      mint1: acc.mint1,
      clmmProgram: CLMM_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      metadataProgram: METADATA_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
    })
    .remainingAccounts(exBitmapMeta(c))
    .preInstructions([computeBudget()])
    .signers([nft])
    .rpc();
  return {
    sig,
    nftMint: nft.publicKey,
    tickLower,
    tickUpper,
    liquidity,
    put: { sol: bal.sol - (await vaultBalances(c)).sol, usdc: bal.usdc - (await vaultBalances(c)).usdc },
  };
}

/** Прочитать ликвидность позиции из PersonalPositionState (offset 81). */
export async function positionLiquidity(c: Ctx, nftMint: PublicKey): Promise<BN> {
  const info = await c.connection.getAccountInfo(getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nftMint).publicKey);
  return new BN(info!.data.subarray(81, 97), "le");
}

export async function collectFees(c: Ctx, nftMint: PublicKey, tickLower: number, tickUpper: number) {
  const before = await vaultBalances(c);
  const sig = await c.program.methods
    .collectFees()
    .accountsPartial(positionAccounts(c, nftMint, tickLower, tickUpper))
    .remainingAccounts(exBitmapMeta(c))
    .preInstructions([computeBudget()])
    .rpc();
  const after = await vaultBalances(c);
  return { sig, fees: { sol: after.sol - before.sol, usdc: after.usdc - before.usdc } };
}

export async function closeVaultPosition(c: Ctx, raydium: any, nftMint: PublicKey, tickLower: number, tickUpper: number) {
  const liquidity = await positionLiquidity(c, nftMint);
  const rpc = await raydium.clmm.getRpcClmmPoolInfo({ poolId: c.d.poolId });
  const { amountA, amountB } = LiquidityMathUtil.getAmountsForLiquidity(
    rpc.sqrtPriceX64,
    TickUtil.getSqrtPriceAtTick(tickLower),
    TickUtil.getSqrtPriceAtTick(tickUpper),
    liquidity,
    false
  );
  // минимум, который согласны получить: ожидаемое −1%
  const min0 = amountA.muln(99).divn(100);
  const min1 = amountB.muln(99).divn(100);
  const before = await vaultBalances(c);
  const sig = await c.program.methods
    .closePosition(new anchor.BN(min0.toString()), new anchor.BN(min1.toString()))
    .accountsPartial(positionAccounts(c, nftMint, tickLower, tickUpper))
    .remainingAccounts(exBitmapMeta(c))
    .preInstructions([computeBudget()])
    .rpc();
  const after = await vaultBalances(c);
  return {
    sig,
    liquidity,
    expected: { sol: amountA.toNumber(), usdc: amountB.toNumber() },
    min: { sol: min0.toNumber(), usdc: min1.toNumber() },
    got: { sol: after.sol - before.sol, usdc: after.usdc - before.usdc },
  };
}

/** Обмен «трейдера» через SDK Raydium (как raydium-sdk-V2-demo/src/clmm/swap.ts). */
export async function traderSwap(traderRaydium: any, poolId: string, inputIsUsdc: boolean, amountIn: BN) {
  const zeroForOne = !inputIsUsdc; // A=tSOL -> B=tUSDC
  const { poolInfo, poolKeys } = await traderRaydium.clmm.getPoolInfoFromRpc(poolId);
  const { expectedOut, sim } = await simulateSwap(traderRaydium, poolId, amountIn, zeroForOne);
  const { execute } = await traderRaydium.clmm.swap({
    poolInfo,
    poolKeys,
    inputMint: inputIsUsdc ? poolInfo.mintB.address : poolInfo.mintA.address,
    amountIn,
    amountOutMin: expectedOut.muln(98).divn(100),
    observationId: new PublicKey(poolKeys.observationId),
    ownerInfo: { useSOLBalance: false },
    remainingAccounts: sim.accounts,
    txVersion,
    computeBudgetConfig: { units: 600_000, microLamports: 10_000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  return { txId, expectedOut };
}

/** Обмен vault через программу (инструкция swap недели 12). usdcToSol: tUSDC → tSOL. */
export async function vaultSwap(c: Ctx, raydium: any, usdcToSol: boolean, amountIn: BN, slippageBps = 100) {
  const { expectedOut, remaining } = await simulateSwap(raydium, c.d.poolId, amountIn, !usdcToSol);
  const minOut = expectedOut.muln(10_000 - slippageBps).divn(10_000);
  const tUSDC = new PublicKey(c.d.depositMint);
  const tSOL = new PublicKey(c.d.tSolMint);
  const sig = await c.program.methods
    .swap(new anchor.BN(amountIn.toString()), new anchor.BN(minOut.toString()), new anchor.BN(0))
    .accountsPartial({
      admin: c.admin,
      vault: c.a.vault,
      strategy: c.s.strategy,
      authority: c.a.authority,
      inputTokenAccount: usdcToSol ? c.a.tokenVault : c.s.tokenVaultB,
      outputTokenAccount: usdcToSol ? c.s.tokenVaultB : c.a.tokenVault,
      clmmProgram: CLMM_PROGRAM_ID,
      ammConfig: new PublicKey(c.d.poolAmmConfig),
      poolState: new PublicKey(c.d.poolId),
      inputVault: new PublicKey(usdcToSol ? c.d.poolVaultB : c.d.poolVaultA),
      outputVault: new PublicKey(usdcToSol ? c.d.poolVaultA : c.d.poolVaultB),
      observationState: new PublicKey(c.d.poolObservation),
      inputVaultMint: usdcToSol ? tUSDC : tSOL,
      outputVaultMint: usdcToSol ? tSOL : tUSDC,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      memoProgram: MEMO_PROGRAM_ID,
    })
    .remainingAccounts(remaining)
    .preInstructions([computeBudget()])
    .rpc();
  return { sig, expectedOut, minOut };
}

export const fmt = (raw: number, dec: number) => +(raw / 10 ** dec).toFixed(dec === 9 ? 6 : 4);
