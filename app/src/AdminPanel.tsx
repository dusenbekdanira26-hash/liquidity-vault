import { useMemo, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { A, D, S, SOL_DEC, USDC_DEC } from "./config";
import { useProgram, type VaultState } from "./hooks";
import { Stat } from "./UserPanel";
import {
  closeVaultPosition,
  collectFees,
  openVaultPosition,
  vaultSwap,
  type Ctx,
} from "../../scripts/lib/clmm";
import { simulateSwap } from "../../scripts/lib/swap";
import { explorer } from "../../scripts/lib/pdas";

const n = (x: number, d = 4) => x.toLocaleString("ru-RU", { maximumFractionDigits: d });

export function AdminPanel({
  state,
  raydium,
  isAdmin,
  run,
}: {
  state: VaultState;
  raydium: any;
  isAdmin: boolean;
  run: (l: string, f: () => Promise<any>) => void;
}) {
  const { program, connection } = useProgram();
  const ctx: Ctx = useMemo(
    () => ({ program, connection, admin: state.admin, d: D, a: A, s: S } as any),
    [program, connection, state.admin]
  );
  const [dir, setDir] = useState<"usdcToSol" | "solToUsdc">("usdcToSol");
  const [amt, setAmt] = useState("50");
  const [slip, setSlip] = useState("1");
  const [quote, setQuote] = useState<{ out: number; min: number } | null>(null);
  const [range, setRange] = useState("5");

  const usdcToSol = dir === "usdcToSol";
  const inDec = usdcToSol ? USDC_DEC : SOL_DEC;
  const outDec = usdcToSol ? SOL_DEC : USDC_DEC;
  const rawIn = () => new BN(Math.floor(Number(amt.replace(",", ".")) * 10 ** inDec));
  const slipBps = Math.round(Number(slip) * 100);

  const getQuote = async () => {
    const { expectedOut } = await simulateSwap(raydium, D.poolId, rawIn(), !usdcToSol);
    const min = expectedOut.muln(10_000 - slipBps).divn(10_000);
    setQuote({ out: expectedOut.toNumber() / 10 ** outDec, min: min.toNumber() / 10 ** outDec });
  };

  const s = state.strategy;
  const nft = s && state.positionOpen ? (s.positionNftMint as PublicKey) : null;

  return (
    <>
      {!isAdmin && (
        <div className="alert">
          Действия доступны только администратору vault{" "}
          <a href={explorer("address", state.admin.toBase58())} target="_blank" rel="noreferrer">
            {state.admin.toBase58().slice(0, 8)}…
          </a>
          . Программа проверяет это сама (<code>has_one = admin</code>) — подключите его кошелёк.
        </div>
      )}

      <section className="grid">
        <Stat label="Цена пула" value={state.price ? `${n(state.price, 4)} tUSDC/tSOL` : "—"} />
        <Stat label="Хранилище tUSDC" value={n(state.assets, 4)} />
        <Stat label="Хранилище tSOL" value={n(state.otherAssets, 6)} />
        <Stat
          label="Позиция в пуле"
          value={state.positionRange ? `${n(state.positionRange[0], 2)} – ${n(state.positionRange[1], 2)}` : "нет"}
          hint={
            state.positionRange && state.price
              ? state.price >= state.positionRange[0] && state.price <= state.positionRange[1]
                ? "цена внутри диапазона — зарабатывает"
                : "цена вне диапазона — нужна ребалансировка"
              : undefined
          }
        />
      </section>

      <section className="card">
        <h2>Обмен через Raydium</h2>
        <div className="row wrap">
          <select value={dir} onChange={(e) => (setDir(e.target.value as any), setQuote(null))}>
            <option value="usdcToSol">tUSDC → tSOL</option>
            <option value="solToUsdc">tSOL → tUSDC</option>
          </select>
          <label className="inline">
            Сумма
            <input value={amt} onChange={(e) => (setAmt(e.target.value), setQuote(null))} inputMode="decimal" />
          </label>
          <label className="inline">
            Slippage, %
            <input value={slip} onChange={(e) => (setSlip(e.target.value), setQuote(null))} inputMode="decimal" className="short" />
          </label>
          <button className="ghost" disabled={!raydium} onClick={() => getQuote().catch((e) => alert(e.message))}>
            Рассчитать
          </button>
        </div>
        {quote && (
          <p className="muted">
            Ожидаем {n(quote.out, 6)} {usdcToSol ? "tSOL" : "tUSDC"}, минимум {n(quote.min, 6)} — если пул даст меньше, обмен отменится.
          </p>
        )}
        <button
          disabled={!isAdmin || !raydium || !(Number(amt) > 0)}
          onClick={() => run(`Обмен ${amt} ${usdcToSol ? "tUSDC → tSOL" : "tSOL → tUSDC"}`, () => vaultSwap(ctx, raydium, usdcToSol, rawIn(), slipBps))}
        >
          Обменять
        </button>
      </section>

      <section className="card">
        <h2>Позиция в CLMM-пуле</h2>
        {nft ? (
          <>
            <p>
              NFT позиции{" "}
              <a href={explorer("address", nft.toBase58())} target="_blank" rel="noreferrer">
                {nft.toBase58().slice(0, 8)}…
              </a>
              , тики {s.tickLower} … {s.tickUpper}
            </p>
            <div className="row">
              <button disabled={!isAdmin} onClick={() => run("Собрать комиссии", () => collectFees(ctx, nft, s.tickLower, s.tickUpper))}>
                Собрать комиссии
              </button>
              <button
                className="danger"
                disabled={!isAdmin || !raydium}
                onClick={() => run("Закрыть позицию", () => closeVaultPosition(ctx, raydium, nft, s.tickLower, s.tickUpper))}
              >
                Закрыть позицию
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="row wrap">
              <label className="inline">
                Диапазон ± %
                <input value={range} onChange={(e) => setRange(e.target.value)} inputMode="decimal" className="short" />
              </label>
              {state.price && (
                <span className="muted">
                  {n(state.price * (1 - Number(range) / 100), 2)} – {n(state.price * (1 + Number(range) / 100), 2)} tUSDC/tSOL
                </span>
              )}
            </div>
            <p className="muted small">
              Vault положит в позицию столько ликвидности, сколько позволяют оба хранилища. Если tSOL нет — сначала обменяйте часть tUSDC.
            </p>
            <button
              disabled={!isAdmin || !raydium || !state.price || state.otherAssets <= 0}
              onClick={() =>
                run(`Открыть позицию ±${range}%`, () =>
                  openVaultPosition(ctx, raydium, state.price! * (1 - Number(range) / 100), state.price! * (1 + Number(range) / 100))
                )
              }
            >
              Открыть позицию
            </button>
          </>
        )}
      </section>
    </>
  );
}
