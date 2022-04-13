use anchor_lang::prelude::*;

#[error_code]
pub enum CollateralPayErrors {
    #[msg("Payment already done, create a new channel!")]
    PaymentAlreadyDone,
    #[msg("Sol already locked!")]
    SolAlreadyLocked,
    #[msg("Cannot withdraw unless payed the full amount!")]
    CannotWithdrawUnlessPayed
}
