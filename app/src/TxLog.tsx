import type { Tx } from "./hooks";
import { explorer } from "../../scripts/lib/pdas";

const ICON = { pending: "⏳", ok: "✅", error: "❌" } as const;

export function TxLog({ txs }: { txs: Tx[] }) {
  if (!txs.length) return null;
  return (
    <section className="card">
      <h2>Транзакции</h2>
      <ul className="txs">
        {txs.map((t) => (
          <li key={t.id} className={t.status}>
            <span>{ICON[t.status]}</span>
            <span className="grow">{t.label}</span>
            {t.status === "pending" && <span className="muted">подтверждение…</span>}
            {t.sig && (
              <a href={explorer("tx", t.sig)} target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            )}
            {t.error && <span className="err">{t.error}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
