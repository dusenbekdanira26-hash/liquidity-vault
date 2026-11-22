import { Connection, Keypair } from "@solana/web3.js";
import { RPC_URL, loadWallet } from "./common";
import { loadRaydium } from "./lib/raydium-core";

export { CLMM_PROGRAM_ID, txVersion, tokenInfo, loadRaydium } from "./lib/raydium-core";

/** Raydium SDK v2 в devnet с локальным кошельком (только для node-скриптов). */
export async function initRaydium(ownerOverride?: Keypair) {
  const owner = ownerOverride ?? loadWallet();
  const connection = new Connection(RPC_URL, "confirmed");
  const raydium = await loadRaydium(connection, owner);
  return { raydium, owner, connection };
}
