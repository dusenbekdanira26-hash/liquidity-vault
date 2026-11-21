/**
 * Неделя 8: создаём тестовый токен, vault и карточку пользователя в devnet.
 * Запуск: yarn week08
 */
import { PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import {
  explorer,
  getProgram,
  pdas,
  readDeployments,
  saveDeployments,
} from "./common";

async function main() {
  const { connection, wallet, program } = getProgram();
  const d = readDeployments();
  d.programId = program.programId.toBase58();
  d.admin = wallet.publicKey.toBase58();

  // 1. Тестовый токен, который будет принимать vault (6 знаков, как USDC).
  if (!d.depositMint) {
    const mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );
    d.depositMint = mint.toBase58();
    console.log("Тестовый токен создан:", d.depositMint);
  }
  const depositMint = new PublicKey(d.depositMint);
  const a = pdas(program.programId, depositMint, wallet.publicKey);

  // 2. Создать vault (один раз).
  if (!(await connection.getAccountInfo(a.vault))) {
    const sig = await program.methods
      .initializeVault()
      .accountsPartial({
        admin: wallet.publicKey,
        depositMint,
        vault: a.vault,
        authority: a.authority,
        shareMint: a.shareMint,
        tokenVault: a.tokenVault,
      })
      .rpc();
    d.txInitializeVault = sig;
    console.log("initialize_vault:", explorer("tx", sig));
  }

  // 3. Открыть карточку пользователя.
  if (!(await connection.getAccountInfo(a.userPosition!))) {
    const sig = await program.methods
      .openUserPosition()
      .accountsPartial({
        user: wallet.publicKey,
        vault: a.vault,
        userPosition: a.userPosition!,
      })
      .rpc();
    d.txOpenUserPosition = sig;
    console.log("open_user_position:", explorer("tx", sig));
  }

  Object.assign(d, {
    vault: a.vault.toBase58(),
    authority: a.authority.toBase58(),
    shareMint: a.shareMint.toBase58(),
    tokenVault: a.tokenVault.toBase58(),
    userPosition: a.userPosition!.toBase58(),
  });
  saveDeployments(d);

  const vault: any = await (program.account as any).vault.fetch(a.vault);
  console.log("\nVault:", {
    admin: vault.admin.toBase58(),
    depositMint: vault.depositMint.toBase58(),
    shareMint: vault.shareMint.toBase58(),
    tokenVault: vault.tokenVault.toBase58(),
    totalDeposited: vault.totalDeposited.toString(),
  });
  for (const k of ["programId", "vault", "authority", "shareMint", "tokenVault", "userPosition", "depositMint"]) {
    console.log(`${k.padEnd(14)} ${explorer("address", d[k])}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
