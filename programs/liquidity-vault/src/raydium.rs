//! Ручные CPI в Raydium CLMM.
//!
//! Крейт `raydium-amm-v3` не подключаем: он жёстко привязан к своей версии
//! Anchor. Инструкция Anchor-программы — это 8 байт дискриминатора
//! (sha256("global:<имя>")[..8]) + аргументы в borsh, поэтому собираем её сами
//! и вызываем через `invoke_signed` от имени PDA authority.
//! Порядок аккаунтов взят из raydium-clmm/programs/amm/src/instructions/*.rs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

/// Raydium CLMM в devnet (в mainnet: CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK).
pub const CLMM_PROGRAM_ID: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
pub const MEMO_PROGRAM_ID: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
pub const METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

pub const IX_SWAP_V2: [u8; 8] = [43, 4, 237, 11, 26, 201, 30, 98];
pub const IX_OPEN_POSITION_V2: [u8; 8] = [77, 184, 74, 214, 112, 86, 241, 199];
pub const IX_DECREASE_LIQUIDITY_V2: [u8; 8] = [58, 127, 188, 62, 79, 82, 196, 96];
pub const IX_CLOSE_POSITION: [u8; 8] = [123, 134, 81, 0, 49, 68, 98, 98];

/// Аккаунт для CPI: (AccountInfo, writable, signer).
pub type Meta<'a, 'info> = (&'a AccountInfo<'info>, bool, bool);

/// Собрать инструкцию Raydium и вызвать её с подписью PDA.
pub fn invoke_raydium<'info>(
    clmm_program: &AccountInfo<'info>,
    accounts: &[Meta<'_, 'info>],
    remaining: &[AccountInfo<'info>],
    data: Vec<u8>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|(ai, w, s)| AccountMeta {
            pubkey: *ai.key,
            is_writable: *w,
            is_signer: *s,
        })
        .collect();
    let mut infos: Vec<AccountInfo<'info>> = accounts.iter().map(|(ai, _, _)| (*ai).clone()).collect();
    for ai in remaining {
        metas.push(AccountMeta {
            pubkey: *ai.key,
            is_writable: ai.is_writable,
            is_signer: false,
        });
        infos.push(ai.clone());
    }
    infos.push(clmm_program.clone());

    let ix = Instruction {
        program_id: *clmm_program.key,
        accounts: metas,
        data,
    };
    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}

/// borsh-данные инструкции: дискриминатор + аргументы.
pub fn ix_data<T: AnchorSerialize>(disc: [u8; 8], args: &T) -> Result<Vec<u8>> {
    let mut data = disc.to_vec();
    args.serialize(&mut data)
        .map_err(|_| error!(crate::errors::VaultError::MathOverflow))?;
    Ok(data)
}

#[derive(AnchorSerialize)]
pub struct SwapV2Args {
    pub amount: u64,
    pub other_amount_threshold: u64,
    pub sqrt_price_limit_x64: u128,
    pub is_base_input: bool,
}

#[derive(AnchorSerialize)]
pub struct OpenPositionV2Args {
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub tick_array_lower_start_index: i32,
    pub tick_array_upper_start_index: i32,
    pub liquidity: u128,
    pub amount_0_max: u64,
    pub amount_1_max: u64,
    pub with_metadata: bool,
    pub base_flag: Option<bool>,
}

#[derive(AnchorSerialize)]
pub struct DecreaseLiquidityV2Args {
    pub liquidity: u128,
    pub amount_0_min: u64,
    pub amount_1_min: u64,
}
