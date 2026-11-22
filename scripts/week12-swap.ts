/**
 * Неделя 12: vault меняет часть tUSDC на tSOL через наш CLMM-пул Raydium (CPI swap_v2).
 *  1) init_strategy: привязать vault к пулу, создать второе хранилище (tSOL)
 *  2) ожидаемая сумма — симулятор Raydium SDK, минимум = ожидаемое − 1%
 *  3) успешный обмен 300 tUSDC → tSOL
 *  4) обмен с завышенным минимумом — Raydium отклоняет его (slippage)
 * Запуск: yarn week12
 */
import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { getAccount, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { explorer, getProgram, pdas, readDeployments, saveDeployments } from "./common";
import { initRaydium } from "./raydium";
import { computeBudget, MEMO_PROGRAM_ID, poolPrice, sendRaw, simulateSwap, strategyPdas } from "./strategy";

const SWAP_TUSDC = 300;
const SLIPPAGE_BPS = 100; // 1%

async function main() {
  const { connection, wallet, program } = getProgram();
  const { raydium } = await initRaydium();
  const d = readDeployments();
  const depositMint = new PublicKey(d.depositMint);
  const tSOL = new PublicKey(d.tSolMint);
  const a = pdas(program.programId, depositMint);
  const s = strategyPdas(program.programId, a.vault);
  const pool = new PublicKey(d.poolId);

  // 1. Стратегия
  if (!(await connection.getAccountInfo(s.strategy))) {
    const sig = await program.methods
      .initStrategy()
      .accountsPartial({
        admin: wallet.publicKey,
        vault: a.vault,
        authority: a.authority,
        strategy: s.strategy,
        poolState: pool,
        otherMint: tSOL,
        tokenVaultB: s.tokenVaultB,
      })
      .rpc();
    d.txInitStrategy = sig;
    console.log("init_strategy:", explorer("tx", sig));
  }
  d.strategy = s.strategy.toBase58();
  d.tokenVaultB = s.tokenVaultB.toBase58();
  saveDeployments(d);

  const balances = async (label: string) => {
    const usdc = Number((await getAccount(connection, a.tokenVault)).amount) / 1e6;
    const sol = Number((await getAccount(connection, s.tokenVaultB)).amount) / 1e9;
    const { price, tick } = await poolPrice(raydium, d.poolId);
    console.log(`${label.padEnd(22)} vault: ${usdc} tUSDC, ${sol} tSOL | цена пула ${price.toFixed(4)} (tick ${tick})`);
    return { usdc, sol, price, tick };
  };

  // tUSDC (mintB) -> tSOL (mintA): zeroForOne = false
  const buildSwap = (amountIn: BN, minOut: BN, remaining: any[]) =>
    program.methods
      .swap(new anchor.BN(amountIn.toString()), new anchor.BN(minOut.toString()), new anchor.BN(0))
      .accountsPartial({
        admin: wallet.publicKey,
        vault: a.vault,
        strategy: s.strategy,
        authority: a.authority,
        inputTokenAccount: a.tokenVault,
        outputTokenAccount: s.tokenVaultB,
        clmmProgram: new PublicKey(d.clmmProgramId),
        ammConfig: new PublicKey(d.poolAmmConfig),
        poolState: pool,
        inputVault: new PublicKey(d.poolVaultB),
        outputVault: new PublicKey(d.poolVaultA),
        observationState: new PublicKey(d.poolObservation),
        inputVaultMint: depositMint,
        outputVaultMint: tSOL,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_2022_PROGRAM_ID,
        memoProgram: MEMO_PROGRAM_ID,
      })
      .remainingAccounts(remaining)
      .preInstructions([computeBudget()]);

  const before = await balances("до обмена");
  const amountIn = new BN(SWAP_TUSDC * 1e6);

  // 2–3. Успешный обмен
  const { expectedOut, remaining } = await simulateSwap(raydium, d.poolId, amountIn, false);
  const minOut = expectedOut.muln(10_000 - SLIPPAGE_BPS).divn(10_000);
  console.log(`ожидаем ${expectedOut.toNumber() / 1e9} tSOL, минимум (−1%) ${minOut.toNumber() / 1e9} tSOL`);
  const sigOk = await buildSwap(amountIn, minOut, remaining).rpc();
  console.log("swap OK:", explorer("tx", sigOk));
  const after = await balances("после обмена");

  // 4. Отклонённый из-за slippage: просим на 5% больше, чем пул может дать
  const small = new BN(50 * 1e6);
  const sim2 = await simulateSwap(raydium, d.poolId, small, false);
  const tooHigh = sim2.expectedOut.muln(105).divn(100);
  const tx = await buildSwap(small, tooHigh, sim2.remaining).transaction();
  const { sig: sigFail, err } = await sendRaw(connection, wallet.payer, tx);
  console.log("swap со slippage (ожидаемо отклонён):", explorer("tx", sigFail), "\n  ошибка:", JSON.stringify(err));
  const failTx = await connection.getTransaction(sigFail, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const reason = failTx?.meta?.logMessages?.filter((l) => /Error|slippage|Too/i.test(l)) ?? [];
  console.log("  логи:", reason.join(" | "));
  await balances("после отклонённого");

  Object.assign(d, {
    txSwapOk: sigOk,
    txSwapSlippageFail: sigFail,
    week12: JSON.stringify({
      swapIn: `${SWAP_TUSDC} tUSDC`,
      expectedOut: expectedOut.toNumber() / 1e9,
      minOut: minOut.toNumber() / 1e9,
      received: +(after.sol - before.sol).toFixed(9),
      priceBefore: +before.price.toFixed(4),
      priceAfter: +after.price.toFixed(4),
      tickBefore: before.tick,
      tickAfter: after.tick,
      failReason: reason.join(" | "),
    }),
  });
  saveDeployments(d);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
