use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::Vault;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// Администратор — платит за создание аккаунтов.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Токен, который будет принимать vault.
    pub deposit_mint: Account<'info, Mint>,

    /// Настройки vault.
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, deposit_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA без данных и без приватного ключа. Это «подпись» vault:
    /// mint authority share-токена и владелец хранилища.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump)]
    pub authority: UncheckedAccount<'info>,

    /// Share-токен. Mint authority = PDA authority, т.е. выпускать его
    /// может только программа.
    #[account(
        init,
        payer = admin,
        seeds = [SHARE_MINT_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = deposit_mint.decimals,
        mint::authority = authority,
    )]
    pub share_mint: Account<'info, Mint>,

    /// Хранилище токенов. Владелец = PDA authority.
    #[account(
        init,
        payer = admin,
        seeds = [TOKEN_VAULT_SEED, vault.key().as_ref()],
        bump,
        token::mint = deposit_mint,
        token::authority = authority,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.deposit_mint = ctx.accounts.deposit_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.token_vault = ctx.accounts.token_vault.key();
    vault.total_deposited = 0;
    vault.bump = ctx.bumps.vault;
    vault.authority_bump = ctx.bumps.authority;

    msg!(
        "Vault создан: mint={}, share_mint={}",
        vault.deposit_mint,
        vault.share_mint
    );
    Ok(())
}
