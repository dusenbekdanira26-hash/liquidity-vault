/**
 * Неделя 11: свои тестовые токены и свой CLMM-пул Raydium в devnet.
 *  1) tUSDC — токен vault с недели 8 (6 знаков), tSOL — новый тестовый токен (9 знаков)
 *  2) CLMM-пул tSOL/tUSDC, fee 0.25%, tickSpacing 60, начальная цена 1 tSOL = 100 tUSDC
 *  3) позиция со своего кошелька в диапазоне 90–110 tUSDC за tSOL (±10% от цены)
 * Запуск: yarn week11
 */
import { PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { LiquidityMathUtil, TickUtil, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import { explorer, readDeployments, saveDeployments } from "./common";
import { CLMM_PROGRAM_ID, initRaydium, tokenInfo, txVersion } from "./raydium";

const INITIAL_PRICE = 100; // tUSDC за 1 tSOL
const RANGE = [90, 110]; // диапазон позиции, tUSDC за 1 tSOL
const POSITION_TSOL = 10; // сколько tSOL кладём в позицию (tUSDC — по пропорции)

async function main() {
  const { raydium, owner, connection } = await initRaydium();
  const d = readDeployments();
  const tUSDC = new PublicKey(d.depositMint);

  // 1. Второй тестовый токен
  if (!d.tSolMint) {
    const m = await createMint(connection, owner, owner.publicKey, null, 9);
    d.tSolMint = m.toBase58();
    saveDeployments(d);
    console.log("tSOL создан:", explorer("address", d.tSolMint));
  }
  const tSOL = new PublicKey(d.tSolMint);
  if (!d.week11Minted) {
    const ataSol = await getOrCreateAssociatedTokenAccount(connection, owner, tSOL, owner.publicKey);
    const ataUsdc = await getOrCreateAssociatedTokenAccount(connection, owner, tUSDC, owner.publicKey);
    await mintTo(connection, owner, tSOL, ataSol.address, owner, 1_000n * 10n ** 9n);
    await mintTo(connection, owner, tUSDC, ataUsdc.address, owner, 100_000n * 10n ** 6n);
    d.week11Minted = "1000 tSOL + 100000 tUSDC";
    saveDeployments(d);
    console.log("Выпущено себе:", d.week11Minted);
  }

  // 2. CLMM-пул
  if (!d.poolId) {
    const configs = await raydium.api.getClmmConfigs();
    const cfg = configs.find((c) => c.tickSpacing === 60) ?? configs[0];
    console.log("CLMM config:", cfg.id, "fee", cfg.tradeFeeRate / 1e4, "% tickSpacing", cfg.tickSpacing);
    const { execute, extInfo } = await raydium.clmm.createPool({
      programId: CLMM_PROGRAM_ID,
      mint1: tokenInfo(tSOL, "tSOL", 9) as any,
      mint2: tokenInfo(tUSDC, "tUSDC", 6) as any,
      ammConfig: { ...cfg, id: new PublicKey(cfg.id), fundOwner: "", description: "" } as any,
      initialPrice: new Decimal(INITIAL_PRICE), // цена mint1 (tSOL) в mint2 (tUSDC)
      txVersion,
    });
    const { txId } = await execute({ sendAndConfirm: true });
    d.poolId = extInfo.address.id.toString();
    d.txCreatePool = txId;
    saveDeployments(d);
    console.log("Пул создан:", explorer("address", d.poolId), "\n  tx:", explorer("tx", txId));
  }

  // 3. Позиция в диапазоне вокруг текущей цены
  const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(d.poolId);
  const aIsSol = poolInfo.mintA.address === tSOL.toBase58();
  // В Raydium цена = mintB за 1 mintA. Переводим наш диапазон «tUSDC за tSOL» в эти единицы.
  const [pLow, pHigh] = aIsSol ? RANGE : [1 / RANGE[1], 1 / RANGE[0]];
  console.log(`mintA=${poolInfo.mintA.symbol || (aIsSol ? "tSOL" : "tUSDC")}, цена пула (B за A) = ${poolInfo.price}`);

  if (!d.positionNftMint) {
    const ts = poolInfo.config.tickSpacing;
    const decA = poolInfo.mintA.decimals;
    const decB = poolInfo.mintB.decimals;
    const tickLower = TickUtil.toTickIndex(TickUtil.priceToTick(new Decimal(pLow), decA, decB), ts);
    const tickUpper = TickUtil.toTickIndex(TickUtil.priceToTick(new Decimal(pHigh), decA, decB), ts);

    const sqrtCur = TickUtil.priceToSqrtPriceX64(new Decimal(poolInfo.price), decA, decB);
    const sqrtLow = TickUtil.getSqrtPriceAtTick(tickLower);
    const sqrtHigh = TickUtil.getSqrtPriceAtTick(tickUpper);

    // базовый токен — tSOL (10 штук), второй рассчитывается по формуле CLMM
    const base: "MintA" | "MintB" = aIsSol ? "MintA" : "MintB";
    const baseAmount = new BN(POSITION_TSOL).mul(new BN(10).pow(new BN(9)));
    const { liquidity } = LiquidityMathUtil.getLiquidityAndAmountsFromAmount({
      sqrtPriceCurrentX64: sqrtCur,
      sqrtPriceLowerX64: sqrtLow,
      sqrtPriceUpperX64: sqrtHigh,
      amountInfo: { type: aIsSol ? "amountA" : "amountB", amount: baseAmount },
    } as any);
    const { amountA, amountB } = LiquidityMathUtil.getAmountsForLiquidity(sqrtCur, sqrtLow, sqrtHigh, liquidity, true);
    const other = aIsSol ? amountB : amountA;
    const otherAmountMax = other.muln(10_100).divn(10_000); // +1% запаса

    const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
      poolInfo,
      poolKeys,
      tickLower: Math.min(tickLower, tickUpper),
      tickUpper: Math.max(tickLower, tickUpper),
      base,
      ownerInfo: { useSOLBalance: true },
      baseAmount,
      otherAmountMax,
      nft2022: true,
      txVersion,
      computeBudgetConfig: { units: 600_000, microLamports: 100_000 },
    });
    const { txId } = await execute({ sendAndConfirm: true });
    d.positionNftMint = extInfo.nftMint.toBase58();
    d.txOpenPosition = txId;
    d.positionTicks = `${Math.min(tickLower, tickUpper)}..${Math.max(tickLower, tickUpper)}`;
    saveDeployments(d);
    console.log("Позиция открыта, NFT:", explorer("address", d.positionNftMint), "\n  tx:", explorer("tx", txId));
    console.log("  tick:", d.positionTicks, " amountA:", amountA.toString(), " amountB:", amountB.toString());
  }

  // 4. Адреса пула для недель 12–13
  const k: any = poolKeys;
  const rpc = await raydium.clmm.getRpcClmmPoolInfo({ poolId: d.poolId });
  const exBitmap = getPdaExBitmapAccount(CLMM_PROGRAM_ID, new PublicKey(d.poolId)).publicKey;
  Object.assign(d, {
    clmmProgramId: CLMM_PROGRAM_ID.toBase58(),
    poolAmmConfig: k.config.id,
    poolMintA: k.mintA.address,
    poolMintB: k.mintB.address,
    poolVaultA: k.vault.A,
    poolVaultB: k.vault.B,
    poolObservation: k.observationId,
    poolExBitmap: exBitmap.toBase58(),
    poolTickSpacing: String(poolInfo.config.tickSpacing),
  });
  saveDeployments(d);
  const human = aIsSol ? rpc.currentPrice : 1 / rpc.currentPrice;
  console.log("\nТекущая цена пула:", human.toFixed(4), "tUSDC за 1 tSOL (tick", rpc.tickCurrent, ")");
  for (const key of ["poolId", "poolAmmConfig", "poolVaultA", "poolVaultB", "poolObservation", "poolExBitmap", "positionNftMint", "tSolMint"]) {
    console.log(`${key.padEnd(16)} ${explorer("address", d[key])}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
