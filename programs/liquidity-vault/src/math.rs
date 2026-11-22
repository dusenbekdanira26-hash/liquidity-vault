//! Учёт долей. Вся арифметика в u128, чтобы произведение не переполнилось.
//! Округление всегда вниз, в пользу vault: так нельзя «выиграть» на округлении.

use anchor_lang::prelude::*;

use crate::errors::VaultError;

/// a * b / c с округлением вниз.
pub fn mul_div_down(a: u64, b: u64, c: u64) -> Result<u64> {
    require!(c > 0, VaultError::MathOverflow);
    let r = (a as u128)
        .checked_mul(b as u128)
        .ok_or(VaultError::MathOverflow)?
        / c as u128;
    u64::try_from(r).map_err(|_| error!(VaultError::MathOverflow))
}

/// Сколько share-токенов выдать за депозит `amount`.
///
/// Первый вкладчик (share ещё нет или vault пуст) получает 1:1.
/// Дальше — пропорционально: amount / total_assets * total_shares.
pub fn shares_for_deposit(amount: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 || total_assets == 0 {
        return Ok(amount);
    }
    mul_div_down(amount, total_shares, total_assets)
}

/// Сколько токенов вернуть за `shares`: shares / total_shares * total_assets.
pub fn assets_for_shares(shares: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    mul_div_down(shares, total_assets, total_shares)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_depositor_gets_one_to_one() {
        assert_eq!(shares_for_deposit(1_000, 0, 0).unwrap(), 1_000);
    }

    #[test]
    fn example_from_course() {
        // В vault 1100 токенов, выпущено 1000 share. Вносим 110 -> 100 share.
        assert_eq!(shares_for_deposit(110, 1_100, 1_000).unwrap(), 100);
    }

    #[test]
    fn rounds_down() {
        assert_eq!(shares_for_deposit(1, 3, 2).unwrap(), 0);
        assert_eq!(assets_for_shares(1, 2, 3).unwrap(), 0);
    }

    #[test]
    fn withdraw_gets_profit() {
        // 1210 токенов, 1100 share: 100 share = 110 токенов
        assert_eq!(assets_for_shares(100, 1_210, 1_100).unwrap(), 110);
        // все share -> все токены
        assert_eq!(assets_for_shares(1_100, 1_210, 1_100).unwrap(), 1_210);
    }

    #[test]
    fn deposit_then_withdraw_never_gains() {
        for (amount, assets, shares) in [(7u64, 13u64, 11u64), (999, 1_001, 1_000), (5, 3, 7)] {
            let s = shares_for_deposit(amount, assets, shares).unwrap();
            let back = assets_for_shares(s, assets + amount, shares + s).unwrap();
            assert!(back <= amount, "{amount} -> {s} share -> {back}");
        }
    }
}
