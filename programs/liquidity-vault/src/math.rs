//! Учёт долей. Вся арифметика в u128, чтобы произведение не переполнилось.

use anchor_lang::prelude::*;

use crate::errors::VaultError;

/// Сколько share-токенов выдать за депозит `amount`.
///
/// Первый вкладчик (share ещё нет или vault пуст) получает 1:1.
/// Дальше — пропорционально: amount / total_assets * total_shares.
/// Округление вниз, в пользу vault: так нельзя «выиграть» на округлении.
pub fn shares_for_deposit(amount: u64, total_assets: u64, total_shares: u64) -> Result<u64> {
    if total_shares == 0 || total_assets == 0 {
        return Ok(amount);
    }
    let shares = (amount as u128)
        .checked_mul(total_shares as u128)
        .ok_or(VaultError::MathOverflow)?
        / total_assets as u128;
    u64::try_from(shares).map_err(|_| error!(VaultError::MathOverflow))
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
    }
}
