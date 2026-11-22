//! Неделя 13. Vault — провайдер ликвидности в CLMM-пуле Raydium.
//! open_position  -> CPI open_position_v2   (NFT позиции принадлежит PDA authority)
//! collect_fees   -> CPI decrease_liquidity_v2(liquidity = 0): забрать накопленные комиссии
//! close_position -> CPI decrease_liquidity_v2(вся ликвидность) + close_position
//! Все действия — только администратор; подписывает PDA authority.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
    token_2022::Token2022,
};

use crate::constants::*;
use crate::errors::VaultError;
use crate::raydium::*;
use crate::state::{Strategy, Vault};

/// Смещение поля `liquidity` в PersonalPositionState Raydium:
/// 8 (дискриминатор) + 1 (bump) + 32 (nft_mint) + 32 (pool_id) + 4 + 4 (тики).
const PERSONAL_POSITION_LIQUIDITY_OFFSET: usize = 81;

fn authority_seeds<'a>(vault: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
    [AUTHORITY_SEED, vault.as_ref(), bump]
}

fn is_vault_account(key: &Pubkey, vault: &Vault, strategy: &Strategy) -> bool {
    *key == vault.token_vault || *key == strategy.token_vault_b
}

// --------------------------------------------------------------------------
// open_position
// --------------------------------------------------------------------------

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    pub admin: Signer<'info>,

    #[account(has_one = admin @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [STRATEGY_SEED, vault.key().as_ref()],
        bump = strategy.bump,
        has_one = vault,
        has_one = pool_state @ VaultError::InvalidAccount,
    )]
    pub strategy: Box<Account<'info, Strategy>>,

    /// CHECK: PDA authority: payer (платит rent за аккаунты позиции, поэтому
    /// должна иметь немного SOL), владелец NFT и токенов vault.
    #[account(mut, seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// Новый mint NFT позиции — свежий keypair, подписывает транзакцию.
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,

    /// CHECK: ATA authority для NFT — создаёт Raydium.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: Metaplex metadata (не создаётся, with_metadata = false).
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: пул (сверяется со strategy).
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: PDA Raydium ["position", pool, tick_lower, tick_upper].
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: tick array нижней границы.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: tick array верхней границы.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: PDA Raydium ["position", nft_mint].
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,

    /// Хранилище vault для token_0 пула.
    #[account(mut, constraint = is_vault_account(&vault_token_0.key(), &vault, &strategy) @ VaultError::InvalidAccount)]
    pub vault_token_0: Box<Account<'info, TokenAccount>>,
    /// Хранилище vault для token_1 пула.
    #[account(mut, constraint = is_vault_account(&vault_token_1.key(), &vault, &strategy) @ VaultError::InvalidAccount)]
    pub vault_token_1: Box<Account<'info, TokenAccount>>,

    /// CHECK: хранилище пула token_0.
    #[account(mut)]
    pub pool_vault_0: UncheckedAccount<'info>,
    /// CHECK: хранилище пула token_1.
    #[account(mut)]
    pub pool_vault_1: UncheckedAccount<'info>,
    #[account(address = vault_token_0.mint)]
    pub mint_0: Box<Account<'info, Mint>>,
    #[account(address = vault_token_1.mint)]
    pub mint_1: Box<Account<'info, Mint>>,

    /// CHECK: программа Raydium CLMM.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: Metaplex Token Metadata program.
    #[account(address = METADATA_PROGRAM_ID)]
    pub metadata_program: UncheckedAccount<'info>,
    pub token_program_2022: Program<'info, Token2022>,
    // remaining_accounts: tick-array bitmap extension
}

