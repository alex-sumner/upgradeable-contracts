use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Token, Transfer};
use sha3::{Digest, Keccak256};
use solana_program::secp256k1_recover::secp256k1_recover;

declare_id!("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");

// Define constants at module level
const MAX_SUPPORTED_TOKENS: usize = 10;
const MAX_AUTHORITIES: usize = 5;
pub const WITHDRAWALS_PER_ACCOUNT: usize = 4_000;
const WITHDRAWAL_BITMAP_SIZE: usize = 500; // 500 bytes * 8 bits = 4,000 withdrawals

const WITHDRAWAL_TYPEHASH: [u8; 32] = [
    167, 69, 94, 218, 166, 15, 227, 162, 173, 23, 189, 249, 11, 198, 237, 102, 6, 5, 183, 189, 69,
    157, 74, 166, 94, 139, 214, 92, 182, 237, 67, 161,
]; // keccak256("Withdrawal(uint256 id,address token,address trader,uint256 amount)")

const EIP712_DOMAIN_TYPEHASH: [u8; 32] = [
    139, 115, 195, 198, 155, 184, 254, 61, 81, 46, 204, 76, 247, 89, 204, 121, 35, 159, 123, 23,
    155, 15, 250, 202, 169, 167, 93, 82, 43, 57, 64, 15,
]; // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")

const DOMAIN_NAME: &[u8] = b"RabbitXWithdrawal";
const DOMAIN_VERSION: &[u8] = b"1";

pub const UNLOCKED: u8 = 1;
pub const LOCKED: u8 = 2;

pub const PROGRAM_VERSION: &str = "1.0.1";

#[program]
pub mod rbx {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        default_token: Pubkey,
        min_deposit: u64,
        timelock_delay: i64,
        withdrawal_signer: [u8; 20],
        initial_authorities: Vec<Pubkey>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        // Validate initial authorities
        require!(
            !initial_authorities.is_empty(),
            RbxError::NoAuthoritiesProvided
        );
        require!(
            initial_authorities.len() <= MAX_AUTHORITIES,
            RbxError::TooManyAuthorities
        );

        // Check for duplicates using a simple n^2 approach (since MAX_AUTHORITIES is small)
        for i in 0..initial_authorities.len() {
            for j in i + 1..initial_authorities.len() {
                require!(
                    initial_authorities[i] != initial_authorities[j],
                    RbxError::DuplicateAuthority
                );
            }
        }

        state.owner = ctx.accounts.owner.key();
        state.timelock_authorities = initial_authorities;
        state.timelock_delay = timelock_delay;
        state.withdrawal_signer = withdrawal_signer;
        state.next_deposit_num = 1000;
        state.next_stake_num = 1000;
        state.reentry_lock_status = UNLOCKED;

        // Store the token account authority bump
        state.token_account_bump = ctx.bumps.program_token_authority;

        // Store the SOL account bump
        state.sol_account_bump = ctx.bumps.program_sol_account;

        // Initialize domain separator cache as None (will be computed on first use)
        state.domain_separator = None;

        // Verify the default token exists
        require!(
            ctx.accounts.default_token_mint.key() != Pubkey::default(),
            RbxError::InvalidToken
        );

        // Initialize with default token
        state.supported_tokens.push(default_token);
        state.set_min_deposit(default_token, min_deposit);

        emit!(InitializeEvent {
            owner: state.owner,
            signer: state.withdrawal_signer,
            timelock_authorities: state.timelock_authorities.clone(),
            timelock_delay,
            default_token,
            min_deposit,
        });

