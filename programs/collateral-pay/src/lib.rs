pub mod errors;

use crate::errors::CollateralPayErrors;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[account]
pub struct PaymentChannel {
    pub buyer: Pubkey,
    pub receiver: Pubkey,
    pub vault_pda: Pubkey,
    pub vault_bump: u8,
    pub receiver_usdc_account: Pubkey,
    pub locked_sol_amount: u64,
    pub sol_locked: bool,
    pub item_value: u64,
    pub amount_paid: u64,
    pub payment_due: u128,
    pub payment_done: bool,
    pub can_withdraw: bool,
}

#[program]
pub mod collateral_pay {
    use std::borrow::BorrowMut;

    use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;

    use super::*;

    pub fn create_channel(
        ctx: Context<CreateChannel>,
        item_value: u64,
        receiver: Pubkey,
        receiver_usdc_account: Pubkey,
        vault_pda: Pubkey,
        vault_bump: u8,
    ) -> Result<()> {
        let channel = &mut ctx.accounts.payment_channel;
        channel.buyer = *ctx.accounts.buyer.to_account_info().key;
        channel.receiver = receiver;
        channel.vault_pda = vault_pda;
        channel.vault_bump = vault_bump;
        channel.receiver_usdc_account = receiver_usdc_account;
        channel.locked_sol_amount = 0;
        channel.sol_locked = false;
        channel.item_value = item_value;
        channel.amount_paid = 0;
        channel.payment_due = Clock::get().unwrap().unix_timestamp as u128;
        channel.payment_done = false;
        channel.can_withdraw = false;

        Ok(())
    }

    pub fn lock_sol(ctx: Context<LockSol>, amount: u64) -> Result<()> {
        let payment_channel = &mut ctx.accounts.payment_channel;

        if payment_channel.to_account_info().owner != ctx.program_id {
            return Ok(());
        }

        if payment_channel.payment_done {
            return Err(error!(CollateralPayErrors::PaymentAlreadyDone));
        }

        if payment_channel.sol_locked {
            return Err(error!(CollateralPayErrors::SolAlreadyLocked));
        }

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.vault_pda.key(),
            amount * LAMPORTS_PER_SOL,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.vault_pda.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        payment_channel.locked_sol_amount = amount * LAMPORTS_PER_SOL;
        payment_channel.sol_locked = true;
        Ok(())
    }

    pub fn pay_amount(ctx: Context<PayAmount>, amount: u64) -> Result<()> {
        let payment_channel = &mut ctx.accounts.payment_channel;

        if payment_channel.payment_done {
            return Err(error!(CollateralPayErrors::PaymentAlreadyDone));
        }

        let cpi_accounts = Transfer {
            from: ctx.accounts.buyer.clone(),
            to: ctx.accounts.seller.clone(),
            authority: ctx.accounts.authority.clone(),
        };

        token::transfer(
            CpiContext::new(ctx.accounts.token_program.clone(), cpi_accounts),
            amount,
        )?;

        payment_channel.amount_paid += amount;

        if payment_channel.amount_paid == payment_channel.item_value {
            payment_channel.payment_done = true;
            payment_channel.can_withdraw = true;
        }

        Ok(())
    }

    pub fn withdraw_locked(ctx: Context<WithdrawLocked>) -> Result<()> {
        let payment_channel = &mut ctx.accounts.payment_channel;

        if !payment_channel.can_withdraw {
            return Err(error!(CollateralPayErrors::CannotWithdrawUnlessPayed));
        }

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.vault_pda.key(),
            &ctx.accounts.buyer.key(),
            ctx.accounts.payment_channel.locked_sol_amount.clone(),
        );

        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_pda.to_account_info(),
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[&[
                &ctx.accounts.buyer.key.to_bytes(),
                &[ctx.accounts.payment_channel.vault_bump],
            ]],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateChannel<'info> {
    #[account(signer, mut)]
    /// CHECK: buyer of the payment channel
    pub buyer: AccountInfo<'info>,
    #[account(init, payer = buyer, space = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 8 + 16 + 1 + 1)]
    pub payment_channel: Account<'info, PaymentChannel>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockSol<'info> {
    #[account(signer, mut, constraint = buyer.key() == payment_channel.buyer)]
    /// CHECK: buyer, since it has a constraint it's good to go.
    pub buyer: AccountInfo<'info>,
    #[account(mut, constraint = vault_pda.key() == payment_channel.vault_pda)]
    /// CHECK: Vault, its safe since the contraint checks if it belongs to the channel.
    pub vault_pda: AccountInfo<'info>,
    #[account(mut)]
    pub payment_channel: Account<'info, PaymentChannel>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PayAmount<'info> {
    #[account(mut)]
    /// CHECK: safe due to the constraint
    pub buyer: AccountInfo<'info>,
    #[account(mut, constraint = seller.key() == payment_channel.receiver_usdc_account)]
    /// CHECK: safe due to the constraint, since it should be same as value in payment channel
    pub seller: AccountInfo<'info>,
    #[account(signer, mut)]
    /// CHECK: account that is gonna sign the transfer transaction
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payment_channel: Account<'info, PaymentChannel>,
    /// CHECK: It's the token program
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct WithdrawLocked<'info> {
    #[account(signer, mut, constraint = buyer.key() == payment_channel.buyer)]
    /// CHECK: buyer, safe due to the constraint
    pub buyer: AccountInfo<'info>,
    #[account(mut, constraint = vault_pda.key() == payment_channel.vault_pda)]
    /// CHECK: Vault, safe due to the constraint
    pub vault_pda: AccountInfo<'info>,
    #[account(mut)]
    pub payment_channel: Account<'info, PaymentChannel>,
    pub system_program: Program<'info, System>,
}
