use anchor_lang::prelude::*;

/// Настройки vault. PDA: ["vault", deposit_mint].
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// Администратор: управляет стратегией (обмены, позиции в пуле),
    /// но НЕ может сам забрать токены — ими владеет PDA `authority`.
    pub admin: Pubkey,
    /// Токен, который принимает vault.
    pub deposit_mint: Pubkey,
    /// Share-токен (квитанция о доле). Выпускает только программа.
    pub share_mint: Pubkey,
    /// Хранилище внесённых токенов.
    pub token_vault: Pubkey,
    /// Сколько всего токенов внесено пользователями (учёт).
    pub total_deposited: u64,
    /// Bump самого vault.
    pub bump: u8,
    /// Bump PDA `authority`, которая подписывает действия от имени vault.
    pub authority_bump: u8,
}

/// Карточка пользователя. PDA: ["user_position", vault, owner].
/// Адрес вычисляется из адреса пользователя, поэтому список пользователей
/// хранить не нужно — карточку всегда можно найти.
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub owner: Pubkey,
    pub vault: Pubkey,
    /// Сколько токенов внёс пользователь (учёт).
    pub deposited: u64,
    pub bump: u8,
}
