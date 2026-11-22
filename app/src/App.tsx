import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useRaydium, useTxLog, useVaultState } from "./hooks";
import { UserPanel } from "./UserPanel";
import { AdminPanel } from "./AdminPanel";
import { TxLog } from "./TxLog";
import { A, PROGRAM_ID } from "./config";
import { explorer } from "../../scripts/lib/pdas";

export function App() {
  const raydium = useRaydium();
  const { state, error, refresh } = useVaultState(raydium);
  const { txs, run } = useTxLog(refresh);
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<"user" | "admin">("user");
  const isAdmin = !!(publicKey && state && publicKey.equals(state.admin));

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo">◎</span>
          <div>
            <h1>Liquidity Vault</h1>
            <p className="muted">Учебный vault на Solana · devnet</p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      <nav className="tabs">
        <button className={tab === "user" ? "active" : ""} onClick={() => setTab("user")}>
          Мой vault
        </button>
        <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>
          Администратор {isAdmin ? "●" : ""}
        </button>
      </nav>

      {error && <div className="alert error">Не удалось прочитать vault: {error}</div>}
      {!state && !error && <div className="card muted">Загружаем данные vault из devnet…</div>}

      {state && tab === "user" && <UserPanel state={state} run={run} />}
      {state && tab === "admin" && <AdminPanel state={state} raydium={raydium} isAdmin={isAdmin} run={run} />}

      <TxLog txs={txs} />

      <footer className="muted small">
        Программа{" "}
        <a href={explorer("address", PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
          {PROGRAM_ID.toBase58().slice(0, 6)}…
        </a>{" "}
        · Vault{" "}
        <a href={explorer("address", A.vault.toBase58())} target="_blank" rel="noreferrer">
          {A.vault.toBase58().slice(0, 6)}…
        </a>{" "}
        · Только тестовые сети, без реальных денег
      </footer>
    </div>
  );
}
