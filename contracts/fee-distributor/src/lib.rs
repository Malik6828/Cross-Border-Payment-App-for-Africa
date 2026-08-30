#![no_std]

//! # Fee Distributor Contract
//!
//! On-chain platform fee accumulation and withdrawal for AfriPay.
//! Makes the fee model fully transparent and auditable on Stellar.
//!
//! ## Access control
//! - `deposit_fee`           — any caller (typically the backend service account)
//! - `get_accumulated_fees`  — public
//! - `get_all_accumulated_fees` — public
//! - `get_agent_pool_fees`   — public
//! - `withdraw_fees`         — admin only
//! - `withdraw_agent_pool`   — admin only
//! - `update_split`          — admin only

use soroban_sdk::{
    contract, contractimpl, contracttype, token, vec, Address, Env, Symbol, Vec,
};

mod test;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    /// The admin address authorised to withdraw fees and update settings.
    Admin,
    /// Per-token platform treasury accumulator.
    AccumulatedFees(Address),
    /// Per-token agent reward pool accumulator.
    AgentPoolFees(Address),
    /// Basis points allocated to the agent reward pool (0–5000).
    SplitBps,
    /// Ordered list of every token address that has ever received a deposit.
    /// Used by `get_all_accumulated_fees` to enumerate per-token balances.
    TokenList,
    UsdcAddress,
    AccumulatedFees,
    PlatformFeeBps,
    Paused,
}

// ── Event payloads ────────────────────────────────────────────────────────────

#[derive(Clone)]
#[contracttype]
pub struct EvtFeeDeposited {
    pub depositor: Address,
    pub token: Address,
    pub amount: i128,
    pub total: i128,
    pub source: Option<Address>,
}

#[derive(Clone)]
#[contracttype]
pub struct EvtFeesWithdrawn {
    pub admin: Address,
    pub token: Address,
    pub amount: i128,
    pub remaining: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct FeeRateUpdated {
    pub old_bps: u32,
    pub new_bps: u32,
    pub updated_by: Address,
/// Emitted when the admin changes the fee split ratio.
#[derive(Clone)]
#[contracttype]
pub struct EvtSplitUpdated {
    pub old_split_bps: u32,
    pub new_split_bps: u32,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Append `token` to the on-chain `TokenList` if it is not already present.
/// This is O(n) in the number of distinct tokens, which is expected to be small.
fn register_token(env: &Env, token: &Address) {
    let mut list: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::TokenList)
        .unwrap_or_else(|| vec![env]);

    if !list.contains(token) {
        list.push_back(token.clone());
        env.storage().persistent().set(&DataKey::TokenList, &list);
    }
#[derive(Clone)]
#[contracttype]
pub struct EvtContractPaused {
    pub admin: Address,
    pub paused_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct EvtContractUnpaused {
    pub admin: Address,
    pub unpaused_at: u64,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct FeeDistributorContract;

#[contractimpl]
impl FeeDistributorContract {
    /// Initialise the contract. Must be called once.
    ///
    /// # Arguments
    /// * `admin`            — Address authorised to withdraw accumulated fees.
    /// * `usdc_address`     — Stellar asset contract address for USDC.
    /// * `platform_fee_bps` — Platform fee rate in basis points (max 1000 = 10%).
    pub fn initialize(env: Env, admin: Address, usdc_address: Address, platform_fee_bps: u32) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if platform_fee_bps > 1000 {
            panic!("platform fee cannot exceed 1000 bps (10%)");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::UsdcAddress, &usdc_address);
        env.storage().persistent().set(&DataKey::AccumulatedFees, &0i128);
        env.storage().persistent().set(&DataKey::PlatformFeeBps, &platform_fee_bps);
    /// * `admin`     — Address authorised to withdraw accumulated fees.
    /// * `split_bps` — Basis points (0–5000) of each deposit routed to the
    ///                 agent reward pool. E.g. 2000 = 20 %. Must not exceed 5000.
    pub fn initialize(env: Env, admin: Address, split_bps: u32) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        if split_bps > 5000 {
            panic!("split_bps exceeds maximum of 5000");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::SplitBps, &split_bps);
        // Initialise an empty token list.
        let empty: Vec<Address> = vec![&env];
        env.storage().persistent().set(&DataKey::TokenList, &empty);
    }

    /// Deposit a platform fee into the contract for a specific token.
    ///
    /// Transfers `amount` of `token` from `depositor` into the contract and
    /// splits the deposit between the platform treasury
    /// (`AccumulatedFees(token)`) and the agent reward pool
    /// (`AgentPoolFees(token)`) according to the current `split_bps`.
    /// Emits a `FeeDeposited` event where `total` reflects the platform portion.
    ///
    /// # Arguments
    /// * `depositor` — Address sending the fee (must authorise this call).
    /// * `token`     — Asset contract address for the fee token (e.g. USDC or XLM).
    /// * `amount`    — Fee amount in token stroops (must be > 0).
    /// * `source`    — Optional originating address for audit purposes.
    pub fn deposit_fee(
        env: Env,
        depositor: Address,
        token: Address,
        amount: i128,
        source: Option<Address>,
    ) {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        if env.storage().persistent().get(&DataKey::Paused).unwrap_or(false) {
            panic!("Contract is paused");
        }

        depositor.require_auth();

        // Transfer the full amount from the depositor to this contract.
        token::Client::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        // Compute the agent-pool portion and the platform portion.
        let split_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::SplitBps)
            .unwrap_or(0);

        let agent_portion: i128 = amount * (split_bps as i128) / 10_000;
        let platform_portion: i128 = amount - agent_portion;

        // Update per-token platform treasury.
        let total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token.clone()))
            .unwrap_or(0)
            + platform_portion;
        env.storage()
            .persistent()
            .set(&DataKey::AccumulatedFees(token.clone()), &total);

        // Update per-token agent pool.
        let agent_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AgentPoolFees(token.clone()))
            .unwrap_or(0)
            + agent_portion;
        env.storage()
            .persistent()
            .set(&DataKey::AgentPoolFees(token.clone()), &agent_total);

        // Record this token so get_all_accumulated_fees can enumerate it.
        register_token(&env, &token);

        env.events().publish(
            (Symbol::new(&env, "FeeDeposited"),),
            EvtFeeDeposited { depositor, token, amount, total, source },
        );
    }

