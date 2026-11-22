use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::VaultError;
use crate::raydium::CLMM_PROGRAM_ID;
use crate::state::{Strategy, Vault};

/// Неделя 12. Привязать vault к CLMM-пулу и создать второе хранилище.
#[derive(Accounts)]
pub struct InitStrategy<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(has_one = admin @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,

    /// CHECK: PDA-подпись vault.
    #[account(seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Strategy::INIT_SPACE,
        seeds = [STRATEGY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub strategy: Account<'info, Strategy>,

    /// CHECK: пул Raydium CLMM — проверяем, что им владеет программа CLMM.
    #[account(owner = CLMM_PROGRAM_ID @ VaultError::InvalidAccount)]
    pub pool_state: UncheckedAccount<'info>,

    /// Второй токен пула.
    #[account(constraint = other_mint.key() != vault.deposit_mint @ VaultError::InvalidAccount)]
    pub other_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [TOKEN_VAULT_B_SEED, vault.key().as_ref()],
        bump,
        token::mint = other_mint,
        token::authority = authority,
    )]
    pub token_vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitStrategy>) -> Result<()> {
    let s = &mut ctx.accounts.strategy;
    s.vault = ctx.accounts.vault.key();
    s.pool_state = ctx.accounts.pool_state.key();
    s.other_mint = ctx.accounts.other_mint.key();
    s.token_vault_b = ctx.accounts.token_vault_b.key();
    s.position_nft_mint = Pubkey::default();
    s.tick_lower = 0;
    s.tick_upper = 0;
    s.bump = ctx.bumps.strategy;
    msg!("Стратегия: пул {}, второй токен {}", s.pool_state, s.other_mint);
    Ok(())
}
