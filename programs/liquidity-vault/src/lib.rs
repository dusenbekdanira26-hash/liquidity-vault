//! Liquidity Vault — учебный vault на Solana (недели 8–15).
//!
//! Неделя 8: каркас. Vault создаёт свои аккаунты (настройки, share-токен,
//! хранилище токенов), а каждый пользователь может открыть свою «карточку».
//! Денег пока нет — только структура и PDA.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod raydium;
pub mod state;

use instructions::*;

declare_id!("oZTAvFts97FCp3ninxy5JTa57adEogs8V48PFMvstcY");

#[program]
pub mod liquidity_vault {
    use super::*;

    /// Создать vault для выбранного токена (deposit_mint).
    /// Один раз создаёт: настройки vault, share-токен и хранилище токенов.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        instructions::initialize_vault::handler(ctx)
    }

    /// Пользователь создаёт свою карточку (UserPosition) в этом vault.
    /// Адрес карточки = PDA от адреса vault и адреса пользователя.
    pub fn open_user_position(ctx: Context<OpenUserPosition>) -> Result<()> {
        instructions::open_user_position::handler(ctx)
    }

    /// Неделя 9. Внести `amount` токенов и получить share-токены.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Неделя 10. Вернуть `shares` share-токенов и забрать свою долю токенов.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, shares)
    }

    /// Неделя 12. Привязать vault к CLMM-пулу Raydium, создать второе хранилище.
    pub fn init_strategy(ctx: Context<InitStrategy>) -> Result<()> {
        instructions::init_strategy::handler(ctx)
    }

    /// Неделя 12. Обменять `amount_in` через пул; получить не меньше `min_amount_out`.
    pub fn swap<'info>(
        ctx: Context<'info, Swap<'info>>,
        amount_in: u64,
        min_amount_out: u64,
        sqrt_price_limit_x64: u128,
    ) -> Result<()> {
        instructions::swap::handler(ctx, amount_in, min_amount_out, sqrt_price_limit_x64)
    }

    /// Неделя 13. Открыть позицию vault в CLMM-пуле в диапазоне [tick_lower, tick_upper].
    #[allow(clippy::too_many_arguments)]
    pub fn open_position<'info>(
        ctx: Context<'info, OpenPosition<'info>>,
        tick_lower: i32,
        tick_upper: i32,
        tick_array_lower_start: i32,
        tick_array_upper_start: i32,
        liquidity: u128,
        amount_0_max: u64,
        amount_1_max: u64,
    ) -> Result<()> {
        instructions::position::open_handler(
            ctx,
            tick_lower,
            tick_upper,
            tick_array_lower_start,
            tick_array_upper_start,
            liquidity,
            amount_0_max,
            amount_1_max,
        )
    }

    /// Неделя 13. Забрать накопленные комиссии позиции.
    pub fn collect_fees<'info>(ctx: Context<'info, ManagePosition<'info>>) -> Result<()> {
        instructions::position::collect_handler(ctx)
    }

    /// Неделя 13. Вывести всю ликвидность (не меньше минимумов) и закрыть позицию.
    pub fn close_position<'info>(
        ctx: Context<'info, ManagePosition<'info>>,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        instructions::position::close_handler(ctx, amount_0_min, amount_1_min)
    }
}
