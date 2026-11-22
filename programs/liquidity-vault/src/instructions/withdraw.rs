use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::VaultError;
use crate::math::{assets_for_shares, mul_div_down};
use crate::state::{UserPosition, Vault};

#[derive(Accounts)]
pub struct Withdraw<'info> {
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

    /// Куда вернуть токены.
    #[account(mut, token::mint = deposit_mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Откуда сжечь share-токены.
    #[account(mut, token::mint = share_mint, token::authority = user)]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ VaultError::Unauthorized,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    require!(shares > 0, VaultError::ZeroAmount);
    let user_shares = ctx.accounts.user_share_account.amount;
    require!(shares <= user_shares, VaultError::InsufficientShares);

    // 1. Сколько токенов положено: shares / total_shares * total_assets.
    let total_assets = ctx.accounts.token_vault.amount;
    let total_shares = ctx.accounts.share_mint.supply;
    let amount = assets_for_shares(shares, total_assets, total_shares)?;
    require!(amount > 0, VaultError::ZeroAmount);

    // 2. Сжечь share-токены — подписывает пользователь (это его токены).
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares,
    )?;

    // 3. Перевести токены из хранилища — подписывает программа от имени PDA authority.
    let vault_key = ctx.accounts.vault.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        AUTHORITY_SEED,
        vault_key.as_ref(),
        &[ctx.accounts.vault.authority_bump],
    ]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.token_vault.to_account_info(),
                mint: ctx.accounts.deposit_mint.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        ctx.accounts.deposit_mint.decimals,
    )?;

    // 4. Учёт: уменьшаем «внесённое» пропорционально доле возвращённых share.
    let position = &mut ctx.accounts.user_position;
    let principal = mul_div_down(position.deposited, shares, user_shares)?;
    position.deposited = position.deposited.saturating_sub(principal);
    let vault = &mut ctx.accounts.vault;
    vault.total_deposited = vault.total_deposited.saturating_sub(principal);

    msg!(
        "Вывод: {} share -> {} токенов (в vault было {}, share было {})",
        shares,
        amount,
        total_assets,
        total_shares
    );
    Ok(())
}
