/**
 * Неделя 10: вывод из vault в devnet.
 * Возвращаем 100 share. В vault 1210 токенов и 1100 share,
 * поэтому 100 share = 100 / 1100 * 1210 = 110 токенов.
 * Запуск: yarn week10
 */
import * as anchor from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { explorer, getProgram, pdas, readDeployments, saveDeployments } from "./common";

const UNIT = 1_000_000;

async function main() {
  const { connection, wallet, program } = getProgram();
  const d = readDeployments();
  const depositMint = new PublicKey(d.depositMint);
  const a = pdas(program.programId, depositMint, wallet.publicKey);
  const userToken = getAssociatedTokenAddressSync(depositMint, wallet.publicKey);
  const userShare = getAssociatedTokenAddressSync(a.shareMint, wallet.publicKey);

  const state = async (label: string) => {
    const vaultBal = Number((await getAccount(connection, a.tokenVault)).amount) / UNIT;
    const supply = Number((await getMint(connection, a.shareMint)).supply) / UNIT;
    const mine = Number((await getAccount(connection, userShare)).amount) / UNIT;
    const tokens = Number((await getAccount(connection, userToken)).amount) / UNIT;
    console.log(`${label.padEnd(20)} в vault: ${vaultBal}, share: ${supply}, мои share: ${mine}, мои токены: ${tokens}`);
  };

  await state("до вывода");
  const sig = await program.methods
    .withdraw(new anchor.BN(100 * UNIT))
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
  console.log("withdraw 100 share:", explorer("tx", sig));
  await state("после вывода");

  // inner instructions: какие CPI сделала наша программа
  const tx = await connection.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  for (const group of tx?.meta?.innerInstructions ?? []) {
    for (const ix of group.instructions as any[]) {
      const info = ix.parsed?.info ?? {};
      console.log(`  inner: ${ix.program ?? ix.programId.toBase58()} ${ix.parsed?.type ?? ""}`, JSON.stringify(info));
    }
  }

  d.txWithdraw = sig;
  saveDeployments(d);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