#[allow(clippy::too_many_arguments)]
pub fn open_handler<'info>(
    ctx: Context<'info, OpenPosition<'info>>,
    tick_lower: i32,
    tick_upper: i32,
    tick_array_lower_start: i32,
    tick_array_upper_start: i32,
    liquidity: u128,
    amount_0_max: u64,
    amount_1_max: u64,
) -> Result<()> {
    require!(
        ctx.accounts.strategy.position_nft_mint == Pubkey::default(),
        VaultError::PositionAlreadyOpen
    );
    require!(liquidity > 0, VaultError::ZeroAmount);

    let a = &ctx.accounts;
    let vault_key = a.vault.key();
    let bump = [a.vault.authority_bump];
    let seeds = authority_seeds(&vault_key, &bump);

    let data = ix_data(
        IX_OPEN_POSITION_V2,
        &OpenPositionV2Args {
            tick_lower_index: tick_lower,
            tick_upper_index: tick_upper,
            tick_array_lower_start_index: tick_array_lower_start,
            tick_array_upper_start_index: tick_array_upper_start,
            liquidity,
            amount_0_max, // максимум токенов, который vault готов отдать
            amount_1_max,
            with_metadata: false,
            base_flag: None,
        },
    )?;

    let authority = a.authority.to_account_info();
    let nft_mint = a.position_nft_mint.to_account_info();
    let nft_account = a.position_nft_account.to_account_info();
    let metadata = a.metadata_account.to_account_info();
    let pool = a.pool_state.to_account_info();
    let protocol_position = a.protocol_position.to_account_info();
    let ta_lower = a.tick_array_lower.to_account_info();
    let ta_upper = a.tick_array_upper.to_account_info();
    let personal = a.personal_position.to_account_info();
    let t0 = a.vault_token_0.to_account_info();
    let t1 = a.vault_token_1.to_account_info();
    let pv0 = a.pool_vault_0.to_account_info();
    let pv1 = a.pool_vault_1.to_account_info();
    let rent = a.rent.to_account_info();
    let system = a.system_program.to_account_info();
    let token = a.token_program.to_account_info();
    let ata = a.associated_token_program.to_account_info();
    let meta_prog = a.metadata_program.to_account_info();
    let token22 = a.token_program_2022.to_account_info();
    let m0 = a.mint_0.to_account_info();
    let m1 = a.mint_1.to_account_info();

    invoke_raydium(
        &a.clmm_program.to_account_info(),
        &[
            (&authority, true, true), // payer
            (&authority, false, false), // position_nft_owner
            (&nft_mint, true, true),
            (&nft_account, true, false),
            (&metadata, true, false),
            (&pool, true, false),
            (&protocol_position, true, false),
            (&ta_lower, true, false),
            (&ta_upper, true, false),
            (&personal, true, false),
            (&t0, true, false),
            (&t1, true, false),
            (&pv0, true, false),
            (&pv1, true, false),
            (&rent, false, false),
            (&system, false, false),
            (&token, false, false),
            (&ata, false, false),
            (&meta_prog, false, false),
            (&token22, false, false),
            (&m0, false, false),
            (&m1, false, false),
        ],
        ctx.remaining_accounts,
        data,
        &[&seeds],
    )?;

    let s = &mut ctx.accounts.strategy;
    s.position_nft_mint = ctx.accounts.position_nft_mint.key();
    s.tick_lower = tick_lower;
    s.tick_upper = tick_upper;
    msg!("Позиция открыта: тики [{}, {}], NFT {}", tick_lower, tick_upper, s.position_nft_mint);
    Ok(())
}

// --------------------------------------------------------------------------
// collect_fees / close_position
// --------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ManagePosition<'info> {
    pub admin: Signer<'info>,

    #[account(has_one = admin @ VaultError::Unauthorized)]
    pub vault: Box<Account<'info, Vault>>,

    #[account(
        mut,
        seeds = [STRATEGY_SEED, vault.key().as_ref()],
        bump = strategy.bump,
        has_one = vault,
        has_one = pool_state @ VaultError::InvalidAccount,
        constraint = strategy.position_nft_mint != Pubkey::default() @ VaultError::NoOpenPosition,
        constraint = strategy.position_nft_mint == position_nft_mint.key() @ VaultError::InvalidAccount,
    )]
    pub strategy: Box<Account<'info, Strategy>>,

    /// CHECK: PDA authority — владелец NFT позиции.
    #[account(mut, seeds = [AUTHORITY_SEED, vault.key().as_ref()], bump = vault.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    /// CHECK: mint NFT позиции (сверяется со strategy).
    #[account(mut)]
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: ATA authority с NFT.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: PDA Raydium ["position", nft_mint].
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    /// CHECK: пул.
    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,
    /// CHECK: protocol position.
    #[account(mut)]
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: хранилище пула token_0.
    #[account(mut)]
    pub pool_vault_0: UncheckedAccount<'info>,
    /// CHECK: хранилище пула token_1.
    #[account(mut)]
    pub pool_vault_1: UncheckedAccount<'info>,
    /// CHECK: tick array нижней границы.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: tick array верхней границы.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,

    /// Куда vault получает token_0.
    #[account(mut, constraint = is_vault_account(&vault_token_0.key(), &vault, &strategy) @ VaultError::InvalidAccount)]
    pub vault_token_0: Box<Account<'info, TokenAccount>>,
    /// Куда vault получает token_1.
    #[account(mut, constraint = is_vault_account(&vault_token_1.key(), &vault, &strategy) @ VaultError::InvalidAccount)]
    pub vault_token_1: Box<Account<'info, TokenAccount>>,
    #[account(address = vault_token_0.mint)]
    pub mint_0: Box<Account<'info, Mint>>,
    #[account(address = vault_token_1.mint)]
    pub mint_1: Box<Account<'info, Mint>>,

    /// CHECK: программа Raydium CLMM.
    #[account(address = CLMM_PROGRAM_ID)]
    pub clmm_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: Memo program.
    #[account(address = MEMO_PROGRAM_ID)]
    pub memo_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: tick-array bitmap extension
}

