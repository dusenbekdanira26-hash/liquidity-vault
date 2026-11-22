import { useCallback, useEffect, useMemo, useState } from "react";
import { AnchorProvider, Program } from "@anchor-lang/core";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { A, D, DEPOSIT_MINT, IDL, S, SOL_DEC, USDC_DEC } from "./config";
import { loadRaydium } from "../../scripts/lib/raydium-core";
import { tickToPrice } from "../../scripts/lib/clmm";

/** Программа vault. Без кошелька — read-only провайдер (только чтение аккаунтов). */
export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => {
    const w: any = wallet ?? {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async () => {
        throw new Error("Подключите кошелёк");
      },
      signAllTransactions: async () => {
        throw new Error("Подключите кошелёк");
      },
    };
    const provider = new AnchorProvider(connection, w, { commitment: "confirmed" });
    return { program: new Program(IDL, provider), connection, wallet };
  }, [connection, wallet]);
}

/** Raydium SDK (только для чтения пула и расчётов; подписывает всегда кошелёк через программу vault). */
export function useRaydium() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [raydium, setRaydium] = useState<any>();
  useEffect(() => {
    let alive = true;
    loadRaydium(connection, wallet?.publicKey ?? PublicKey.default).then((r) => alive && setRaydium(r));
    return () => {
      alive = false;
    };
  }, [connection, wallet?.publicKey?.toBase58()]);
  return raydium;
}

const amount = async (connection: any, address: PublicKey) => {
  try {
    return Number((await getAccount(connection, address)).amount);
  } catch {
    return null; // аккаунта ещё нет
  }
};

export type VaultState = Awaited<ReturnType<typeof loadState>>;

async function loadState(program: Program, connection: any, raydium: any, user?: PublicKey) {
  const vault: any = await (program.account as any).vault.fetch(A.vault);
  const strategy: any = await (program.account as any).strategy.fetchNullable(S.strategy);
  const tokenVault = (await amount(connection, A.tokenVault)) ?? 0;
  const tokenVaultB = (await amount(connection, S.tokenVaultB)) ?? 0;
  const supply = Number((await getMint(connection, A.shareMint)).supply);

  let price: number | null = null;
  if (raydium) {
    try {
      price = (await raydium.clmm.getRpcClmmPoolInfo({ poolId: D.poolId })).currentPrice;
    } catch {}
  }
  const positionOpen = strategy && !strategy.positionNftMint.equals(PublicKey.default);

  let me: any = null;
  if (user) {
    const userPosition = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), A.vault.toBuffer(), user.toBuffer()],
      program.programId
    )[0];
    const pos: any = await (program.account as any).userPosition.fetchNullable(userPosition);
    const tokenAta = getAssociatedTokenAddressSync(DEPOSIT_MINT, user);
    const shareAta = getAssociatedTokenAddressSync(A.shareMint, user);
    me = {
      address: user,
      userPosition,
      hasPosition: !!pos,
      deposited: pos ? pos.deposited.toNumber() / 10 ** USDC_DEC : 0,
      tokenAta,
      shareAta,
      tokens: ((await amount(connection, tokenAta)) ?? 0) / 10 ** USDC_DEC,
      tokenAtaExists: (await amount(connection, tokenAta)) !== null,
      shares: ((await amount(connection, shareAta)) ?? 0) / 10 ** USDC_DEC,
      sol: (await connection.getBalance(user)) / 1e9,
    };
  }

  const assets = tokenVault / 10 ** USDC_DEC;
  const shares = supply / 10 ** USDC_DEC;
  return {
    admin: vault.admin as PublicKey,
    totalDeposited: vault.totalDeposited.toNumber() / 10 ** USDC_DEC,
    assets,
    otherAssets: tokenVaultB / 10 ** SOL_DEC,
    shares,
    sharePrice: shares > 0 ? assets / shares : 1,
    price,
    strategy,
    positionOpen,
    positionRange: positionOpen
      ? [tickToPrice(strategy.tickLower), tickToPrice(strategy.tickUpper)]
      : null,
    me,
  };
}

export function useVaultState(raydium: any) {
  const { program, connection, wallet } = useProgram();
  const [state, setState] = useState<VaultState>();
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    try {
      setState(await loadState(program, connection, raydium, wallet?.publicKey));
      setError(undefined);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [program, connection, raydium, wallet?.publicKey?.toBase58()]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);
  return { state, error, refresh };
}

export type Tx = { id: number; label: string; status: "pending" | "ok" | "error"; sig?: string; error?: string };

/** Статус транзакций для показа пользователю. */
export function useTxLog(onDone: () => void) {
  const [txs, setTxs] = useState<Tx[]>([]);
  const run = useCallback(
    async (label: string, fn: () => Promise<string | { sig: string }>) => {
      const id = Date.now() + Math.random();
      setTxs((t) => [{ id, label, status: "pending" } as Tx, ...t].slice(0, 8));
      try {
        const r = await fn();
        const sig = typeof r === "string" ? r : r.sig;
        setTxs((t) => t.map((x) => (x.id === id ? { ...x, status: "ok" as const, sig } : x)));
      } catch (e: any) {
        const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
        const anchorErr = logs.find((l) => l.includes("Error Message")) ?? e?.error?.errorMessage;
        const msg = anchorErr ?? e?.message ?? String(e);
        setTxs((t) => t.map((x) => (x.id === id ? { ...x, status: "error" as const, error: msg } : x)));
      } finally {
        onDone();
      }
    },
    [onDone]
  );
  return { txs, run };
}
