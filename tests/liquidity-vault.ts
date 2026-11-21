import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
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
});
