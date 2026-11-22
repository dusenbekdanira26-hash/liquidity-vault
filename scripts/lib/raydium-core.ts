/** Raydium SDK v2 для devnet. Без node-зависимостей (owner может быть просто PublicKey). */
import { Raydium, TxVersion, DEV_API_URLS, DEVNET_PROGRAM_ID } from "@raydium-io/raydium-sdk-v2";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const CLMM_PROGRAM_ID: PublicKey = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
export const txVersion = TxVersion.V0;

/** Настройка как в raydium-sdk-V2-demo/src/config.ts (cluster = devnet). */
export async function loadRaydium(connection: Connection, owner: Keypair | PublicKey) {
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
    urlConfigs: {
      ...DEV_API_URLS,
      BASE_HOST: "https://api-v3-devnet.raydium.io",
      OWNER_BASE_HOST: "https://owner-v1-devnet.raydium.io",
      SWAP_HOST: "https://transaction-v1-devnet.raydium.io",
      CPMM_LOCK: "https://dynamic-ipfs-devnet.raydium.io/lock/cpmm/position",
    },
  });
  // Обход бага SDK: у нового пула без ликвидности ещё нет tick-массивов,
  // и getPoolInfoFromRpc падает на Object.values(undefined).
  const clmm: any = raydium.clmm;
  const orig = clmm.getComputeClmmPoolInfos.bind(clmm);
  clmm.getComputeClmmPoolInfos = async (p: any) => {
    const r = await orig(p);
    for (const id of Object.keys(p.clmmPoolsRpcInfo)) r.computePoolTickData[id] ??= {};
    return r;
  };
  return raydium;
}

/** Описание своего тестового токена в формате API Raydium (в API devnet их нет). */
export function tokenInfo(mint: PublicKey, symbol: string, decimals: number) {
  return {
    chainId: 103,
    address: mint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    logoURI: "",
    symbol,
    name: symbol,
    decimals,
    tags: [],
    extensions: {},
  };
}
