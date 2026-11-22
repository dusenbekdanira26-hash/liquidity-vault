import * as anchor from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export { SEEDS, pdas, strategyPdas, explorer } from "./lib/pdas";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const ROOT = path.resolve(__dirname, "..");
export const DEPLOYMENTS = path.join(ROOT, "deployments", "devnet.json");

/** Кошелёк берём из локального файла Solana CLI. В репозиторий он не попадает. */
export function loadWallet(): Keypair {
  const file =
    process.env.ANCHOR_WALLET ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(file, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function getProgram() {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(loadWallet());
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = JSON.parse(
    fs.readFileSync(path.join(ROOT, "target", "idl", "liquidity_vault.json"), "utf8")
  );
  const program = new anchor.Program(idl, provider);
  return { connection, wallet, provider, program };
}

export type Deployments = Record<string, string>;

export function readDeployments(): Deployments {
  if (!fs.existsSync(DEPLOYMENTS)) return {};
  return JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8"));
}

export function saveDeployments(d: Deployments) {
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(d, null, 2) + "\n");
}
