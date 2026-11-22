/** Хелперы недели 13. Логика — в lib/clmm.ts (общая с веб-интерфейсом); здесь только node-часть. */
import { Keypair } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

export * from "./lib/clmm";

/** Кошелёк «трейдера» для тестовых обменов. Лежит вне репозитория. */
export function loadOrCreateTrader(): Keypair {
  const file = path.join(os.homedir(), ".config", "solana", "trader.json");
  if (!fs.existsSync(file)) {
    const kp = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}
