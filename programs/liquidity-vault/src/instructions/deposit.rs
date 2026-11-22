use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked},
};

use crate::constants::*;
use crate::errors::VaultError;
use crate::math::shares_for_deposit;
use crate::state::{UserPosition, Vault};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        has_one = deposit_mint,
        has_one = share_mint,
        has_one = token_vault,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA-подпись vault, проверяется через seeds.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    pub deposit_mint: Account<'info, Mint>,

    #[account(mut)]
    pub share_mint: Account<'info, Mint>,

    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,

    /// Откуда пользователь вносит токены.
    #[account(
        mut,
        token::mint = deposit_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Куда приходят share-токены (ATA пользователя, создаётся при первом депозите).
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = share_mint,
        associated_token::authority = user,
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ VaultError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, VaultError::ZeroAmount);

    // 1. Сколько share-токенов положено. Считаем ДО перевода.
    let total_assets = ctx.accounts.token_vault.amount;
    let total_shares = ctx.accounts.share_mint.supply;
    let shares = shares_for_deposit(amount, total_assets, total_shares)?;
    require!(shares > 0, VaultError::ZeroShares);

    // 2. Перевод токенов пользователя в хранилище — подписывает сам пользователь.
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.user_token_account.to_account_info(),
                mint: ctx.accounts.deposit_mint.to_account_info(),
                to: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.deposit_mint.decimals,
    )?;

    // 3. Выпуск share-токенов — подписывает программа от имени PDA authority.
    let vault_key = ctx.accounts.vault.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        AUTHORITY_SEED,
        vault_key.as_ref(),
        &[ctx.accounts.vault.authority_bump],
    ]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            signer_seeds,
        ),
        shares,
    )?;

    // 4. Учёт.
    let vault = &mut ctx.accounts.vault;
    vault.total_deposited = vault
        .total_deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;
    let position = &mut ctx.accounts.user_position;
    position.deposited = position
        .deposited
        .checked_add(amount)
        .ok_or(VaultError::MathOverflow)?;

    msg!(
        "Депозит: {} токенов -> {} share (в vault было {}, share выпущено {})",
        amount,
        shares,
        total_assets,
        total_shares
    );
    Ok(())
}