    /// Return the platform-treasury fees accumulated for a specific token.
    pub fn get_accumulated_fees(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token))
            .unwrap_or(0)
    }

    /// Return all non-zero per-token platform-treasury accumulators.
    ///
    /// Returns a `Vec` of `(token_address, accumulated_amount)` pairs for every
    /// token that has ever had a deposit. Entries with a zero balance are
    /// included (the accumulator may have been fully withdrawn).
    pub fn get_all_accumulated_fees(env: Env) -> Vec<(Address, i128)> {
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::TokenList)
            .unwrap_or_else(|| vec![&env]);

        let mut result: Vec<(Address, i128)> = Vec::new(&env);
        for token in list.iter() {
            let bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::AccumulatedFees(token.clone()))
                .unwrap_or(0);
            if bal > 0 {
                result.push_back((token.clone(), bal));
            }
        }
        result
    }

    /// Return the agent-reward-pool fees accumulated for a specific token.
    pub fn get_agent_pool_fees(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AgentPoolFees(token))
            .unwrap_or(0)
    }

    /// Withdraw platform-treasury fees for a specific token to the admin address.
    ///
    /// Only the admin may call this. Emits a `FeesWithdrawn` event.
    ///
    /// # Arguments
    /// * `admin`  — Must match the admin set during `initialize`.
    /// * `token`  — Asset to withdraw.
    /// * `amount` — Amount to withdraw (must not exceed accumulated fees for that token).
    pub fn withdraw_fees(env: Env, admin: Address, token: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        if env.storage().persistent().get(&DataKey::Paused).unwrap_or(false) {
            panic!("Contract is paused");
        }

        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized: caller is not admin");
        }

        let accumulated: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token.clone()))
            .unwrap_or(0);
        if amount > accumulated {
            panic!("insufficient accumulated fees");
        }

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &admin,
            &amount,
        );

        let remaining = accumulated - amount;
        env.storage()
            .persistent()
            .set(&DataKey::AccumulatedFees(token.clone()), &remaining);

        env.events().publish(
            (Symbol::new(&env, "FeesWithdrawn"),),
            EvtFeesWithdrawn {
                admin,
                token,
                amount,
                remaining,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Withdraw agent-reward-pool fees for a specific token to the admin address.
    ///
    /// Only the admin may call this. Emits a `FeesWithdrawn` event.
    ///
    /// # Arguments
    /// * `admin`  — Must match the admin set during `initialize`.
    /// * `token`  — Asset to withdraw.
    /// * `amount` — Amount to withdraw (must not exceed agent pool balance for that token).
    pub fn withdraw_agent_pool(env: Env, admin: Address, token: Address, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }

        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized: caller is not admin");
        }

        let pool_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AgentPoolFees(token.clone()))
            .unwrap_or(0);
        if amount > pool_balance {
            panic!("insufficient agent pool fees");
        }

        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &admin,
            &amount,
        );

        let remaining = pool_balance - amount;
        env.storage()
            .persistent()
            .set(&DataKey::AgentPoolFees(token.clone()), &remaining);

        env.events().publish(
            (Symbol::new(&env, "FeesWithdrawn"),),
            EvtFeesWithdrawn {
                admin,
                token,
                amount,
                remaining,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Return the current platform fee rate in basis points.
    pub fn get_fee_rate(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::PlatformFeeBps)
            .expect("not initialized")
    }

    /// Update the platform fee rate. Admin-only.
    ///
    /// # Arguments
    /// * `new_bps` — New fee rate in basis points (max 1000 = 10%).
    pub fn update_fee_rate(env: Env, new_bps: u32) {
        let admin: Address = env
    /// Update the fee split ratio between the platform treasury and agent pool.
    ///
    /// Only the admin may call this. Emits a `SplitUpdated` event.
    ///
    /// # Arguments
    /// * `admin`         — Must match the admin set during `initialize`.
    /// * `new_split_bps` — New basis-point allocation for the agent pool (0–5000).
    pub fn update_split(env: Env, admin: Address, new_split_bps: u32) {
        if new_split_bps > 5000 {
            panic!("split_bps exceeds maximum of 5000");
        }

        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized: caller is not admin");
        }

        let old_split_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::SplitBps)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::SplitBps, &new_split_bps);

        env.events().publish(
            (Symbol::new(&env, "SplitUpdated"),),
            EvtSplitUpdated { old_split_bps, new_split_bps },
        );
    }

    /// Pause the contract, preventing `deposit_fee` and `withdraw_fees` calls.
    ///
    /// Only the admin may call this. Emits a `ContractPaused` event.
    /// Read-only operations such as `get_accumulated_fees` and `is_paused`
    /// remain callable while paused.
    ///
    /// # Arguments
    /// * `admin` — Must match the admin set during `initialize`.
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        if new_bps > 1000 {
            panic!("fee rate cannot exceed 1000 bps (10%)");
        }

        let old_bps: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::PlatformFeeBps, &new_bps);

        env.events().publish(
            (Symbol::new(&env, "FeeRateUpdated"),),
            FeeRateUpdated {
                old_bps,
                new_bps,
                updated_by: admin,
            },
        );
    }
        if admin != stored_admin {
            panic!("unauthorized: caller is not admin");
        }

        env.storage().persistent().set(&DataKey::Paused, &true);

        env.events().publish(
            (Symbol::new(&env, "ContractPaused"),),
            EvtContractPaused { admin, paused_at: env.ledger().timestamp() },
        );
    }

    /// Unpause the contract, re-enabling `deposit_fee` and `withdraw_fees`.
    ///
    /// Only the admin may call this. Emits a `ContractUnpaused` event.
    ///
    /// # Arguments
    /// * `admin` — Must match the admin set during `initialize`.
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if admin != stored_admin {
            panic!("unauthorized: caller is not admin");
        }

        env.storage().persistent().set(&DataKey::Paused, &false);

        env.events().publish(
            (Symbol::new(&env, "ContractUnpaused"),),
            EvtContractUnpaused { admin, unpaused_at: env.ledger().timestamp() },
        );
    }

    /// Return `true` if the contract is currently paused, `false` otherwise.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }
}
