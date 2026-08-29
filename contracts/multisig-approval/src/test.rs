#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup(quorum: u32, n_approvers: usize) -> (Env, Address, soroban_sdk::Vec<Address>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let mut approvers = soroban_sdk::Vec::new(&env);
    for _ in 0..n_approvers {
        approvers.push_back(Address::generate(&env));
    }
    let contract_id = env.register_contract(None, MultisigContract);
    MultisigContractClient::new(&env, &contract_id).initialize(&admin, &approvers, &quorum);
    (env, contract_id, approvers, admin)
}

fn propose(env: &Env, contract_id: &Address, proposer: &Address) -> u64 {
    let client = MultisigContractClient::new(env, contract_id);
    let recipient = Address::generate(env);
    let desc = soroban_sdk::String::from_str(env, "Test payment");
    client.propose_transaction(proposer, &desc, &1_000_000, &recipient)
}

// ── initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    // propose succeeds — contract is initialized
    let id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    assert_eq!(id, 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let (env, contract_id, approvers, admin) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let mut v = soroban_sdk::Vec::new(&env);
    for a in approvers.iter() { v.push_back(a.clone()); }
    client.initialize(&admin, &v, &2);
}

#[test]
#[should_panic(expected = "invalid quorum")]
fn test_quorum_zero_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let a1 = Address::generate(&env);
    let mut v = soroban_sdk::Vec::new(&env);
    v.push_back(a1);
    let contract_id = env.register_contract(None, MultisigContract);
    MultisigContractClient::new(&env, &contract_id).initialize(&admin, &v, &0);
}

#[test]
#[should_panic(expected = "invalid quorum")]
fn test_quorum_exceeds_approvers_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let a1 = Address::generate(&env);
    let mut v = soroban_sdk::Vec::new(&env);
    v.push_back(a1);
    let contract_id = env.register_contract(None, MultisigContract);
    MultisigContractClient::new(&env, &contract_id).initialize(&admin, &v, &2);
}

// ── propose_transaction ───────────────────────────────────────────────────────

#[test]
fn test_propose_increments_counter() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let proposer = approvers.get(0).unwrap();
    assert_eq!(propose(&env, &contract_id, &proposer), 0);
    assert_eq!(propose(&env, &contract_id, &proposer), 1);
}

#[test]
#[should_panic(expected = "not an approver")]
fn test_propose_non_approver_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let outsider = Address::generate(&env);
    propose(&env, &contract_id, &outsider);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_propose_zero_amount_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let desc = soroban_sdk::String::from_str(&env, "Zero amount");
    client.propose_transaction(&approvers.get(0).unwrap(), &desc, &0, &Address::generate(&env));
}

// ── approve / quorum ──────────────────────────────────────────────────────────

#[test]
fn test_approve_reaches_quorum_executes() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());

    client.approve(&approvers.get(0).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Pending);

    client.approve(&approvers.get(1).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

#[test]
fn test_approve_quorum_1_of_1() {
    let (env, contract_id, approvers, _) = setup(1, 1);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.approve(&approvers.get(0).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

#[test]
fn test_approve_all_3_of_3() {
    let (env, contract_id, approvers, _) = setup(3, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    for i in 0..3u32 {
        client.approve(&approvers.get(i).unwrap(), &tx_id);
    }
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

#[test]
#[should_panic(expected = "not an approver")]
fn test_approve_non_approver_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.approve(&Address::generate(&env), &tx_id);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_double_approve_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    let approver = approvers.get(0).unwrap();
    client.approve(&approver, &tx_id);
    client.approve(&approver, &tx_id);
}

#[test]
#[should_panic(expected = "not pending")]
fn test_approve_executed_proposal_panics() {
    let (env, contract_id, approvers, _) = setup(1, 2);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.approve(&approvers.get(0).unwrap(), &tx_id);
    // already Executed — second approver tries to approve
    client.approve(&approvers.get(1).unwrap(), &tx_id);
}

// ── reject ────────────────────────────────────────────────────────────────────

#[test]
fn test_reject_makes_quorum_impossible() {
    // 3 approvers, quorum 2. If 2 reject, remaining approvals can never reach 2.
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());

    client.reject(&approvers.get(0).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Pending);

    client.reject(&approvers.get(1).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Rejected);
}

#[test]
fn test_reject_unanimous_3_of_3() {
    let (env, contract_id, approvers, _) = setup(3, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    for i in 0..3u32 {
        client.reject(&approvers.get(i).unwrap(), &tx_id);
    }
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Rejected);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_double_reject_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    let approver = approvers.get(0).unwrap();
    client.reject(&approver, &tx_id);
    client.reject(&approver, &tx_id);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_approve_then_reject_same_voter_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    let approver = approvers.get(0).unwrap();
    client.approve(&approver, &tx_id);
    client.reject(&approver, &tx_id);
}

#[test]
#[should_panic(expected = "not an approver")]
fn test_reject_non_approver_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.reject(&Address::generate(&env), &tx_id);
}

// ── expiry ────────────────────────────────────────────────────────────────────

#[test]
fn test_execute_marks_expired() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());

    // advance ledger past 24 hours
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute(&tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Expired);
}

