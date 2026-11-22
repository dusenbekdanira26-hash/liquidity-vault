import { useState } from "react";
import { BN } from "@anchor-lang/core";
import { useWallet } from "@solana/wallet-adapter-react";
import { A, DEPOSIT_MINT, USDC_DEC } from "./config";
import { useProgram, type VaultState } from "./hooks";

const n = (x: number, d = 4) => x.toLocaleString("ru-RU", { maximumFractionDigits: d });

export function UserPanel({ state, run }: { state: VaultState; run: (l: string, f: () => Promise<any>) => void }) {
  const { program } = useProgram();
  const { publicKey } = useWallet();
  const [dep, setDep] = useState("100");
  const [wd, setWd] = useState("");
  const me = state.me;
  // Упрощение учебной версии: пока средства в позиции или во втором токене, доля считается неверно.
  const locked = state.positionOpen || state.otherAssets > 0;

  const accounts = () => ({
    user: publicKey!,
    vault: A.vault,
    authority: A.authority,
    depositMint: DEPOSIT_MINT,
    shareMint: A.shareMint,
    tokenVault: A.tokenVault,
    userTokenAccount: me.tokenAta,
    userShareAccount: me.shareAta,
    userPosition: me.userPosition,
  });
  const toRaw = (s: string) => new BN(Math.floor(Number(s.replace(",", ".")) * 10 ** USDC_DEC));
  const previewShares = (amt: number) => (state.shares > 0 && state.assets > 0 ? (amt * state.shares) / state.assets : amt);
  const previewTokens = (sh: number) => (state.shares > 0 ? (sh * state.assets) / state.shares : 0);

  return (
    <>
      <section className="grid">
        <Stat label="Всего в vault" value={`${n(state.assets, 2)} tUSDC`} hint={state.otherAssets > 0 ? `+ ${n(state.otherAssets, 6)} tSOL` : undefined} />
        <Stat label="Share выпущено" value={n(state.shares, 2)} />
        <Stat label="Цена 1 share" value={`${n(state.sharePrice, 6)} tUSDC`} hint="растёт, когда vault зарабатывает" />
        <Stat
          label="Цена пула tSOL"
          value={state.price ? `${n(state.price, 4)} tUSDC` : "—"}
          hint={state.positionOpen ? "средства в позиции" : "позиции нет"}
        />
      </section>

      {!publicKey && (
        <section className="card center">
          <p>Подключите Phantom или Solflare в режиме <b>Devnet</b>, чтобы внести токены.</p>
        </section>
      )}

      {me && (
        <section className="card">
          <h2>Мой счёт</h2>
          <div className="grid">
            <Stat label="Мои tUSDC" value={n(me.tokens, 2)} hint={me.tokenAtaExists ? undefined : "нет tUSDC-аккаунта"} />
            <Stat label="Мои share" value={n(me.shares, 6)} />
            <Stat label="Стоимость моих share" value={`${n(previewTokens(me.shares), 4)} tUSDC`} />
            <Stat label="Внесено (учёт)" value={`${n(me.deposited, 4)} tUSDC`} />
          </div>
          {me.sol < 0.01 && <div className="alert">На кошельке мало SOL для комиссий: возьмите devnet SOL на faucet.solana.com</div>}
          {!me.tokenAtaExists && (
            <div className="alert">
              У кошелька нет тестовых tUSDC. Их выпускает администратор: <code>yarn mint-test {me.address.toBase58()} 1000</code>
            </div>
          )}
          {locked && (
            <div className="alert">
              Средства vault сейчас работают в пуле. Депозит и вывод временно закрыты, пока администратор не закроет позицию
              (упрощение учебной версии).
            </div>
          )}

          {!me.hasPosition ? (
            <div className="actions">
              <p className="muted">Сначала создайте свою карточку в vault — это один раз.</p>
              <button
                onClick={() =>
                  run("Открыть карточку", () =>
                    program.methods.openUserPosition().accountsPartial({ user: publicKey!, vault: A.vault, userPosition: me.userPosition }).rpc()
                  )
                }
              >
                Открыть карточку
              </button>
            </div>
          ) : (
            <div className="two">
              <div className="form">
                <h3>Внести</h3>
                <label>
                  Сумма, tUSDC
                  <input value={dep} onChange={(e) => setDep(e.target.value)} inputMode="decimal" />
                </label>
                <p className="muted small">≈ {n(previewShares(Number(dep) || 0), 6)} share</p>
                <button
                  disabled={locked || !me.tokenAtaExists || !(Number(dep) > 0)}
                  onClick={() => run(`Внести ${dep} tUSDC`, () => program.methods.deposit(toRaw(dep)).accountsPartial(accounts()).rpc())}
                >
                  Внести
                </button>
              </div>
              <div className="form">
                <h3>Вывести</h3>
                <label>
                  Share
                  <div className="row">
                    <input value={wd} onChange={(e) => setWd(e.target.value)} inputMode="decimal" placeholder="0" />
                    <button className="ghost" onClick={() => setWd(String(me.shares))}>
                      Все
                    </button>
                  </div>
                </label>
                <p className="muted small">≈ {n(previewTokens(Number(wd) || 0), 4)} tUSDC</p>
                <button
                  disabled={locked || !(Number(wd) > 0)}
                  onClick={() => run(`Вывести ${wd} share`, () => program.methods.withdraw(toRaw(wd)).accountsPartial(accounts()).rpc())}
                >
                  Вывести
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}
