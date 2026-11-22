import { PublicKey } from "@solana/web3.js";
import deployments from "../../deployments/devnet.json";
import idl from "./idl/liquidity_vault.json";
import { pdas, strategyPdas } from "../../scripts/lib/pdas";

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://api.devnet.solana.com";
export const D = deployments as unknown as Record<string, string>;
export const IDL = idl as any;

export const PROGRAM_ID = new PublicKey(D.programId);
export const DEPOSIT_MINT = new PublicKey(D.depositMint); // tUSDC, 6 знаков
export const OTHER_MINT = new PublicKey(D.tSolMint); // tSOL, 9 знаков
export const A = pdas(PROGRAM_ID, DEPOSIT_MINT);
export const S = strategyPdas(PROGRAM_ID, A.vault);

export const USDC_DEC = 6;
export const SOL_DEC = 9;