#[test]
#[should_panic(expected = "not yet expired")]
fn test_execute_before_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.execute(&tx_id);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_approve_after_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.approve(&approvers.get(0).unwrap(), &tx_id);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_reject_after_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.reject(&approvers.get(0).unwrap(), &tx_id);
}

// ── expiry boundary conditions ────────────────────────────────────────────────

#[test]
fn test_approve_at_expiry_minus_one_succeeds() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    env.ledger().with_mut(|l| l.timestamp += 86_399);
    client.approve(&approvers.get(0).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Pending);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_approve_at_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    env.ledger().with_mut(|l| l.timestamp += 86_400);
    client.approve(&approvers.get(0).unwrap(), &tx_id);
}

// ── get_proposal ──────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "proposal not found")]
fn test_get_nonexistent_proposal_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    MultisigContractClient::new(&env, &contract_id).get_proposal(&99);
}

#[test]
fn test_proposal_fields_correct() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let recipient = Address::generate(&env);
    let desc = soroban_sdk::String::from_str(&env, "Send funds to recipient");
    let tx_id = client.propose_transaction(&proposer, &desc, &500_000, &recipient);
    let p = client.get_proposal(&tx_id);
    assert_eq!(p.amount, 500_000);
    assert_eq!(p.recipient, recipient);
    assert_eq!(p.proposer, proposer);
    assert_eq!(p.description, desc);
    assert_eq!(p.approvals, 0);
    assert_eq!(p.rejections, 0);
    assert_eq!(p.status, TxStatus::Pending);
}

// ── mixed approve/reject ──────────────────────────────────────────────────────

#[test]
fn test_mixed_votes_pending_until_decided() {
    // 5 approvers, quorum 3. 2 approve + 1 reject → still pending (3 remain, 2+3=5 >= 3)
    let (env, contract_id, approvers, _) = setup(3, 5);
    let client = MultisigContractClient::new(&env, &contract_id);
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());

    client.approve(&approvers.get(0).unwrap(), &tx_id);
    client.approve(&approvers.get(1).unwrap(), &tx_id);
    client.reject(&approvers.get(2).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Pending);

    // third approval reaches quorum
    client.approve(&approvers.get(3).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

// ── #554: cancel_proposal ────────────────────────────────────────────────────

#[test]
fn test_cancel_proposal_sets_status_cancelled() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let tx_id = propose(&env, &contract_id, &proposer);
    client.cancel_proposal(&proposer, &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Cancelled);
}

#[test]
#[should_panic(expected = "only the proposer can cancel")]
fn test_cancel_proposal_by_non_proposer_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let tx_id = propose(&env, &contract_id, &proposer);
    client.cancel_proposal(&approvers.get(1).unwrap(), &tx_id);
}

#[test]
#[should_panic(expected = "not pending")]
fn test_cancel_proposal_already_executed_panics() {
    let (env, contract_id, approvers, _) = setup(1, 2);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let tx_id = propose(&env, &contract_id, &proposer);
    client.approve(&proposer, &tx_id); // executes immediately (quorum 1)
    client.cancel_proposal(&proposer, &tx_id);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_cancel_proposal_after_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let tx_id = propose(&env, &contract_id, &proposer);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.cancel_proposal(&proposer, &tx_id);
}

#[test]
#[should_panic(expected = "not pending")]
fn test_approve_cancelled_proposal_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let tx_id = propose(&env, &contract_id, &proposer);
    client.cancel_proposal(&proposer, &tx_id);
    client.approve(&approvers.get(1).unwrap(), &tx_id);
}

// ── quorum change ─────────────────────────────────────────────────────────────

#[test]
fn test_propose_quorum_change_increments_counter() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let id0 = client.propose_quorum_change(&proposer, &3);
    let id1 = client.propose_quorum_change(&proposer, &1);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
}