/// CPI decrease_liquidity_v2. При liquidity = 0 Raydium только выплачивает комиссии.
fn decrease_liquidity<'info>(
    ctx: &Context<'info, ManagePosition<'info>>,
    liquidity: u128,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    let vault_key = a.vault.key();
    let bump = [a.vault.authority_bump];
    let seeds = authority_seeds(&vault_key, &bump);

    let data = ix_data(
        IX_DECREASE_LIQUIDITY_V2,
        &DecreaseLiquidityV2Args { liquidity, amount_0_min, amount_1_min },
    )?;
    let authority = a.authority.to_account_info();
    let nft_account = a.position_nft_account.to_account_info();
    let personal = a.personal_position.to_account_info();
    let pool = a.pool_state.to_account_info();
    let protocol_position = a.protocol_position.to_account_info();
    let pv0 = a.pool_vault_0.to_account_info();
    let pv1 = a.pool_vault_1.to_account_info();
    let ta_lower = a.tick_array_lower.to_account_info();
    let ta_upper = a.tick_array_upper.to_account_info();
    let t0 = a.vault_token_0.to_account_info();
    let t1 = a.vault_token_1.to_account_info();
    let token = a.token_program.to_account_info();
    let token22 = a.token_program_2022.to_account_info();
    let memo = a.memo_program.to_account_info();
    let m0 = a.mint_0.to_account_info();
    let m1 = a.mint_1.to_account_info();

    invoke_raydium(
        &a.clmm_program.to_account_info(),
        &[
            (&authority, false, true), // nft_owner
            (&nft_account, false, false),
            (&personal, true, false),
            (&pool, true, false),
            (&protocol_position, true, false),
            (&pv0, true, false),
            (&pv1, true, false),
            (&ta_lower, true, false),
            (&ta_upper, true, false),
            (&t0, true, false), // recipient_token_account_0
            (&t1, true, false), // recipient_token_account_1
            (&token, false, false),
            (&token22, false, false),
            (&memo, false, false),
            (&m0, false, false),
            (&m1, false, false),
        ],
        ctx.remaining_accounts,
        data,
        &[&seeds],
    )
}

fn balances(ctx: &mut Context<ManagePosition>) -> Result<(u64, u64)> {
    ctx.accounts.vault_token_0.reload()?;
    ctx.accounts.vault_token_1.reload()?;
    Ok((ctx.accounts.vault_token_0.amount, ctx.accounts.vault_token_1.amount))
}

pub fn collect_handler<'info>(mut ctx: Context<'info, ManagePosition<'info>>) -> Result<()> {
    let (b0, b1) = balances(&mut ctx)?;
    decrease_liquidity(&ctx, 0, 0, 0)?;
    let (a0, a1) = balances(&mut ctx)?;
    msg!("Комиссии собраны: token_0 +{}, token_1 +{}", a0 - b0, a1 - b1);
    Ok(())
}

pub fn close_handler<'info>(
    mut ctx: Context<'info, ManagePosition<'info>>,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    // Текущая ликвидность позиции — прямо из аккаунта Raydium.
    let liquidity = {
        let data = ctx.accounts.personal_position.try_borrow_data()?;
        let o = PERSONAL_POSITION_LIQUIDITY_OFFSET;
        require!(data.len() >= o + 16, VaultError::InvalidAccount);
        u128::from_le_bytes(data[o..o + 16].try_into().unwrap())
    };

    let (b0, b1) = balances(&mut ctx)?;
    // 1. Вывести всю ликвидность (+ комиссии); минимумы — защита от slippage.
    if liquidity > 0 {
        decrease_liquidity(&ctx, liquidity, amount_0_min, amount_1_min)?;
    }
    let (a0, a1) = balances(&mut ctx)?;
    require!(a0 - b0 >= amount_0_min && a1 - b1 >= amount_1_min, VaultError::SlippageExceeded);

    // 2. Закрыть позицию: сжечь NFT, rent вернётся на authority.
    let a = &ctx.accounts;
    let vault_key = a.vault.key();
    let bump = [a.vault.authority_bump];
    let seeds = authority_seeds(&vault_key, &bump);
    let authority = a.authority.to_account_info();
    let nft_mint = a.position_nft_mint.to_account_info();
    let nft_account = a.position_nft_account.to_account_info();
    let personal = a.personal_position.to_account_info();
    let system = a.system_program.to_account_info();
    let token = a.token_program.to_account_info();
    invoke_raydium(
        &a.clmm_program.to_account_info(),
        &[
            (&authority, true, true), // nft_owner
            (&nft_mint, true, false),
            (&nft_account, true, false),
            (&personal, true, false),
            (&system, false, false),
            (&token, false, false),
        ],
        &[],
        IX_CLOSE_POSITION.to_vec(),
        &[&seeds],
    )?;

    let s = &mut ctx.accounts.strategy;
    s.position_nft_mint = Pubkey::default();
    s.tick_lower = 0;
    s.tick_upper = 0;
    msg!("Позиция закрыта: liquidity {}, вернулось token_0 {}, token_1 {}", liquidity, a0 - b0, a1 - b1);
    Ok(())
}
