/**
 * Выдать тестовые tUSDC кошельку для демо веб-интерфейса (mint authority — кошелёк администратора).
 * Запуск: yarn mint-test <адрес> [сумма=1000]
 */
import { PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { explorer, getProgram, readDeployments } from "./common";

async function main() {
  const [to, amountArg] = process.argv.slice(2);
  if (!to) throw new Error("Использование: yarn mint-test <адрес> [сумма]");
  const amount = BigInt(Math.floor(Number(amountArg ?? 1000) * 1e6));
  const { connection, wallet } = getProgram();
  const mint = new PublicKey(readDeployments().depositMint);
  const ata = await getOrCreateAssociatedTokenAccount(connection, wallet.payer, mint, new PublicKey(to));
  const sig = await mintTo(connection, wallet.payer, mint, ata.address, wallet.payer, amount);
  console.log(`Выдано ${Number(amount) / 1e6} tUSDC на ${to}:`, explorer("tx", sig));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
