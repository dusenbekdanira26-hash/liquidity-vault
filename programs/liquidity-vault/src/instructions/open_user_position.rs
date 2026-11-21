use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::{UserPosition, Vault};

#[derive(Accounts)]
pub struct OpenUserPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub vault: Account<'info, Vault>,

    /// Карточка пользователя: одна на пару (vault, user).
    #[account(
        init,
        payer = user,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [USER_POSITION_SEED, vault.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<OpenUserPosition>) -> Result<()> {
    let position = &mut ctx.accounts.user_position;
    position.owner = ctx.accounts.user.key();
    position.vault = ctx.accounts.vault.key();
    position.deposited = 0;
    position.bump = ctx.bumps.user_position;

    msg!("Карточка пользователя {} открыта", position.owner);
    Ok(())
}
