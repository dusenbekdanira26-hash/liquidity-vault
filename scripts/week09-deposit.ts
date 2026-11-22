/**
 * Неделя 9: депозит в devnet.
 * 1) первый депозит 1000 токенов -> 1000 share (1:1)
 * 2) имитация дохода: +100 токенов напрямую в хранилище
 * 3) депозит 110 токенов -> 100 share (каждый share теперь «стоит» 1.1)
 * Запуск: yarn week09
 */
import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { explorer, getProgram, pdas, readDeployments, saveDeployments } from "./common";

const UNIT = 1_000_000;

async function main() {
  const { connection, wallet, program } = getProgram();
  const d = readDeployments();
  const depositMint = new PublicKey(d.depositMint);
  const a = pdas(program.programId, depositMint, wallet.publicKey);

  const userToken = (
    await getOrCreateAssociatedTokenAccount(connection, wallet.payer, depositMint, wallet.publicKey)
  ).address;
  const userShare = getAssociatedTokenAddressSync(a.shareMint, wallet.publicKey);

  // тестовые токены себе (mint authority тестового токена — наш кошелёк)
  await mintTo(connection, wallet.payer, depositMint, userToken, wallet.payer, 10_000 * UNIT);

  const state = async (label: string) => {
    const vaultBal = Number((await getAccount(connection, a.tokenVault)).amount) / UNIT;
    const supply = Number((await getMint(connection, a.shareMint)).supply) / UNIT;
    let mine = 0;
    try {
      mine = Number((await getAccount(connection, userShare)).amount) / UNIT;
    } catch {}
    console.log(`${label.padEnd(34)} в vault: ${vaultBal}, share выпущено: ${supply}, мои share: ${mine}`);
  };

  const deposit = (amount: number) =>
    program.methods
      .deposit(new anchor.BN(amount * UNIT))
      .accountsPartial({
        user: wallet.publicKey,
        vault: a.vault,
        authority: a.authority,
        depositMint,
        shareMint: a.shareMint,
        tokenVault: a.tokenVault,
        userTokenAccount: userToken,
        userShareAccount: userShare,
        userPosition: a.userPosition!,
      })
      .rpc();

  await state("до");
  d.txDeposit1 = await deposit(1_000);
  console.log("deposit 1000:", explorer("tx", d.txDeposit1));
  await state("после депозита 1000");

  d.txSimulatedYield = await transfer(connection, wallet.payer, userToken, a.tokenVault, wallet.payer, 100 * UNIT);
  console.log("доход +100 (перевод в хранилище):", explorer("tx", d.txSimulatedYield));
  await state("после дохода +100");

  d.txDeposit2 = await deposit(110);
  console.log("deposit 110:", explorer("tx", d.txDeposit2));
  await state("после депозита 110");

  d.userShareAccount = userShare.toBase58();
  saveDeployments(d);

  const p: any = await (program.account as any).userPosition.fetch(a.userPosition!);
  const v: any = await (program.account as any).vault.fetch(a.vault);
  console.log("vault.total_deposited =", v.totalDeposited.toNumber() / UNIT);
  console.log("user_position.deposited =", p.deposited.toNumber() / UNIT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
