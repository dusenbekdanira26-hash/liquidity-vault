use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Только администратор vault может выполнить это действие")]
    Unauthorized,
    #[msg("Арифметическое переполнение")]
    MathOverflow,
    #[msg("Сумма должна быть больше нуля")]
    ZeroAmount,
    #[msg("Слишком маленький депозит: share-токенов получилось 0")]
    ZeroShares,
    #[msg("Недостаточно share-токенов")]
    InsufficientShares,
    #[msg("Аккаунт не принадлежит vault или пулу стратегии")]
    InvalidAccount,
    #[msg("Получено меньше минимума (slippage)")]
    SlippageExceeded,
    #[msg("Позиция уже открыта")]
    PositionAlreadyOpen,
    #[msg("Открытой позиции нет")]
    NoOpenPosition,
}
