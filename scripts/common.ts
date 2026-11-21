import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
export const ROOT = path.resolve(__dirname, "..");
export const DEPLOYMENTS = path.join(ROOT, "deployments", "devnet.json");

export const SEEDS = {
  vault: Buffer.from("vault"),
  authority: Buffer.from("authority"),
  shareMint: Buffer.from("share_mint"),
  tokenVault: Buffer.from("token_vault"),
  userPosition: Buffer.from("user_position"),
};

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

export function pdas(programId: PublicKey, depositMint: PublicKey, user?: PublicKey) {
  const [vault] = PublicKey.findProgramAddressSync(
    [SEEDS.vault, depositMint.toBuffer()],
    programId
  );
  const [authority] = PublicKey.findProgramAddressSync(
    [SEEDS.authority, vault.toBuffer()],
    programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [SEEDS.shareMint, vault.toBuffer()],
    programId
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [SEEDS.tokenVault, vault.toBuffer()],
    programId
  );
  const userPosition = user
    ? PublicKey.findProgramAddressSync(
        [SEEDS.userPosition, vault.toBuffer(), user.toBuffer()],
        programId
      )[0]
    : undefined;
  return { vault, authority, shareMint, tokenVault, userPosition };
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

export const explorer = (kind: "address" | "tx", id: string) =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
