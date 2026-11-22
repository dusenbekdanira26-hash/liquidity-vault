/**
 * Неделя 13: vault — провайдер ликвидности в CLMM-пуле Raydium.
 *  A) открыть позицию ±5% → обмены с другого кошелька → собрать комиссии → закрыть
 *  B) ребалансировка: позиция ±3% → цену выталкиваем за диапазон → закрыть →
 *     обменять часть tUSDC на tSOL → открыть новую позицию вокруг новой цены
 *  C) подготовка к выводу (упрощение учебной версии): закрыть позицию, tSOL → tUSDC
 * Запуск: yarn week13
 */
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import BN from "bn.js";
import { explorer, getProgram, pdas, readDeployments, saveDeployments } from "./common";
import { initRaydium } from "./raydium";
import { poolPrice, strategyPdas } from "./strategy";
import {
  closeVaultPosition,
  collectFees,
  Ctx,
  fmt,
  loadOrCreateTrader,
  openVaultPosition,
  tickToPrice,
  traderSwap,
  vaultBalances,
  vaultSwap,
} from "./position";

const log: any[] = [];
const step = (name: string, data: any) => {
  log.push({ step: name, ...data });
  console.log(`\n== ${name}`, JSON.stringify(data, null, 1));
};

async function main() {
  const { connection, wallet, program } = getProgram();
  const { raydium } = await initRaydium();
  const d = readDeployments();
  const depositMint = new PublicKey(d.depositMint);
  const tSOL = new PublicKey(d.tSolMint);
  const a = pdas(program.programId, depositMint);
  const s = strategyPdas(program.programId, a.vault);
  const c: Ctx = { program, connection, admin: wallet.publicKey, d, a, s };
  const price = async () => (await poolPrice(raydium, d.poolId)).price;
  const bal = async () => {
    const b = await vaultBalances(c);
    return { tSOL: fmt(b.sol, 9), tUSDC: fmt(b.usdc, 6) };
  };

  // 0. Подготовка: SOL для PDA authority (платит rent за аккаунты позиции) и трейдер
  const authBal = await connection.getBalance(a.authority);
  if (authBal < 0.1 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: a.authority, lamports: 0.2 * LAMPORTS_PER_SOL })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    step("пополнение PDA authority 0.2 SOL", { tx: explorer("tx", sig) });
  }
  const trader = loadOrCreateTrader();
  d.trader = trader.publicKey.toBase58();
  if ((await connection.getBalance(trader.publicKey)) < 0.05 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: trader.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL })
    );
    await sendAndConfirmTransaction(connection, tx, [wallet.payer]);
    const tu = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, depositMint, trader.publicKey);
    const ts = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, tSOL, trader.publicKey);
    await mintTo(connection, wallet.payer, depositMint, tu.address, wallet.payer, 20_000n * 10n ** 6n);
    await mintTo(connection, wallet.payer, tSOL, ts.address, wallet.payer, 100n * 10n ** 9n);
    step("трейдер создан и пополнен", { trader: d.trader, tokens: "20000 tUSDC + 100 tSOL" });
  }
  const { raydium: traderRay } = await initRaydium(trader);

  // ---------------- A. открыть → обмены → комиссии → закрыть ----------------
  let p = await price();
  // Возобновление после сбоя: шаги прошлого запуска сохранены в week13Partial.
  const prev: any[] = d.week13Partial ? JSON.parse(d.week13Partial) : [];
  const stNow: any = await (program.account as any).strategy.fetch(s.strategy);
  const doneB3 = prev.some((e) => e.step.startsWith("B3")) && stNow.positionNftMint.equals(PublicKey.default);
  if (doneB3) {
    log.push(...prev);
    console.log("Продолжаем после шага B3");
  } else {
  // Возобновление: если позиция уже открыта прошлым запуском — продолжаем с неё.
  const st: any = await (program.account as any).strategy.fetch(s.strategy);
  let p1: { nftMint: PublicKey; tickLower: number; tickUpper: number };
  if (!st.positionNftMint.equals(PublicKey.default) && d.week13Partial) {
    log.push(...JSON.parse(d.week13Partial).filter((e: any) => /^A[01]|пополнение|трейдер/.test(e.step)));
    p1 = { nftMint: st.positionNftMint, tickLower: st.tickLower, tickUpper: st.tickUpper };
    console.log("Продолжаем с уже открытой позиции", p1.nftMint.toBase58());
  } else {
    step("A0. старт", { price: +p.toFixed(4), vault: await bal() });
    const o = await openVaultPosition(c, raydium, p * 0.95, p * 1.05);
    p1 = o;
    step("A1. открыть позицию ±5%", {
      tx: explorer("tx", o.sig),
      nft: o.nftMint.toBase58(),
      ticks: [o.tickLower, o.tickUpper],
      range: [+tickToPrice(o.tickLower).toFixed(4), +tickToPrice(o.tickUpper).toFixed(4)],
      vaultPut: { tSOL: fmt(o.put.sol, 9), tUSDC: fmt(o.put.usdc, 6) },
      vaultLeft: await bal(),
    });
  }

  const swaps: string[] = [];
  for (let i = 0; i < 3; i++) {
    swaps.push((await traderSwap(traderRay, d.poolId, true, new BN(200 * 1e6))).txId); // купить tSOL
    swaps.push((await traderSwap(traderRay, d.poolId, false, new BN(2 * 1e9))).txId); // продать tSOL
  }
  p = await price();
  step("A2. 6 обменов трейдера (3× 200 tUSDC → tSOL, 3× 2 tSOL → tUSDC)", {
    txs: swaps.map((t) => explorer("tx", t)),
    price: +p.toFixed(4),
  });

  const f1 = await collectFees(c, p1.nftMint, p1.tickLower, p1.tickUpper);
  step("A3. собрать комиссии", {
    tx: explorer("tx", f1.sig),
    fees: { tSOL: fmt(f1.fees.sol, 9), tUSDC: fmt(f1.fees.usdc, 6) },
  });

  const c1 = await closeVaultPosition(c, raydium, p1.nftMint, p1.tickLower, p1.tickUpper);
  step("A4. закрыть позицию", {
    tx: explorer("tx", c1.sig),
    liquidity: c1.liquidity.toString(),
    min: { tSOL: fmt(c1.min.sol, 9), tUSDC: fmt(c1.min.usdc, 6) },
    returned: { tSOL: fmt(c1.got.sol, 9), tUSDC: fmt(c1.got.usdc, 6) },
    vault: await bal(),
  });

  // ---------------- B. ребалансировка ----------------
  p = await price();
  const p2 = await openVaultPosition(c, raydium, p * 0.97, p * 1.03);
  const upper2 = tickToPrice(p2.tickUpper);
  step("B1. открыть позицию ±3%", {
    tx: explorer("tx", p2.sig),
    nft: p2.nftMint.toBase58(),
    range: [+tickToPrice(p2.tickLower).toFixed(4), +upper2.toFixed(4)],
    price: +p.toFixed(4),
  });

  const push: string[] = [];
  for (let i = 0; i < 15 && (await price()) <= upper2 * 1.003; i++) {
    push.push((await traderSwap(traderRay, d.poolId, true, new BN(250 * 1e6))).txId);
  }
  p = await price();
  step("B2. трейдер выталкивает цену выше диапазона", {
    txs: push.map((t) => explorer("tx", t)),
    price: +p.toFixed(4),
    upper: +upper2.toFixed(4),
    outOfRange: p > upper2,
  });

  const c2 = await closeVaultPosition(c, raydium, p2.nftMint, p2.tickLower, p2.tickUpper);
  step("B3. закрыть позицию вне диапазона (в ней остался только tUSDC)", {
    tx: explorer("tx", c2.sig),
    returned: { tSOL: fmt(c2.got.sol, 9), tUSDC: fmt(c2.got.usdc, 6) },
    vault: await bal(),
  });
  } // конец блока A..B3

  // привести пропорцию: часть tUSDC — в tSOL. Выше 109.9 в пуле ликвидности нет,
  // поэтому обмен ограничен 150 tUSDC (иначе Raydium: LiquidityInsufficient).
  p = await price();
  const b = await vaultBalances(c);
  const usdcValue = b.usdc + (b.sol / 1e9) * p * 1e6;
  const needUsdcToSwap = Math.min(150e6, Math.max(0, Math.floor(usdcValue / 2 - (b.sol / 1e9) * p * 1e6)));
  const sw = await vaultSwap(c, raydium, true, new BN(needUsdcToSwap));
  step("B4. vault меняет часть tUSDC на tSOL (пропорция для новой позиции)", {
    tx: explorer("tx", sw.sig),
    swapIn: fmt(needUsdcToSwap, 6),
    vault: await bal(),
  });

  p = await price();
  const p3 = await openVaultPosition(c, raydium, p * 0.95, p * 1.05);
  step("B5. новая позиция ±5% вокруг новой цены", {
    tx: explorer("tx", p3.sig),
    nft: p3.nftMint.toBase58(),
    price: +p.toFixed(4),
    range: [+tickToPrice(p3.tickLower).toFixed(4), +tickToPrice(p3.tickUpper).toFixed(4)],
    vaultPut: { tSOL: fmt(p3.put.sol, 9), tUSDC: fmt(p3.put.usdc, 6) },
  });

  // ---------------- C. подготовка к выводу ----------------
  const c3 = await closeVaultPosition(c, raydium, p3.nftMint, p3.tickLower, p3.tickUpper);
  const solLeft = (await vaultBalances(c)).sol;
  const back = solLeft > 0 ? await vaultSwap(c, raydium, false, new BN(solLeft)) : undefined;
  step("C. закрыть позицию и обменять tSOL обратно в tUSDC", {
    close: explorer("tx", c3.sig),
    swapBack: back ? explorer("tx", back.sig) : null,
    vault: await bal(),
    price: +(await price()).toFixed(4),
  });

  d.week13 = JSON.stringify(log);
  delete d.week13Partial;
  saveDeployments(d);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  if (log.length) {
    const d = readDeployments();
    d.week13Partial = JSON.stringify(log);
    saveDeployments(d);
  }
  process.exit(1);
});