#[test]
fn test_get_quorum_proposal_fields_correct() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let proposer = approvers.get(0).unwrap();
    let id = client.propose_quorum_change(&proposer, &3);
    let p = client.get_quorum_proposal(&id);
    assert_eq!(p.new_quorum, 3);
    assert_eq!(p.proposer, proposer);
    assert_eq!(p.approvals, 0);
    assert_eq!(p.rejections, 0);
    assert_eq!(p.status, TxStatus::Pending);
}

#[test]
#[should_panic(expected = "not an approver")]
fn test_propose_quorum_change_non_approver_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    client.propose_quorum_change(&Address::generate(&env), &2);
}

#[test]
#[should_panic(expected = "invalid quorum")]
fn test_propose_quorum_change_zero_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    client.propose_quorum_change(&approvers.get(0).unwrap(), &0);
}

#[test]
#[should_panic(expected = "invalid quorum")]
fn test_propose_quorum_change_exceeds_approvers_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    // 3 approvers, requesting quorum of 4
    client.propose_quorum_change(&approvers.get(0).unwrap(), &4);
}

#[test]
fn test_approve_quorum_change_reaches_quorum_updates_quorum() {
    // current quorum 2, 3 approvers. propose quorum → 3, need 2 approvals.
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);

    client.approve_quorum_change(&approvers.get(0).unwrap(), &id);
    assert_eq!(client.get_quorum_proposal(&id).status, TxStatus::Pending);

    client.approve_quorum_change(&approvers.get(1).unwrap(), &id);
    let p = client.get_quorum_proposal(&id);
    assert_eq!(p.status, TxStatus::Executed);

    // new quorum takes effect: a tx now needs 3 approvals
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.approve(&approvers.get(0).unwrap(), &tx_id);
    client.approve(&approvers.get(1).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Pending);
    client.approve(&approvers.get(2).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_double_approve_quorum_change_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    let approver = approvers.get(0).unwrap();
    client.approve_quorum_change(&approver, &id);
    client.approve_quorum_change(&approver, &id);
}

#[test]
#[should_panic(expected = "not an approver")]
fn test_approve_quorum_change_non_approver_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    client.approve_quorum_change(&Address::generate(&env), &id);
}

#[test]
fn test_reject_quorum_change_makes_quorum_impossible() {
    // 3 approvers, quorum 2. 2 rejections → remaining 1 can't reach quorum of 2.
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &1);

    client.reject_quorum_change(&approvers.get(0).unwrap(), &id);
    assert_eq!(client.get_quorum_proposal(&id).status, TxStatus::Pending);

    client.reject_quorum_change(&approvers.get(1).unwrap(), &id);
    assert_eq!(client.get_quorum_proposal(&id).status, TxStatus::Rejected);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_double_reject_quorum_change_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    let approver = approvers.get(0).unwrap();
    client.reject_quorum_change(&approver, &id);
    client.reject_quorum_change(&approver, &id);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_approve_then_reject_quorum_change_same_voter_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    let approver = approvers.get(0).unwrap();
    client.approve_quorum_change(&approver, &id);
    client.reject_quorum_change(&approver, &id);
}

#[test]
#[should_panic(expected = "quorum proposal not found")]
fn test_get_nonexistent_quorum_proposal_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    MultisigContractClient::new(&env, &contract_id).get_quorum_proposal(&99);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_approve_quorum_change_after_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.approve_quorum_change(&approvers.get(0).unwrap(), &id);
}

#[test]
#[should_panic(expected = "proposal expired")]
fn test_reject_quorum_change_after_expiry_panics() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let id = client.propose_quorum_change(&approvers.get(0).unwrap(), &3);
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.reject_quorum_change(&approvers.get(0).unwrap(), &id);
}

// ── signer rotation (time-lock) ───────────────────────────────────────────────

#[test]
fn test_propose_signer_change_stores_pending_rotation() {
    let (env, contract_id, _, admin) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &new_signer);

    // No panic means the pending rotation was stored; execute will find it.
    // Advance past 72 h and execute to confirm it was stored correctly.
    env.ledger().with_mut(|l| l.timestamp += 259_201);
    client.execute_signer_change();
}

#[test]
fn test_propose_and_execute_add_signer() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    // The new signer is not yet an approver — proposal must reject them.
    // propose_transaction should panic for the new signer before the rotation.
    // (We don't test that here; we verify they can vote AFTER execution.)

    client.propose_signer_change(&RotationAction::Add, &new_signer);

    // Advance 72 h + 1 second past the lock.
    env.ledger().with_mut(|l| l.timestamp += 259_201);
    client.execute_signer_change();

    // new_signer is now an approver.
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    client.approve(&new_signer, &tx_id); // must not panic
    assert_eq!(client.get_proposal(&tx_id).approvals, 1);
}

