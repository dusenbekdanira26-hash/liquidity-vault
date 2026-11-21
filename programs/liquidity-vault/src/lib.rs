//! Liquidity Vault — учебный vault на Solana (недели 8–15).
//!
//! Неделя 8: каркас. Vault создаёт свои аккаунты (настройки, share-токен,
//! хранилище токенов), а каждый пользователь может открыть свою «карточку».
//! Денег пока нет — только структура и PDA.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
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
}
