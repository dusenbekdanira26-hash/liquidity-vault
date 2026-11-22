import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import {
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
} from "@solana/spl-token";
import { expect } from "chai";
import { LiquidityVault } from "../target/types/liquidity_vault";

describe("liquidity-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LiquidityVault as Program<LiquidityVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  let depositMint: PublicKey;
  const pda = (...seeds: Buffer[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  let vault: PublicKey, authority: PublicKey, shareMint: PublicKey, tokenVault: PublicKey;

  before(async () => {
    depositMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    vault = pda(Buffer.from("vault"), depositMint.toBuffer());
    authority = pda(Buffer.from("authority"), vault.toBuffer());
    shareMint = pda(Buffer.from("share_mint"), vault.toBuffer());
    tokenVault = pda(Buffer.from("token_vault"), vault.toBuffer());
  });

  it("неделя 8: создаёт vault, share-токен и хранилище", async () => {
    await program.methods
      .initializeVault()
      .accountsPartial({ admin: admin.publicKey, depositMint, vault, authority, shareMint, tokenVault })
      .rpc();

    const v = await program.account.vault.fetch(vault);
    expect(v.admin.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(v.shareMint.toBase58()).to.eq(shareMint.toBase58());
    expect(v.totalDeposited.toNumber()).to.eq(0);

    // share-токен выпускает только PDA authority
    const mintInfo = await provider.connection.getParsedAccountInfo(shareMint);
    const parsed: any = (mintInfo.value!.data as any).parsed.info;
    expect(parsed.mintAuthority).to.eq(authority.toBase58());
  });

  it("неделя 8: пользователь открывает карточку", async () => {
    const userPosition = pda(Buffer.from("user_position"), vault.toBuffer(), admin.publicKey.toBuffer());
    await program.methods
      .openUserPosition()
      .accountsPartial({ user: admin.publicKey, vault, userPosition })
      .rpc();
    const p = await program.account.userPosition.fetch(userPosition);
    expect(p.owner.toBase58()).to.eq(admin.publicKey.toBase58());
    expect(p.deposited.toNumber()).to.eq(0);
  });

  describe("неделя 9: депозит", () => {
    const UNIT = 1_000_000; // 6 знаков
    let userToken: PublicKey;
    let userShare: PublicKey;
    let userPosition: PublicKey;

    const deposit = (amount: number) =>
      program.methods
        .deposit(new anchor.BN(amount))
        .accountsPartial({
          user: admin.publicKey,
          vault,
          authority,
          depositMint,
          shareMint,
          tokenVault,
          userTokenAccount: userToken,
          userShareAccount: userShare,
          userPosition,
        })
        .rpc();

    before(async () => {
      userToken = (
        await getOrCreateAssociatedTokenAccount(provider.connection, admin, depositMint, admin.publicKey)
      ).address;
      await mintTo(provider.connection, admin, depositMint, userToken, admin, 10_000 * UNIT);
      userShare = getAssociatedTokenAddressSync(shareMint, admin.publicKey);
      userPosition = pda(Buffer.from("user_position"), vault.toBuffer(), admin.publicKey.toBuffer());
    });

    it("первый вкладчик получает share 1:1", async () => {
      await deposit(1_000 * UNIT);
      expect(Number((await getAccount(provider.connection, userShare)).amount)).to.eq(1_000 * UNIT);
      expect(Number((await getAccount(provider.connection, tokenVault)).amount)).to.eq(1_000 * UNIT);
    });

    it("пример из методички: vault заработал 100 → за 110 токенов дают 100 share", async () => {
      // имитируем доход vault: 100 токенов приходят в хранилище напрямую
      await transfer(provider.connection, admin, userToken, tokenVault, admin, 100 * UNIT);
      await deposit(110 * UNIT);
      const shares = Number((await getAccount(provider.connection, userShare)).amount);
      expect(shares).to.eq(1_100 * UNIT); // 1000 + 100
      expect(Number((await getMint(provider.connection, shareMint)).supply)).to.eq(1_100 * UNIT);

      const v = await program.account.vault.fetch(vault);
      expect(v.totalDeposited.toNumber()).to.eq(1_110 * UNIT);
      const p = await program.account.userPosition.fetch(userPosition);
      expect(p.deposited.toNumber()).to.eq(1_110 * UNIT);
    });

    it("нельзя внести ноль", async () => {
      try {
        await deposit(0);
        expect.fail("депозит 0 должен быть отклонён");
      } catch (e: any) {
        expect(String(e)).to.include("ZeroAmount");
      }
    });

    describe("неделя 10: вывод", () => {
      const withdraw = (shares: number) =>
        program.methods
          .withdraw(new anchor.BN(shares))
          .accountsPartial({
            user: admin.publicKey,
            vault,
            authority,
            depositMint,
            shareMint,
            tokenVault,
            userTokenAccount: userToken,
            userShareAccount: userShare,
            userPosition,
          })
          .rpc();

      it("100 share → 110 токенов (share подорожал после дохода)", async () => {
        // сейчас: в vault 1210, share 1100
        const before = Number((await getAccount(provider.connection, userToken)).amount);
        await withdraw(100 * UNIT);
        const after = Number((await getAccount(provider.connection, userToken)).amount);
        expect(after - before).to.eq(110 * UNIT);
        expect(Number((await getMint(provider.connection, shareMint)).supply)).to.eq(1_000 * UNIT);
        expect(Number((await getAccount(provider.connection, tokenVault)).amount)).to.eq(1_100 * UNIT);
        // учёт уменьшился пропорционально: 1110 * 100/1100 = 100.909090
        const p = await program.account.userPosition.fetch(userPosition);
        expect(p.deposited.toNumber()).to.eq(1_110 * UNIT - Math.floor((1_110 * UNIT * 100) / 1_100));
      });

      it("нельзя вывести больше, чем есть share", async () => {
        try {
          await withdraw(1_001 * UNIT);
          expect.fail("должно быть отклонено");
        } catch (e: any) {
          expect(String(e)).to.include("InsufficientShares");
        }
      });

      it("администратор не может забрать токены из хранилища своей подписью", async () => {
        try {
          await transfer(provider.connection, admin, tokenVault, userToken, admin, 1);
          expect.fail("перевод из хранилища без PDA должен быть отклонён");
        } catch (e: any) {
          expect(String(e)).to.match(/owner does not match|custom program error: 0x4/i);
        }
      });

      it("вывод всех share возвращает всё содержимое хранилища", async () => {
        await withdraw(1_000 * UNIT);
        expect(Number((await getMint(provider.connection, shareMint)).supply)).to.eq(0);
        expect(Number((await getAccount(provider.connection, tokenVault)).amount)).to.eq(0);
        const p = await program.account.userPosition.fetch(userPosition);
        expect(p.deposited.toNumber()).to.eq(0);
      });
    });
  });
});
