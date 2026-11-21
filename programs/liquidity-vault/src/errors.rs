use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Только администратор vault может выполнить это действие")]
    Unauthorized,
    #[msg("Арифметическое переполнение")]
    MathOverflow,
}