        Ok(())
    }

    pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        let state = &ctx.accounts.state;
        let token = ctx.accounts.mint.key();

        // Verify token is supported
        require!(
            ctx.accounts.state.supported_tokens.contains(&token),
            RbxError::UnsupportedToken
        );
        let min_deposit = state
            .get_min_deposit(&token)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);

        let deposit_num = ctx.accounts.state.next_deposit_num;
        ctx.accounts.state.next_deposit_num += 1;

        // Create deposit ID string with _rbx_sol suffix
        let mut deposit_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        deposit_id.push_str("d_");
        deposit_id.push_str(&deposit_num.to_string());
        deposit_id.push_str("_rbx_sol");

        // Transfer tokens from user to program token account
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.program_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        emit!(DepositEvent {
            id: deposit_id,
            trader: ctx.accounts.user.key(),
            amount,
            token,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }

    pub fn deposit_token_for(
        ctx: Context<DepositToken>,
        amount: u64,
        for_trader: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        let state = &ctx.accounts.state;
        let token = ctx.accounts.mint.key();

        // Verify token is supported
        require!(
            ctx.accounts.state.supported_tokens.contains(&token),
            RbxError::UnsupportedToken
        );
        let min_deposit = state
            .get_min_deposit(&token)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);

        let deposit_num = ctx.accounts.state.next_deposit_num;
        ctx.accounts.state.next_deposit_num += 1;

        // Create deposit ID string with _rbx_sol suffix
        let mut deposit_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        deposit_id.push_str("d_");
        deposit_id.push_str(&deposit_num.to_string());
        deposit_id.push_str("_rbx_sol");

        // Transfer tokens from user to program token account
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.program_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        emit!(DepositEvent {
            id: deposit_id,
            trader: for_trader, // Use the provided for_trader parameter instead of the sender
            amount,
            token,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }

    pub fn support_token(ctx: Context<SupportToken>, min_deposit: u64) -> Result<()> {
        require!(
            ctx.accounts
                .state
                .timelock_authorities
                .contains(&ctx.accounts.authority.key()),
            RbxError::UnauthorizedAccess
        );

        let state = &mut ctx.accounts.state;
        let token = ctx.accounts.token_mint.key();

        // Verify the token exists
        require!(
            ctx.accounts.token_mint.key() != Pubkey::default(),
            RbxError::InvalidToken
        );

        require!(
            state.supported_tokens.len() < MAX_SUPPORTED_TOKENS,
            RbxError::TooManyTokens
        );

        state.supported_tokens.push(token);
        state.set_min_deposit(token, min_deposit);

        emit!(SupportTokenEvent { token, min_deposit });
        Ok(())
    }

    pub fn unsupport_token(ctx: Context<UnsupportToken>, token: Pubkey) -> Result<()> {
        require!(
            ctx.accounts
                .state
                .timelock_authorities
                .contains(&ctx.accounts.authority.key()),
            RbxError::UnauthorizedAccess
        );

        let state = &mut ctx.accounts.state;

        // Find the token in the supported tokens list
        let position = state
            .supported_tokens
            .iter()
            .position(|&t| t == token)
            .ok_or(RbxError::UnsupportedToken)?;

        // Remove the token from the supported tokens list
        state.supported_tokens.remove(position);

        // Remove the token from the min deposits list
        state.remove_min_deposit(&token);

        emit!(UnsupportTokenEvent { token });

        Ok(())
    }

    // Native SOL deposit
    pub fn deposit_native(ctx: Context<DepositNative>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        // Verify amount meets minimum
        let state = &ctx.accounts.state;
        let wrapped_sol = ctx.accounts.wrapped_sol_mint.key();

        let min_deposit = state
            .get_min_deposit(&wrapped_sol)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);
        require!(
            amount <= ctx.accounts.user.lamports(),
            RbxError::InsufficientFunds
        );

        let deposit_num = ctx.accounts.state.next_deposit_num;
        ctx.accounts.state.next_deposit_num += 1;

        // Create deposit ID string with _rbx_sol suffix
        let mut deposit_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        deposit_id.push_str("d_");
        deposit_id.push_str(&deposit_num.to_string());
        deposit_id.push_str("_rbx_sol");

        // Transfer SOL from user to program
        let ix = solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.program_sol_account.key(),
            amount,
        );

        solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.program_sol_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        emit!(DepositEvent {
            id: deposit_id,
            trader: ctx.accounts.user.key(),
            amount,
            token: wrapped_sol,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }

    // Native SOL deposit on behalf of another trader
    pub fn deposit_native_for(
        ctx: Context<DepositNative>,
        amount: u64,
        for_trader: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        // Verify amount meets minimum
        let state = &ctx.accounts.state;
        let wrapped_sol = ctx.accounts.wrapped_sol_mint.key();

        let min_deposit = state
            .get_min_deposit(&wrapped_sol)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);
        require!(
            amount <= ctx.accounts.user.lamports(),
            RbxError::InsufficientFunds
        );

        let deposit_num = ctx.accounts.state.next_deposit_num;
        ctx.accounts.state.next_deposit_num += 1;

        // Create deposit ID string with _rbx_sol suffix
        let mut deposit_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        deposit_id.push_str("d_");
        deposit_id.push_str(&deposit_num.to_string());
        deposit_id.push_str("_rbx_sol");

        // Transfer SOL from user to program
        let ix = solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.program_sol_account.key(),
            amount,
        );

        solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.program_sol_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        emit!(DepositEvent {
            id: deposit_id,
            trader: for_trader, // Use the provided for_trader parameter instead of the sender
            amount,
            token: wrapped_sol,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }

    pub fn withdraw_token(
        ctx: Context<WithdrawToken>,
        id: u64,
        amount: u64,
        v: u8,
        r: [u8; 32],
        s: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );
        ctx.accounts.state.reentry_lock_status = LOCKED;

        // Process common withdrawal logic
        process_withdrawal(
            &ctx.program_id,
            &mut ctx.accounts.state,
            &mut ctx.accounts.withdrawal_record,
            id,
            amount,
            ctx.accounts.mint.key(),
            ctx.accounts.trader.key(),
            v,
            r,
            s,
        )?;

        // Transfer tokens from program to user
        let seeds = &[
            b"token_authority".as_ref(),
            &[ctx.accounts.state.token_account_bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.program_token_account.to_account_info(),
                to: ctx.accounts.trader_token_account.to_account_info(),
                authority: ctx.accounts.program_token_authority.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, amount)?;

        // Unlock reentrancy lock
        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        emit!(WithdrawalEvent {
            id,
            trader: ctx.accounts.trader.key(),
            amount,
            token: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    pub fn withdraw_native(
        ctx: Context<WithdrawNative>,
        id: u64,
        amount: u64,
        v: u8,
        r: [u8; 32],
        s: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );
        ctx.accounts.state.reentry_lock_status = LOCKED;

        // Process common withdrawal logic
        process_withdrawal(
            &ctx.program_id,
            &mut ctx.accounts.state,
            &mut ctx.accounts.withdrawal_record,
            id,
            amount,
            ctx.accounts.wrapped_sol_mint.key(),
            ctx.accounts.trader.key(),
            v,
            r,
            s,
        )?;

        // Transfer SOL from program to user
        let seeds = &[
            b"sol_account".as_ref(),
            &[ctx.accounts.state.sol_account_bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ix = solana_program::system_instruction::transfer(
            &ctx.accounts.program_sol_account.key(),
            &ctx.accounts.trader.key(),
            amount,
        );

        solana_program::program::invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.program_sol_account.to_account_info(),
                ctx.accounts.trader.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        emit!(WithdrawalEvent {
            id,
            trader: ctx.accounts.trader.key(),
            amount,
            token: ctx.accounts.wrapped_sol_mint.key(),
        });

        Ok(())
    }

    pub fn get_version(_ctx: Context<GetVersion>) -> Result<String> {
        Ok(PROGRAM_VERSION.to_string())
    }

    pub fn get_eip712_verifying_contract(
        ctx: Context<GetEip712VerifyingContract>,
    ) -> Result<String> {
        // Get the full 32-byte state PDA pubkey
        let pubkey = ctx.accounts.state.key();

        // Convert the pubkey to a 32-byte hex string
        let bytes = pubkey.to_bytes();
        let hex_string = format!("0x{}", hex::encode(bytes));

        // Return the hex string representation (with 0x prefix)
        Ok(hex_string)
    }

    // Queue a timelock operation
    pub fn queue_operation(
        ctx: Context<QueueOperation>,
        operation_type: u8,
        data: Vec<u8>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        // Only timelock authority can queue operations
        require!(
            state
                .timelock_authorities
                .contains(&ctx.accounts.authority.key()),
            RbxError::UnauthorizedAccess
        );

        // Validate operation type
        require!(
            operation_type >= 1 && operation_type <= 5,
            RbxError::InvalidOperationType
        );

        let clock = Clock::get()?;
        let current_time = clock.unix_timestamp;
        let execute_time = current_time + state.timelock_delay;

        let operation = TimelockOperation {
            operation_type,
            data,
            queued_at: current_time,
            can_execute_at: execute_time,
        };

        state.pending_operations.push(operation);

        emit!(QueueOperationEvent {
            operation_type,
            execute_time,
        });

        Ok(())
    }

    pub fn execute_operation(ctx: Context<ExecuteOperation>, operation_index: u8) -> Result<()> {
        let state = &mut ctx.accounts.state;

        // Only timelock authority can execute operations
        require!(
            state
                .timelock_authorities
                .contains(&ctx.accounts.authority.key()),
            RbxError::UnauthorizedAccess
        );

        // Check if operation index is valid
        require!(
            (operation_index as usize) < state.pending_operations.len(),
            RbxError::InvalidOperationIndex
        );

        // Clone the operation to avoid borrow issues
        let operation = state.pending_operations[operation_index as usize].clone();

        // Check if timelock delay has passed
        let current_time = Clock::get()?.unix_timestamp;
        require!(
            current_time >= operation.can_execute_at,
            RbxError::TimelockDelayNotMet
        );

        // Execute operation based on type
        match operation.operation_type {
            1 => {
                // Change owner
                require!(operation.data.len() == 32, RbxError::InvalidOperationData);
                let new_owner = Pubkey::try_from_slice(&operation.data[0..32])?;
                state.owner = new_owner;

                emit!(SetOwnerEvent { owner: new_owner });
            }
            2 => {
                // Change signer - which is a 20-byte Ethereum address
                require!(operation.data.len() == 20, RbxError::InvalidOperationData);
                let mut new_signer = [0u8; 20];
                new_signer.copy_from_slice(&operation.data[0..20]);

                // Check if signer is all zeros
                let is_zero = new_signer.iter().all(|&b| b == 0);
                require!(!is_zero, RbxError::InvalidSigner);

                state.withdrawal_signer = new_signer;

                emit!(SetSignerEvent { signer: new_signer });
            }
            3 => {
                // Set timelock delay
                require!(operation.data.len() == 8, RbxError::InvalidOperationData);
                let new_delay = i64::from_le_bytes(operation.data[0..8].try_into().unwrap());
                require!(new_delay >= 0, RbxError::InvalidTimelockDelay);
                state.timelock_delay = new_delay;

                emit!(SetTimelockDelayEvent { delay: new_delay });
            }
            4 => {
                // Add timelock authority
                require!(operation.data.len() == 32, RbxError::InvalidOperationData);
                let new_authority = Pubkey::try_from_slice(&operation.data[0..32])?;

                // Validate the new authority
                require!(
                    new_authority != Pubkey::default(),
                    RbxError::InvalidAuthority
                );

                // Check if already an authority
                require!(
                    !state.timelock_authorities.contains(&new_authority),
                    RbxError::AuthorityAlreadyExists
                );

                // Check max limit
                require!(
                    state.timelock_authorities.len() < MAX_AUTHORITIES,
                    RbxError::TooManyAuthorities
                );

                // Add the new authority
                state.timelock_authorities.push(new_authority);

                emit!(AddAuthorityEvent {
                    authority: new_authority
                });
            }
            5 => {
                // Remove timelock authority
                require!(operation.data.len() == 32, RbxError::InvalidOperationData);
                let authority_to_remove = Pubkey::try_from_slice(&operation.data[0..32])?;

                // Prevent removing non-existent authority
                let position = state
                    .timelock_authorities
                    .iter()
                    .position(|&a| a == authority_to_remove)
                    .ok_or(RbxError::AuthorityNotFound)?;

                // Prevent removing the last authority
                require!(
                    state.timelock_authorities.len() > 1,
                    RbxError::CannotRemoveLastAuthority
                );

                // Remove the authority
                state.timelock_authorities.remove(position);

                emit!(RemoveAuthorityEvent {
                    authority: authority_to_remove
                });
            }
            _ => return Err(error!(RbxError::InvalidOperationType)),
        }

        // Remove the operation from the pending list
        state.pending_operations.remove(operation_index as usize);

        emit!(ExecuteOperationEvent {
            operation_type: operation.operation_type,
        });

        Ok(())
    }

    pub fn get_withdrawal_signer(ctx: Context<GetWithdrawalSigner>) -> Result<[u8; 20]> {
        Ok(ctx.accounts.state.withdrawal_signer)
    }
    
    pub fn get_owner(ctx: Context<GetOwner>) -> Result<Pubkey> {
        Ok(ctx.accounts.state.owner)
    }
    
    pub fn get_next_stake_num(ctx: Context<GetNextStakeNum>) -> Result<u64> {
        Ok(ctx.accounts.state.next_stake_num)
    }
    
    pub fn get_next_deposit_num(ctx: Context<GetNextDepositNum>) -> Result<u64> {
        Ok(ctx.accounts.state.next_deposit_num)
    }
    
    pub fn get_timelock_delay(ctx: Context<GetTimelockDelay>) -> Result<i64> {
        Ok(ctx.accounts.state.timelock_delay)
    }
    
    pub fn get_domain_separator(ctx: Context<GetDomainSeparator>) -> Result<Option<[u8; 32]>> {
        Ok(ctx.accounts.state.domain_separator)
    }

    pub fn cancel_operation(ctx: Context<CancelOperation>, operation_index: u8) -> Result<()> {
        let state = &mut ctx.accounts.state;

        // Only timelock authority can cancel operations
        require!(
            state
                .timelock_authorities
                .contains(&ctx.accounts.authority.key()),
            RbxError::UnauthorizedAccess
        );

        // Check if operation index is valid
        require!(
            (operation_index as usize) < state.pending_operations.len(),
            RbxError::InvalidOperationIndex
        );

        // Clone the operation to access its details for the event
        let operation = state.pending_operations[operation_index as usize].clone();

        // Remove the operation from the pending list
        state.pending_operations.remove(operation_index as usize);

        emit!(CancelOperationEvent {
            operation_type: operation.operation_type,
            authority: ctx.accounts.authority.key(),
        });

        Ok(())
    }

    pub fn stake_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        let state = &ctx.accounts.state;
        let token = ctx.accounts.mint.key();

        // Verify token is supported
        require!(
            ctx.accounts.state.supported_tokens.contains(&token),
            RbxError::UnsupportedToken
        );
        let min_deposit = state
            .get_min_deposit(&token)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);

        let stake_num = ctx.accounts.state.next_stake_num;
        ctx.accounts.state.next_stake_num += 1;

        // Create stake ID string with _rbx_sol suffix
        let mut stake_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        stake_id.push_str("s_");
        stake_id.push_str(&stake_num.to_string());
        stake_id.push_str("_rbx_sol");

        // Transfer tokens from user to program token account
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.program_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, amount)?;

        emit!(StakeEvent {
            id: stake_id,
            trader: ctx.accounts.user.key(),
            amount,
            token,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }

    pub fn stake_native(ctx: Context<DepositNative>, amount: u64) -> Result<()> {
        require!(
            ctx.accounts.state.reentry_lock_status == UNLOCKED,
            RbxError::ReentrancyDetected
        );

        ctx.accounts.state.reentry_lock_status = LOCKED;

        // Verify amount meets minimum
        let state = &ctx.accounts.state;
        let wrapped_sol = ctx.accounts.wrapped_sol_mint.key();

        let min_deposit = state
            .get_min_deposit(&wrapped_sol)
            .ok_or(RbxError::UnsupportedToken)?;

        require!(amount >= min_deposit, RbxError::AmountTooSmall);
        require!(
            amount <= ctx.accounts.user.lamports(),
            RbxError::InsufficientFunds
        );

        let stake_num = ctx.accounts.state.next_stake_num;
        ctx.accounts.state.next_stake_num += 1;

        // Create stake ID string with _rbx_sol suffix
        let mut stake_id = String::with_capacity(20); // Pre-allocate to avoid reallocation
        stake_id.push_str("s_");
        stake_id.push_str(&stake_num.to_string());
        stake_id.push_str("_rbx_sol");

        // Transfer SOL from user to program
        let ix = solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.program_sol_account.key(),
            amount,
        );

        solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.program_sol_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        emit!(StakeEvent {
            id: stake_id,
            trader: ctx.accounts.user.key(),
            amount,
            token: wrapped_sol,
        });

        ctx.accounts.state.reentry_lock_status = UNLOCKED;

        Ok(())
    }
}

fn process_withdrawal(
    _program_id: &Pubkey,
    state: &mut Account<State>,
    withdrawal_record: &mut Account<WithdrawalRecord>,
    id: u64,
    amount: u64,
    token: Pubkey,
    trader: Pubkey,
    v: u8,
    r: [u8; 32],
    s: [u8; 32],
) -> Result<()> {
    // Validate amount
    require!(amount > 0, RbxError::WrongAmount);

    // Initialize the withdrawal record if it's new
    if withdrawal_record.index == 0 {
        withdrawal_record.index = id / WITHDRAWALS_PER_ACCOUNT as u64;
        // No need to initialize processed_bits as they default to zero
    }

    // Check if withdrawal has already been processed
    require!(
        !withdrawal_record.is_processed(id),
        RbxError::WithdrawalAlreadyProcessed
    );

    // Construct the EIP712 digest
    let domain_separator = get_domain_separator(state);
    let withdrawal_hash = get_withdrawal_hash(id, token, trader, amount);

    // Create a prefixed message following EIP-712 spec
    let mut message = Vec::with_capacity(66); // 2 bytes prefix + 32 bytes domain_separator + 32 bytes withdrawal_hash
    message.push(0x19);
    message.push(0x01);
    message.extend_from_slice(&domain_separator);
    message.extend_from_slice(&withdrawal_hash);

    let digest = keccak256(&message);

    // Verify signature
    let sig_result = verify_secp256k1_signature(&digest, v, &r, &s, &state.withdrawal_signer)?;
    require!(sig_result, RbxError::InvalidSignature);

    // Mark the withdrawal as processed
    withdrawal_record.mark_processed(id);

    // Return success - the calling function will handle the actual transfer
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + State::SIZE,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub authority: Signer<'info>,
    /// CHECK: This is a token mint account
    pub default_token_mint: AccountInfo<'info>,
    /// CHECK: PDA for token account authority
    #[account(seeds = [b"token_authority"], bump)]
    pub program_token_authority: AccountInfo<'info>,
    /// CHECK: PDA for SOL account
    #[account(seeds = [b"sol_account"], bump)]
    pub program_sol_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SupportToken<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    /// CHECK: This is a token mint account
    pub token_mint: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,
    /// CHECK: Token account
    #[account(mut)]
    pub program_token_account: AccountInfo<'info>,
    /// CHECK: PDA for token account authority
    #[account(
        seeds = [b"token_authority"],
        bump = state.token_account_bump
    )]
    pub program_token_authority: AccountInfo<'info>,
    /// CHECK: User token account
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnsupportToken<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositToken<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    /// CHECK: SPL token mint - verified in the instruction
    pub mint: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: Program's token account for the specified mint
    pub program_token_account: AccountInfo<'info>,
    /// CHECK: PDA for token account authority
    pub program_token_authority: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: User's token account for the specified mint
    pub user_token_account: AccountInfo<'info>,
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositNative<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    /// CHECK: Wrapped SOL mint address for native SOL operations
    pub wrapped_sol_mint: AccountInfo<'info>,
    /// CHECK: PDA for program's SOL account
    #[account(
        mut,
        seeds = [b"sol_account"],
        bump = state.sol_account_bump,
    )]
    pub program_sol_account: AccountInfo<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64, amount: u64, v: u8, r: [u8; 32], s: [u8; 32])]
