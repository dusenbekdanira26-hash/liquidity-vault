use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
};

use crate::constants::*;
use crate::errors::VaultError;
use crate::raydium::*;
use crate::state::{Strategy, Vault};

/// Неделя 12. Vault меняет токены через CLMM-пул Raydium.
/// Запускает только администратор, подписывает обмен PDA authority.
#[derive(Accounts)]
pub struct Swap<'info> {
    pub admin: Signer<'info>,

    #[account(has_one = admin @ VaultError::Unauthorized)]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [STRATEGY_SEED, vault.key().as_ref()],
        bump = strategy.bump,
        has_one = vault,
        has_one = pool_state @ VaultError::InvalidAccount,
    )]
    pub strategy: Account<'info, Strategy>,

    /// CHECK: PDA-подпись vault. Она «payer» и владелец токенов в обмене.
    #[account(mut, seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// Хранилище vault, ИЗ которого отдаём токены.
    #[account(
        mut,
        token::authority = authority,
        constraint = (input_token_account.key() == vault.token_vault
            || input_token_account.key() == strategy.token_vault_b) @ VaultError::InvalidAccount,
    )]
    pub input_token_account: Box<Account<'info, TokenAccount>>,

    /// Хранилище vault, В которое получаем токены.
    #[account(
        mut,
        token::authority = authority,
        constraint = (output_token_account.key() == vault.token_vault
            || output_token_account.key() == strategy.token_vault_b) @ VaultError::InvalidAccount,
        constraint = output_token_account.key() != input_token_account.key() @ VaultError::InvalidAccount,
    )]
    pub output_token_account: Box<Account<'info, TokenAccount>>,

    // ---- аккаунты Raydium (проверяет сама программа CLMM) ----
    /// CHECK: программа Raydium CLMM.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
    /// CHECK: fee-конфиг пула.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: пул (сверяется со strategy.pool_state).
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: хранилище пула для входного токена.
    #[account(mut)]
    pub input_vault: UncheckedAccount<'info>,
    /// CHECK: хранилище пула для выходного токена.
    #[account(mut)]
    pub output_vault: UncheckedAccount<'info>,
    /// CHECK: оракул пула.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    #[account(address = input_token_account.mint)]
    pub input_vault_mint: Box<Account<'info, Mint>>,
    #[account(address = output_token_account.mint)]
    pub output_vault_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    // remaining_accounts: tick-array bitmap extension + tick arrays по пути обмена
}

pub fn handler<'info>(
    ctx: Context<'info, Swap<'info>>,
    amount_in: u64,
    min_amount_out: u64,
    sqrt_price_limit_x64: u128,
) -> Result<()> {
    require!(amount_in > 0, VaultError::ZeroAmount);
    let out_before = ctx.accounts.output_token_account.amount;

    let a = &ctx.accounts;
    let vault_key = a.vault.key();
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, vault_key.as_ref(), &[a.vault.authority_bump]]];

    let data = ix_data(
        IX_SWAP_V2,
        &SwapV2Args {
            amount: amount_in,
            other_amount_threshold: min_amount_out, // Raydium сам отменит обмен, если меньше
            sqrt_price_limit_x64,
            is_base_input: true,
        },
    )?;
    let authority = a.authority.to_account_info();
    let amm_config = a.amm_config.to_account_info();
    let pool_state = a.pool_state.to_account_info();
    let input_ta = a.input_token_account.to_account_info();
    let output_ta = a.output_token_account.to_account_info();
    let input_vault = a.input_vault.to_account_info();
    let output_vault = a.output_vault.to_account_info();
    let observation = a.observation_state.to_account_info();
    let token_program = a.token_program.to_account_info();
    let token_program_2022 = a.token_program_2022.to_account_info();
    let memo = a.memo_program.to_account_info();
    let in_mint = a.input_vault_mint.to_account_info();
    let out_mint = a.output_vault_mint.to_account_info();

    invoke_raydium(
        &a.clmm_program.to_account_info(),
        &[
            (&authority, false, true), // payer = PDA authority (подпись через invoke_signed)
            (&amm_config, false, false),
            (&pool_state, true, false),
            (&input_ta, true, false),
            (&output_ta, true, false),
            (&input_vault, true, false),
            (&output_vault, true, false),
            (&observation, true, false),
            (&token_program, false, false),
            (&token_program_2022, false, false),
            (&memo, false, false),
            (&in_mint, false, false),
            (&out_mint, false, false),
        ],
        ctx.remaining_accounts,
        data,
        seeds,
    )?;

    // Своя проверка slippage поверх проверки Raydium.
    ctx.accounts.output_token_account.reload()?;
    let received = ctx
        .accounts
        .output_token_account
        .amount
        .checked_sub(out_before)
        .ok_or(VaultError::MathOverflow)?;
    require!(received >= min_amount_out, VaultError::SlippageExceeded);

    msg!("Обмен: отдали {}, получили {} (минимум {})", amount_in, received, min_amount_out);
    Ok(())
}
