/** Адреса PDA программы. Без node-зависимостей: используется и в скриптах, и в веб-интерфейсе. */
import { PublicKey } from "@solana/web3.js";

export const SEEDS = {
  vault: Buffer.from("vault"),
  authority: Buffer.from("authority"),
  shareMint: Buffer.from("share_mint"),
  tokenVault: Buffer.from("token_vault"),
  userPosition: Buffer.from("user_position"),
  strategy: Buffer.from("strategy"),
  tokenVaultB: Buffer.from("token_vault_b"),
};

export function pdas(programId: PublicKey, depositMint: PublicKey, user?: PublicKey) {
  const find = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, programId)[0];
  const vault = find(SEEDS.vault, depositMint.toBuffer());
  return {
    vault,
    authority: find(SEEDS.authority, vault.toBuffer()),
    shareMint: find(SEEDS.shareMint, vault.toBuffer()),
    tokenVault: find(SEEDS.tokenVault, vault.toBuffer()),
    userPosition: user ? find(SEEDS.userPosition, vault.toBuffer(), user.toBuffer()) : undefined,
  };
}

export function strategyPdas(programId: PublicKey, vault: PublicKey) {
  const find = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, programId)[0];
  return {
    strategy: find(SEEDS.strategy, vault.toBuffer()),
    tokenVaultB: find(SEEDS.tokenVaultB, vault.toBuffer()),
  };
}

export const explorer = (kind: "address" | "tx", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
