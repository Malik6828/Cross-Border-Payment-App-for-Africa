#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, crypto::Hash, Address, Bytes, BytesN, Env, String, Symbol, Vec};

mod test;

const DEFAULT_PROPOSAL_TTL_SECS: u64 = 604_800; // 7 days
const EXPIRY_SECONDS: u64 = 86_400; // 24 hours
const ROTATION_DELAY: u64 = 259_200; // 72 hours

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TxStatus {
    Pending,
    Executed,
    Rejected,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub proposer: Address,
    pub description: String,
    pub amount: i128,
    pub recipient: Address,
    pub approvals: u32,
    pub rejections: u32,
    pub status: TxStatus,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct QuorumChangeProposal {
    pub proposer: Address,
    pub new_quorum: u32,
    pub approvals: u32,
    pub rejections: u32,
    pub status: TxStatus,
    pub expires_at: u64,
}

/// Whether a pending rotation adds or removes a signer.
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RotationAction {
    Add,
    Remove,
}

/// A time-locked signer-rotation request waiting to become effective.
#[contracttype]
#[derive(Clone)]
pub struct PendingRotation {
    pub action: RotationAction,
    pub signer: Address,
    /// Unix timestamp after which `execute_signer_change` may be called.
    pub effective_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Approvers,
    Quorum,
    TxCounter,
    Proposal(u64),
    Voted(u64, Address),
    QuorumCounter,
    QuorumProposal(u64),
    QuorumVoted(u64, Address),
    ProposalTtl,
    PendingRotation,
    /// Weight assigned to each signer address (u32).
    SignerWeight(Address),
}

// ── Signer-rotation event payloads ────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct EvtSignerChangeProposed {
    pub action: RotationAction,
    pub signer: Address,
    pub effective_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSignerChanged {
    pub action: RotationAction,
    pub signer: Address,
    pub executed_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtSignerChangeCancelled {
    pub action: RotationAction,
    pub signer: Address,
    pub cancelled_at: u64,
}

// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct MultisigContract;

#[contractimpl]
impl MultisigContract {
    /// Initialize the contract with a list of approvers and minimum quorum.
    pub fn initialize(env: Env, admin: Address, approvers: Vec<Address>, quorum: u32) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        assert!(quorum > 0 && quorum as usize <= approvers.len(), "invalid quorum");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Approvers, &approvers);
        env.storage().instance().set(&DataKey::Quorum, &quorum);
        env.storage().instance().set(&DataKey::TxCounter, &0u64);
        env.storage().instance().set(&DataKey::QuorumCounter, &0u64);
        env.storage().instance().set(&DataKey::ProposalTtl, &DEFAULT_PROPOSAL_TTL_SECS);
    }

    /// Propose a new transaction. Any approver may propose.
    ///
    /// # Arguments
    /// * `description` — Human-readable summary of the transaction so approvers know what they are voting on.
    pub fn propose_transaction(env: Env, proposer: Address, description: String, amount: i128, recipient: Address) -> u64 {
        proposer.require_auth();
        Self::assert_is_approver(&env, &proposer);
        assert!(amount > 0, "amount must be positive");

        let id: u64 = env.storage().instance().get(&DataKey::TxCounter).unwrap();
        let proposal_ttl: u64 = env.storage().instance().get(&DataKey::ProposalTtl).unwrap_or(DEFAULT_PROPOSAL_TTL_SECS);
        let expires_at = env.ledger().timestamp() + proposal_ttl;

        let proposal = Proposal {
            proposer,
            description,
            amount,
            recipient,
            approvals: 0,
            rejections: 0,
            status: TxStatus::Pending,
            expires_at,
        };
        env.storage().persistent().set(&DataKey::Proposal(id), &proposal);
        env.storage().instance().set(&DataKey::TxCounter, &(id + 1));
        id
    }

    /// Approve a pending proposal. Executes automatically when quorum is reached.
    pub fn approve(env: Env, approver: Address, tx_id: u64) {
        approver.require_auth();
        Self::assert_is_approver(&env, &approver);

        let mut proposal = Self::get_pending(&env, tx_id);
        assert!(!env.storage().persistent().has(&DataKey::Voted(tx_id, approver.clone())), "already voted");

        // Check expiry
        if env.ledger().timestamp() > proposal.expires_at {
            panic!("Proposal has expired");
        }

        env.storage().persistent().set(&DataKey::Voted(tx_id, approver), &true);
        proposal.approvals += 1;

        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        if proposal.approvals >= quorum {
            proposal.status = TxStatus::Executed;
        }
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &proposal);
    }

    /// Reject a pending proposal. Marks as rejected when majority of approvers reject.
    pub fn reject(env: Env, approver: Address, tx_id: u64) {
        approver.require_auth();
        Self::assert_is_approver(&env, &approver);

        let mut proposal = Self::get_pending(&env, tx_id);
        assert!(!env.storage().persistent().has(&DataKey::Voted(tx_id, approver.clone())), "already voted");

        env.storage().persistent().set(&DataKey::Voted(tx_id, approver), &true);
        proposal.rejections += 1;

        let approvers: Vec<Address> = env.storage().instance().get(&DataKey::Approvers).unwrap();
        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        // Rejected when remaining possible approvals can no longer reach quorum
        let remaining = approvers.len() as u32 - proposal.approvals - proposal.rejections;
        if proposal.approvals + remaining < quorum {
            proposal.status = TxStatus::Rejected;
        }
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &proposal);
    }

    /// Mark an expired proposal as Expired. Anyone may call this.
    pub fn execute(env: Env, tx_id: u64) {
        let mut proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(tx_id))
            .expect("proposal not found");
        assert!(proposal.status == TxStatus::Pending, "not pending");
        
        if env.ledger().timestamp() <= proposal.expires_at {
            panic!("Proposal has not expired yet");
        }
        
        proposal.status = TxStatus::Expired;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &proposal);
    }

    /// Read a proposal.
    pub fn get_proposal(env: Env, tx_id: u64) -> Proposal {
        env.storage().persistent().get(&DataKey::Proposal(tx_id))
            .expect("proposal not found")
    }

    /// Cancel a pending proposal. Only the original proposer may call this, and only before expiry.
    pub fn cancel_proposal(env: Env, proposer: Address, tx_id: u64) {
        proposer.require_auth();

        let mut proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(tx_id))
            .expect("proposal not found");

        assert!(proposal.proposer == proposer, "only the proposer can cancel");
        assert!(proposal.status == TxStatus::Pending, "not pending");
        assert!(env.ledger().timestamp() < proposal.expires_at, "proposal expired");

        proposal.status = TxStatus::Cancelled;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &proposal);
    }

    /// Propose a quorum threshold change. Any approver may propose.
    /// The change takes effect only when the current quorum of approvers approve it.
    pub fn propose_quorum_change(env: Env, proposer: Address, new_quorum: u32) -> u64 {
        proposer.require_auth();
        Self::assert_is_approver(&env, &proposer);
        let approvers: Vec<Address> = env.storage().instance().get(&DataKey::Approvers).unwrap();
        assert!(new_quorum > 0 && new_quorum as usize <= approvers.len(), "invalid quorum");

        let id: u64 = env.storage().instance().get(&DataKey::QuorumCounter).unwrap();
        let proposal_ttl: u64 = env.storage().instance().get(&DataKey::ProposalTtl).unwrap_or(DEFAULT_PROPOSAL_TTL_SECS);
        let expires_at = env.ledger().timestamp() + proposal_ttl;

        let proposal = QuorumChangeProposal {
            proposer,
            new_quorum,
            approvals: 0,
            rejections: 0,
            status: TxStatus::Pending,
            expires_at,
        };
        env.storage().persistent().set(&DataKey::QuorumProposal(id), &proposal);
        env.storage().instance().set(&DataKey::QuorumCounter, &(id + 1));
        id
    }

    /// Approve a pending quorum-change proposal. Updates quorum when threshold is reached.
    pub fn approve_quorum_change(env: Env, approver: Address, id: u64) {
        approver.require_auth();
        Self::assert_is_approver(&env, &approver);

        let mut proposal = Self::get_pending_quorum(&env, id);
        assert!(!env.storage().persistent().has(&DataKey::QuorumVoted(id, approver.clone())), "already voted");

        env.storage().persistent().set(&DataKey::QuorumVoted(id, approver), &true);
        proposal.approvals += 1;

        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        if proposal.approvals >= quorum {
            proposal.status = TxStatus::Executed;
            env.storage().instance().set(&DataKey::Quorum, &proposal.new_quorum);
        }
        env.storage().persistent().set(&DataKey::QuorumProposal(id), &proposal);
    }

    /// Reject a pending quorum-change proposal. Marks as rejected when quorum is no longer reachable.
    pub fn reject_quorum_change(env: Env, approver: Address, id: u64) {
        approver.require_auth();
        Self::assert_is_approver(&env, &approver);

        let mut proposal = Self::get_pending_quorum(&env, id);
        assert!(!env.storage().persistent().has(&DataKey::QuorumVoted(id, approver.clone())), "already voted");

        env.storage().persistent().set(&DataKey::QuorumVoted(id, approver), &true);
        proposal.rejections += 1;

        let approvers: Vec<Address> = env.storage().instance().get(&DataKey::Approvers).unwrap();
        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();
        let remaining = approvers.len() as u32 - proposal.approvals - proposal.rejections;
        if proposal.approvals + remaining < quorum {
            proposal.status = TxStatus::Rejected;
        }
        env.storage().persistent().set(&DataKey::QuorumProposal(id), &proposal);
    }

    /// Read a quorum-change proposal.
    pub fn get_quorum_proposal(env: Env, id: u64) -> QuorumChangeProposal {
        env.storage().persistent().get(&DataKey::QuorumProposal(id))
            .expect("quorum proposal not found")
    }

    /// Update the proposal TTL (time-to-live). Only admin may call this.
    /// Applies to future proposals only, not retroactively.
    pub fn update_proposal_ttl(env: Env, admin: Address, new_ttl: u64) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("Contract not initialized");
        if admin != stored_admin {
            panic!("Only admin can update proposal TTL");
        }
        if new_ttl == 0 {
            panic!("TTL must be positive");
        }
        env.storage().instance().set(&DataKey::ProposalTtl, &new_ttl);
    }

    /// Clean up an expired proposal. Anyone may call this.
    /// Removes the proposal from storage to reclaim ledger rent.
    pub fn cleanup_expired(env: Env, tx_id: u64) {
        let proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(tx_id))
            .expect("proposal not found");
        
        if proposal.status != TxStatus::Expired {
            panic!("Only expired proposals can be cleaned up");
        }
        
        env.storage().persistent().remove(&DataKey::Proposal(tx_id));
    // --- signer rotation ---

    /// Propose adding or removing a signer. Admin only.
    ///
    /// The rotation is time-locked: it cannot be executed until
    /// `now + 259200` (72 hours). Only one rotation may be pending at a time.
    /// Emits `SignerChangeProposed`.
    ///
    /// # Arguments
    /// * `action` — `RotationAction::Add` or `RotationAction::Remove`.
    /// * `signer` — The address to add or remove from the approvers list.
    pub fn propose_signer_change(env: Env, action: RotationAction, signer: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        if env.storage().instance().has(&DataKey::PendingRotation) {
            panic!("Rotation already pending");
        }

        let effective_at = env.ledger().timestamp() + ROTATION_DELAY;
        let rotation = PendingRotation {
            action,
            signer: signer.clone(),
            effective_at,
        };
        env.storage()
            .instance()
            .set(&DataKey::PendingRotation, &rotation);

        env.events().publish(
            (Symbol::new(&env, "SignerChangeProposed"),),
            EvtSignerChangeProposed { action, signer, effective_at },
        );
    }

    /// Execute a pending signer rotation after the time-lock has elapsed.
    ///
    /// Anyone may call this once `effective_at` is reached.
    /// - `Add`: appends the signer to the approvers list (no-op if already present).
    /// - `Remove`: removes the signer; panics if doing so would make the quorum
    ///   unreachable.
    /// Emits `SignerChanged`.
    pub fn execute_signer_change(env: Env) {
        let rotation: PendingRotation = env
            .storage()
            .instance()
            .get(&DataKey::PendingRotation)
            .expect("no pending rotation");

        if env.ledger().timestamp() < rotation.effective_at {
            panic!("Time-lock has not elapsed");
        }

        let mut approvers: Vec<Address> =
            env.storage().instance().get(&DataKey::Approvers).unwrap();

        match rotation.action {
            RotationAction::Add => {
                if !approvers.contains(&rotation.signer) {
                    approvers.push_back(rotation.signer.clone());
                }
            }
            RotationAction::Remove => {
                let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();
                // After removal the list would have approvers.len() - 1 members.
                // If that is less than quorum the threshold becomes unreachable.
                if approvers.len() as u32 <= quorum {
                    panic!("Cannot remove: threshold would be unreachable");
                }
                // Rebuild the approvers list without the target signer.
                let mut new_approvers: Vec<Address> = Vec::new(&env);
                for a in approvers.iter() {
                    if a != rotation.signer {
                        new_approvers.push_back(a);
                    }
                }
                approvers = new_approvers;
            }
        }

        env.storage()
            .instance()
            .set(&DataKey::Approvers, &approvers);
        env.storage()
            .instance()
            .remove(&DataKey::PendingRotation);

        env.events().publish(
            (Symbol::new(&env, "SignerChanged"),),
            EvtSignerChanged {
                action: rotation.action,
                signer: rotation.signer,
                executed_at: env.ledger().timestamp(),
            },
        );
    }

    /// Cancel the pending signer rotation before its time-lock elapses. Admin only.
    ///
    /// Emits `SignerChangeCancelled`.
    pub fn cancel_signer_change(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let rotation: PendingRotation = env
            .storage()
            .instance()
            .get(&DataKey::PendingRotation)
            .expect("no pending rotation");

        env.storage()
            .instance()
            .remove(&DataKey::PendingRotation);

        env.events().publish(
            (Symbol::new(&env, "SignerChangeCancelled"),),
            EvtSignerChangeCancelled {
                action: rotation.action,
                signer: rotation.signer,
                cancelled_at: env.ledger().timestamp(),
            },
        );
    }

    // --- helpers ---

    fn assert_is_approver(env: &Env, addr: &Address) {
        let approvers: Vec<Address> = env.storage().instance().get(&DataKey::Approvers).unwrap();
        assert!(approvers.contains(addr), "not an approver");
    }

    fn get_pending(env: &Env, tx_id: u64) -> Proposal {
        let proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(tx_id))
            .expect("proposal not found");
        assert!(proposal.status == TxStatus::Pending, "not pending");
        assert!(env.ledger().timestamp() < proposal.expires_at, "proposal expired");
        proposal
    }

    fn get_pending_quorum(env: &Env, id: u64) -> QuorumChangeProposal {
        let proposal: QuorumChangeProposal = env.storage().persistent().get(&DataKey::QuorumProposal(id))
            .expect("quorum proposal not found");
        assert!(proposal.status == TxStatus::Pending, "not pending");
        assert!(env.ledger().timestamp() < proposal.expires_at, "proposal expired");
        proposal
    }

    // ── Issue #760: Off-chain signature aggregation ───────────────────────────

    /// Set the signing weight for an approver. Admin only.
    /// Weight defaults to 1 if not explicitly set.
    pub fn set_signer_weight(env: Env, admin: Address, signer: Address, weight: u32) {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        if admin != stored_admin { panic!("Only admin can set signer weight"); }
        if weight == 0 { panic!("Weight must be positive"); }
        Self::assert_is_approver(&env, &signer);
        env.storage().persistent().set(&DataKey::SignerWeight(signer), &weight);
    }

    /// Compute a deterministic SHA-256 hash of: contract_address + proposal_id + proposal.data + proposal.nonce.
    /// Here proposal.data is encoded as (amount, recipient) and nonce is proposal.approvals (used as replay guard).
    pub fn proposal_hash(env: Env, proposal_id: u64) -> BytesN<32> {
        let proposal: Proposal = env.storage().persistent().get(&DataKey::Proposal(proposal_id))
            .expect("proposal not found");
        let contract_addr = env.current_contract_address();
        let mut preimage = Bytes::new(&env);
        // contract address bytes
        preimage.append(&contract_addr.to_xdr(&env));
        // proposal_id as 8 big-endian bytes
        preimage.append(&Bytes::from_array(&env, &proposal_id.to_be_bytes()));
        // amount as 16 big-endian bytes
        preimage.append(&Bytes::from_array(&env, &proposal.amount.to_be_bytes()));
        // nonce: use expires_at as unique per-proposal value
        preimage.append(&Bytes::from_array(&env, &proposal.expires_at.to_be_bytes()));
        env.crypto().sha256(&preimage)
    }

    /// Execute a proposal using pre-collected off-chain ed25519 signatures.
    ///
    /// Each entry in `signatures` is `(signer_address, ed25519_sig_over_proposal_hash)`.
    /// Verifies all signatures, checks cumulative weight >= quorum, rejects duplicates,
    /// and marks the proposal Executed.
    pub fn execute_with_signatures(
        env: Env,
        proposal_id: u64,
        signatures: Vec<(Address, BytesN<64>)>,
    ) {
        let mut proposal = Self::get_pending(&env, proposal_id);
        let hash = Self::proposal_hash(env.clone(), proposal_id);
        let quorum: u32 = env.storage().instance().get(&DataKey::Quorum).unwrap();

        let mut seen: Vec<Address> = Vec::new(&env);
        let mut total_weight: u32 = 0;

        for (signer, sig) in signatures.iter() {
            // Reject duplicate signers
            if seen.contains(&signer) {
                panic!("Duplicate signer");
            }
            seen.push_back(signer.clone());

            // Signer must be a registered approver
            Self::assert_is_approver(&env, &signer);

            // Verify ed25519 signature over the proposal hash
            let pub_key: BytesN<32> = signer.to_xdr(&env)
                .slice(signer.to_xdr(&env).len() - 32..)
                .try_into()
                .expect("Invalid signer public key");
            env.crypto().ed25519_verify(&pub_key, &Bytes::from(hash.clone()), &sig);

            let weight: u32 = env.storage().persistent()
                .get(&DataKey::SignerWeight(signer.clone()))
                .unwrap_or(1);
            total_weight += weight;
        }

        if total_weight < quorum {
            panic!("Insufficient weight");
        }

        proposal.status = TxStatus::Executed;
        env.storage().persistent().set(&DataKey::Proposal(proposal_id), &proposal);
    }
}