pub struct WithdrawToken<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WithdrawalRecord::SIZE,
        seeds = [b"withdrawal_account".as_ref(), &(id / WITHDRAWALS_PER_ACCOUNT as u64).to_le_bytes()],
        bump
    )]
    pub withdrawal_record: Account<'info, WithdrawalRecord>,

    /// CHECK: This is a token mint account
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Program's token account for the specified mint
    pub program_token_account: AccountInfo<'info>,

    /// CHECK: This is the PDA that signs for the program
    #[account(
        seeds = [b"token_authority".as_ref()],
        bump = state.token_account_bump
    )]
    pub program_token_authority: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Trader's token account for the specified mint
    pub trader_token_account: AccountInfo<'info>,

    /// CHECK: Trader account that will receive the tokens (doesn't need to sign)
    pub trader: AccountInfo<'info>,

    /// The account that signs the transaction and pays for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(id: u64, amount: u64, v: u8, r: [u8; 32], s: [u8; 32])]
pub struct WithdrawNative<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + WithdrawalRecord::SIZE,
        seeds = [b"withdrawal_account".as_ref(), &(id / WITHDRAWALS_PER_ACCOUNT as u64).to_le_bytes()],
        bump
    )]
    pub withdrawal_record: Account<'info, WithdrawalRecord>,

    /// CHECK: Wrapped SOL mint
    pub wrapped_sol_mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"sol_account".as_ref()],
        bump = state.sol_account_bump
    )]
    pub program_sol_account: SystemAccount<'info>,

    /// CHECK: Trader account that will receive the SOL (doesn't need to sign)
    #[account(mut)]
    pub trader: AccountInfo<'info>,

    /// The account that signs the transaction and pays for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct GetVersion {}