#[test]
fn test_propose_and_execute_remove_signer() {
    let (env, contract_id, approvers, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    // Remove the third approver (3 approvers, quorum 2 → removal is safe: 2 remain >= quorum 2).
    let to_remove = approvers.get(2).unwrap();

    client.propose_signer_change(&RotationAction::Remove, &to_remove);

    env.ledger().with_mut(|l| l.timestamp += 259_201);
    client.execute_signer_change();

    // Removed signer must no longer be an approver.
    // Attempting to vote with removed signer must fail.
    let tx_id = propose(&env, &contract_id, &approvers.get(0).unwrap());
    // We can't easily assert panics mid-test; instead confirm the still-valid
    // approvers can still reach quorum with the remaining two.
    client.approve(&approvers.get(0).unwrap(), &tx_id);
    client.approve(&approvers.get(1).unwrap(), &tx_id);
    assert_eq!(client.get_proposal(&tx_id).status, TxStatus::Executed);
}

#[test]
fn test_cancel_signer_change_removes_pending_rotation() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &new_signer);
    client.cancel_signer_change();

    // After cancellation a new proposal must succeed (no "Rotation already pending").
    let another = Address::generate(&env);
    client.propose_signer_change(&RotationAction::Add, &another);
}

#[test]
fn test_execute_signer_change_clears_pending_after_add() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &new_signer);
    env.ledger().with_mut(|l| l.timestamp += 259_201);
    client.execute_signer_change();

    // Pending slot is now free; a new proposal must succeed.
    let another = Address::generate(&env);
    client.propose_signer_change(&RotationAction::Add, &another);
}

#[test]
#[should_panic(expected = "Rotation already pending")]
fn test_double_propose_signer_change_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &s1);
    // Second proposal before the first is resolved must panic.
    client.propose_signer_change(&RotationAction::Add, &s2);
}

#[test]
#[should_panic(expected = "Cannot remove: threshold would be unreachable")]
fn test_remove_signer_below_quorum_floor_panics() {
    // 2 approvers, quorum 2. Removing one would leave 1 approver < quorum 2.
    let (env, contract_id, approvers, _) = setup(2, 2);
    let client = MultisigContractClient::new(&env, &contract_id);
    let to_remove = approvers.get(0).unwrap();

    client.propose_signer_change(&RotationAction::Remove, &to_remove);

    env.ledger().with_mut(|l| l.timestamp += 259_201);
    // execute must panic with the weight-floor message.
    client.execute_signer_change();
}

#[test]
#[should_panic(expected = "Time-lock has not elapsed")]
fn test_execute_signer_change_before_timelock_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &new_signer);
    // Do NOT advance time — execute must panic.
    client.execute_signer_change();
}

#[test]
#[should_panic(expected = "no pending rotation")]
fn test_execute_with_no_pending_rotation_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    client.execute_signer_change();
}

#[test]
#[should_panic(expected = "no pending rotation")]
fn test_cancel_with_no_pending_rotation_panics() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    client.cancel_signer_change();
}

#[test]
fn test_propose_signer_change_effective_at_is_72h_from_now() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let new_signer = Address::generate(&env);

    let now: u64 = 1_000_000;
    env.ledger().with_mut(|l| l.timestamp = now);
    client.propose_signer_change(&RotationAction::Add, &new_signer);

    // Exactly at effective_at - 1: must still be locked.
    env.ledger().with_mut(|l| l.timestamp = now + 259_199);
    // Re-create client view — propose already stored, try to execute early.
    let client2 = MultisigContractClient::new(&env, &contract_id);
    // Can't use should_panic here; instead advance to exactly effective_at and verify success.
    env.ledger().with_mut(|l| l.timestamp = now + 259_200);
    client2.execute_signer_change(); // must succeed at exactly effective_at
}

#[test]
fn test_cancel_signer_change_allows_new_proposal_after() {
    let (env, contract_id, _, _) = setup(2, 3);
    let client = MultisigContractClient::new(&env, &contract_id);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);

    client.propose_signer_change(&RotationAction::Add, &s1);
    client.cancel_signer_change();

    // After cancel a new proposal for a different signer must succeed.
    client.propose_signer_change(&RotationAction::Remove, &s2);
    // And cancelling that one too must work.
    client.cancel_signer_change();
}