#[derive(Accounts)]
pub struct GetEip712VerifyingContract<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct ChangeSigner<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump,
        has_one = owner
    )]
    pub state: Account<'info, State>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct QueueOperation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteOperation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    // Include any other accounts needed for specific operations
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTimelockDelay<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetTimelockAuthority<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GetWithdrawalSigner<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct GetOwner<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct GetNextStakeNum<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct GetNextDepositNum<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct GetTimelockDelay<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct GetDomainSeparator<'info> {
    #[account(seeds = [b"state"], bump)]
    pub state: Account<'info, State>,
}

#[derive(Accounts)]
pub struct CancelOperation<'info> {
    #[account(
        mut,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, State>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct State {
    pub owner: Pubkey,
    pub withdrawal_signer: [u8; 20],
    pub next_deposit_num: u64,
    pub next_stake_num: u64,
    pub reentry_lock_status: u8,
    pub token_account_bump: u8,
    pub sol_account_bump: u8,
    pub supported_tokens: Vec<Pubkey>,
    pub min_deposits: Vec<(Pubkey, u64)>,
    pub timelock_authorities: Vec<Pubkey>,
    pub timelock_delay: i64,
    pub pending_operations: Vec<TimelockOperation>,
    pub domain_separator: Option<[u8; 32]>, // Cached domain separator
}

impl State {
    pub const SIZE: usize = 8 +  // discriminator
        32 + // owner
        20 + // withdrawal_signer
        8 +  // next_deposit_num
        8 +  // next_stake_num
        1 +  // reentry_lock_status
        1 +  // token_account_bump
        1 +  // sol_account_bump
        4 + (32 * MAX_SUPPORTED_TOKENS) + // Vec<Pubkey> for supported_tokens
        4 + (40 * MAX_SUPPORTED_TOKENS) + // Vec<(Pubkey, u64)> for min_deposits
        4 + (32 * MAX_AUTHORITIES) + // Vec<Pubkey> for timelock_authorities        
        8 +  // timelock_delay
        4 + (100 * 10) + // Vec<TimelockOperation> - estimated for 10 pending operations with ~100 bytes each
        1 + 32; // Option<[u8; 32]> for cached domain separator

    // Helper methods for min_deposits
    pub fn get_min_deposit(&self, token: &Pubkey) -> Option<u64> {
        self.min_deposits
            .iter()
            .find(|(t, _)| t == token)
            .map(|(_, amount)| *amount)
    }

    pub fn set_min_deposit(&mut self, token: Pubkey, amount: u64) {
        if let Some(idx) = self.min_deposits.iter().position(|(t, _)| t == &token) {
            self.min_deposits[idx] = (token, amount);
        } else {
            self.min_deposits.push((token, amount));
        }
    }

    pub fn remove_min_deposit(&mut self, token: &Pubkey) -> bool {
        if let Some(idx) = self.min_deposits.iter().position(|(t, _)| t == token) {
            self.min_deposits.remove(idx);
            true
        } else {
            false
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TimelockOperation {
    pub operation_type: u8,  // 1 = change_owner, 2 = change_signer, etc.
    pub data: Vec<u8>,       // Serialized operation parameters
    pub queued_at: i64,      // Timestamp when operation was queued
    pub can_execute_at: i64, // Timestamp when operation becomes executable
}

#[account]
pub struct WithdrawalRecord {
    pub index: u64,
    pub processed_bits: [u8; WITHDRAWAL_BITMAP_SIZE],
}

impl WithdrawalRecord {
    // Account size includes 8 bytes for anchor discriminator + index (8 bytes) + bitmap
    pub const SIZE: usize = 8 + 8 + WITHDRAWAL_BITMAP_SIZE;

    pub fn is_processed(&self, id: u64) -> bool {
        let bit_index = (id % WITHDRAWALS_PER_ACCOUNT as u64) as usize;
        let byte_index = bit_index / 8;
        let bit_position = bit_index % 8;
        (self.processed_bits[byte_index] & (1 << bit_position)) != 0
    }

    pub fn mark_processed(&mut self, id: u64) {
        let bit_index = (id % WITHDRAWALS_PER_ACCOUNT as u64) as usize;
        let byte_index = bit_index / 8;
        let bit_position = bit_index % 8;
        self.processed_bits[byte_index] |= 1 << bit_position;
    }
}

#[event]
pub struct DepositEvent {
    #[index]
    pub id: String,
    #[index]
    pub trader: Pubkey,
    pub amount: u64,
    pub token: Pubkey,
}

#[event]
pub struct StakeEvent {
    #[index]
    pub id: String,
    #[index]
    pub trader: Pubkey,
    pub amount: u64,
    pub token: Pubkey,
}

#[event]
pub struct WithdrawalEvent {
    #[index]
    pub id: u64,
    #[index]
    pub trader: Pubkey,
    pub amount: u64,
    pub token: Pubkey,
}

#[event]
pub struct SupportTokenEvent {
    #[index]
    pub token: Pubkey,
    pub min_deposit: u64,
}

#[event]
pub struct UnsupportTokenEvent {
    #[index]
    pub token: Pubkey,
}

#[event]
pub struct SetSignerEvent {
    #[index]
    pub signer: [u8; 20],
}

#[event]
pub struct QueueOperationEvent {
    pub operation_type: u8,
    pub execute_time: i64,
}

#[event]
pub struct ExecuteOperationEvent {
    pub operation_type: u8,
}

#[event]
pub struct CancelOperationEvent {
    pub operation_type: u8,
    pub authority: Pubkey,
}

#[event]
pub struct SetTimelockDelayEvent {
    pub delay: i64,
}

#[event]
pub struct SetTimelockAuthorityEvent {
    pub authority: Pubkey,
}

#[event]
pub struct InitializeEvent {
    pub owner: Pubkey,
    pub signer: [u8; 20],
    pub timelock_authorities: Vec<Pubkey>,
    pub timelock_delay: i64,
    pub default_token: Pubkey,
    pub min_deposit: u64,
}

#[event]
pub struct SetOwnerEvent {
    #[index]
    pub owner: Pubkey,
}

#[event]
pub struct AddAuthorityEvent {
    #[index]
    pub authority: Pubkey,
}

#[event]
pub struct RemoveAuthorityEvent {
    #[index]
    pub authority: Pubkey,
}

#[error_code]
pub enum RbxError {
    #[msg("Amount too small")]
    AmountTooSmall,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Already processed")]
    AlreadyProcessed,
    #[msg("Wrong amount")]
    WrongAmount,
    #[msg("Unsupported token")]
    UnsupportedToken,
    #[msg("Too many tokens")]
    TooManyTokens,
    #[msg("Invalid token mint")]
    InvalidToken,
    #[msg("Invalid signature format")]
    InvalidSignatureFormat,
    #[msg("Reentrancy detected")]
    ReentrancyDetected,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Invalid signer")]
    InvalidSigner,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    #[msg("Invalid operation index")]
    InvalidOperationIndex,
    #[msg("Timelock delay not met")]
    TimelockDelayNotMet,
    #[msg("Invalid operation type")]
    InvalidOperationType,
    #[msg("Invalid operation data")]
    InvalidOperationData,
    #[msg("Invalid timelock delay")]
    InvalidTimelockDelay,
    #[msg("Invalid authority")]
    InvalidAuthority,
    #[msg("Withdrawal already processed")]
    WithdrawalAlreadyProcessed,
    #[msg("Authority already exists")]
    AuthorityAlreadyExists,
    #[msg("Authority not found")]
    AuthorityNotFound,
    #[msg("Cannot remove the last authority")]
    CannotRemoveLastAuthority,
    #[msg("No authorities provided")]
    NoAuthoritiesProvided,
    #[msg("Too many authorities")]
    TooManyAuthorities,
    #[msg("Duplicate authority")]
    DuplicateAuthority,
}

// Helper functions for EIP712 signature verification

fn get_domain_separator(state: &mut Account<State>) -> [u8; 32] {
    // First check if we have a cached value in the state
    if let Some(cached) = state.domain_separator {
        return cached;
    }

    // If no cached value, compute it

    // Compute the domain separator components
    let name_hash = keccak256(DOMAIN_NAME);
    let version_hash = keccak256(DOMAIN_VERSION);
    // Use fixed chain ID value 0x534f4c414e41 (hex for "SOLANA" in ASCII)
    let chain_id: u64 = 0x534f4c414e41;
    // Need to pad to 32 bytes (pad with zeros)
    let mut chain_id_bytes = [0u8; 32];
    chain_id_bytes[24..32].copy_from_slice(&chain_id.to_be_bytes());
    let contract_bytes = state.key().to_bytes();

    // Perform the hashing
    let mut hasher = Keccak256::new();
    hasher.update(EIP712_DOMAIN_TYPEHASH);
    hasher.update(name_hash);
    hasher.update(version_hash);
    hasher.update(&chain_id_bytes);
    hasher.update(&contract_bytes);

    let result = hasher.finalize().into();

    // Cache the result in the state for future use
    state.domain_separator = Some(result);

    result
}

fn get_withdrawal_hash(id: u64, token: Pubkey, trader: Pubkey, amount: u64) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(WITHDRAWAL_TYPEHASH);
    hasher.update(&id.to_be_bytes());
    hasher.update(token.to_bytes());
    hasher.update(trader.to_bytes());
    hasher.update(&amount.to_be_bytes());
    hasher.finalize().into()
}

fn verify_secp256k1_signature(
    digest: &[u8; 32],
    v: u8,
    r: &[u8; 32],
    s: &[u8; 32],
    expected_signer: &[u8; 20],
) -> Result<bool> {
    // Adjust recovery ID for Ethereum compatibility (v should be 27 or 28)
    let recovery_id = if v >= 27 { v - 27 } else { v };

    // Validate recovery_id is either 0 or 1
    require!(recovery_id <= 1, RbxError::InvalidSignatureFormat);

    // Combine r and s into a single signature array
    let mut signature = [0u8; 64];
    signature[0..32].copy_from_slice(r);
    signature[32..64].copy_from_slice(s);

    let recovered_pubkey = match secp256k1_recover(digest, recovery_id, &signature) {
        Ok(pubkey) => pubkey,
        Err(err) => {
            // Convert the error to a string and include it in the error message
            msg!("Signature recovery error: {:?}", err);
            return Err(error!(RbxError::InvalidSignature));
        }
    };

    let recovered_signer_address = derive_eth_address(&recovered_pubkey.to_bytes());

    // Compare the Ethereum addresses directly
    let result = recovered_signer_address == *expected_signer;

    Ok(result)
}

// Function to derive an Ethereum address from a public key
fn derive_eth_address(pubkey: &[u8]) -> [u8; 20] {
    // First we need to ensure we have the uncompressed public key without the prefix byte
    let key_to_hash = if pubkey.len() == 64 {
        pubkey
    } else if pubkey.len() == 65 && (pubkey[0] == 0x04 || pubkey[0] == 0x00) {
        &pubkey[1..]
    } else {
        &pubkey[pubkey.len() - 64..]
    };

    // Hash the public key with Keccak256
    let mut hasher = Keccak256::new();
    hasher.update(key_to_hash);
    let hash = hasher.finalize();

    // Take the last 20 bytes of the hash result
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..32]);

    address
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = sha3::Keccak256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result);
    output
}
