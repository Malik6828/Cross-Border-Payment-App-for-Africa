#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, IntoVal, Symbol, Val,
};

use crate::{
    CONTRACT_VERSION, EscrowContract, EscrowContractClient, EscrowExpired, EscrowStatus,
    FeesWithdrawn, PartialRelease,
};

fn setup() -> (Env, EscrowContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, EscrowContract);
    let client = EscrowContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let usdc_id = env.register_stellar_asset_contract_v2(admin.clone()).address();
    client.initialize(&admin, &usdc_id);
    (env, client, admin, usdc_id)
}

fn mint_usdc(env: &Env, usdc_id: &Address, _admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, usdc_id).mint(to, &amount);
}

#[test]
fn test_initialize() {
    let (_, client, admin, usdc_id) = setup();
    let (stored_admin, stored_usdc) = client.get_metadata();
    assert_eq!(stored_admin, admin);
    assert_eq!(stored_usdc, usdc_id);
    assert_eq!(client.get_contract_version(), CONTRACT_VERSION);
}

#[test]
fn test_migrate_sets_contract_version() {
    let (_, client, admin, _) = setup();
    assert_eq!(client.get_contract_version(), CONTRACT_VERSION);
    client.migrate(&admin);
    assert_eq!(client.get_contract_version(), CONTRACT_VERSION);
}

#[test]
#[should_panic(expected = "Only admin can perform this action")]
fn test_non_admin_cannot_migrate() {
    let (env, client, _, _) = setup();
    let non_admin = Address::generate(&env);
    client.migrate(&non_admin);
}

#[test]
#[should_panic(expected = "Contract already initialized")]
fn test_double_initialize() {
    let (_, client, admin, usdc_id) = setup();
    client.initialize(&admin, &usdc_id);
}

#[test]
fn test_create_escrow() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    assert_eq!(escrow_id, 1);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.sender, sender);
    assert_eq!(escrow.recipient, recipient);
    assert_eq!(escrow.agent, agent);
    assert_eq!(escrow.amount, amount);
    assert_eq!(escrow.release_fee_bps, 250);
    assert_eq!(escrow.status, EscrowStatus::Pending);
}

#[test]
fn test_create_multiple_escrows() {
    let (env, client, admin, usdc_id) = setup();
    let sender1 = Address::generate(&env);
    let sender2 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender1, 1_000_0000000);
    mint_usdc(&env, &usdc_id, &admin, &sender2, 500_0000000);

    let id1 = client.create_escrow(&sender1, &recipient, &agent, &1_000_0000000, &250);
    let id2 = client.create_escrow(&sender2, &recipient, &agent, &500_0000000, &100);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_escrow(&id1).sender, sender1);
    assert_eq!(client.get_escrow(&id2).sender, sender2);
}

// --- #352: fee boundary and minimum amount tests ---

#[test]
#[should_panic(expected = "Amount below minimum (100 stroops)")]
fn test_amount_below_minimum() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 99);
    client.create_escrow(&sender, &recipient, &agent, &1, &250);
}

#[test]
#[should_panic(expected = "Fee cannot be 100%")]
fn test_fee_exactly_10000_rejected() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &10000);
}

#[test]
#[should_panic(expected = "Fee exceeds maximum of 1000 bps (10%)")]
fn test_fee_9999_rejected() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &9999);
}

#[test]
fn test_fee_at_max_1000_accepted() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &1000);
    assert_eq!(client.get_escrow(&escrow_id).release_fee_bps, 1000);
}

#[test]
#[should_panic(expected = "Fee exceeds maximum of 1000 bps (10%)")]
fn test_fee_bps_1001_rejected() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &1001);
}

#[test]
#[should_panic(expected = "Amount exceeds maximum escrow amount")]
fn test_amount_above_max_rejected() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let over_max = 10_000_000_000_001i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, over_max);
    client.create_escrow(&sender, &recipient, &agent, &over_max, &250);
}

#[test]
fn test_amount_at_max_accepted() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let max_amount = 10_000_000_000_000i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, max_amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &max_amount, &250);
    assert_eq!(client.get_escrow(&escrow_id).amount, max_amount);
}

// ── #560: fuzz-style boundary tests for fee_bps valid range ──────────────────

#[test]
fn test_fee_bps_zero_accepted() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &0);
    assert_eq!(client.get_escrow(&escrow_id).release_fee_bps, 0);
}

#[test]
fn test_fee_bps_one_accepted() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &1);
    assert_eq!(client.get_escrow(&escrow_id).release_fee_bps, 1);
}

#[test]
fn test_fee_bps_999_accepted() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &999);
    assert_eq!(client.get_escrow(&escrow_id).release_fee_bps, 999);
}

// --- #354: upgrade access control test ---

#[test]
#[should_panic(expected = "Only admin can upgrade the contract")]
fn test_non_admin_cannot_upgrade() {
    let (env, client, _, _) = setup();
    let non_admin = Address::generate(&env);
    let fake_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&non_admin, &fake_hash);
}

// --- existing tests ---

#[test]
#[should_panic(expected = "Amount below minimum (100 stroops)")]
fn test_invalid_amount() {
    let (env, client, _, _) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    client.create_escrow(&sender, &recipient, &agent, &0, &250);
}

#[test]
#[should_panic(expected = "Fee exceeds maximum of 1000 bps (10%)")]
fn test_invalid_fee() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &10001);
}

#[test]
fn test_release_escrow() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    let fee_bps = 250u32;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &fee_bps);
    client.release_escrow(&agent, &escrow_id);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);

    let expected_fee = (amount * fee_bps as i128) / 10000;
    let expected_agent = amount - expected_fee;

    assert_eq!(
        TokenClient::new(&env, &usdc_id).balance(&agent),
        expected_agent
    );
    assert_eq!(client.get_accumulated_fees(), expected_fee);
}

#[test]
fn test_cancel_escrow() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 500_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &100);
    client.cancel_escrow(&sender, &escrow_id);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Cancelled);
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&sender), amount);
}

#[test]
fn test_confirm_delivery_prevents_cancel() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.confirm_delivery(&agent, &escrow_id);

    let escrow = client.get_escrow(&escrow_id);
    assert!(escrow.payout_confirmed);

    let result = std::panic::catch_unwind(|| {
        client.cancel_escrow(&sender, &escrow_id);
    });
    assert!(result.is_err());
    let error_message = format!("{:?}", result.err().unwrap());
    assert!(error_message.contains("Cannot cancel: agent has confirmed delivery"));
}

#[test]
fn test_partial_release_keeps_pending_until_fully_released() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    client.partial_release(&agent, &escrow_id, &500_000000i128);
    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.amount, 500_000000i128);
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&agent), 500_000000i128 - 12_500000i128);
}

#[test]
fn test_multiple_partial_releases_release_remaining_amount() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    client.partial_release(&agent, &escrow_id, &300_000000i128);
    client.partial_release(&agent, &escrow_id, &200_000000i128);
    client.partial_release(&agent, &escrow_id, &500_000000i128);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.amount, 0);
}

#[test]
#[should_panic(expected = "Release amount exceeds escrow balance")]
fn test_partial_release_over_release_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.partial_release(&agent, &escrow_id, &1_000_000001i128);
}

// ── Comprehensive partial release tests ───────────────────────────────────────

#[test]
fn test_partial_release_basic() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128; // 1000 USDC

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    client.partial_release(&agent, &escrow_id, &400_0000000i128); // 400 USDC

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Pending);
    assert_eq!(escrow.amount, 600_0000000i128);

    let expected_fee = (400_0000000i128 * 250i128) / 10000i128;
    let expected_agent = 400_0000000i128 - expected_fee;
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&agent), expected_agent);

    let event_name: Val = Symbol::new(&env, "PartialRelease").into_val(&env);
    let events = env.events().all();
    let pr_event = events.iter().find(|(_, topics, _)| {
        topics.iter().any(|topic| topic == &event_name)
    });
    assert!(pr_event.is_some(), "PartialRelease event not emitted");
    let (_, _, data) = pr_event.unwrap();
    let payload: PartialRelease = soroban_sdk::from_val(&env, data);
    assert_eq!(payload.escrow_id, escrow_id);
    assert_eq!(payload.released_amount, 400_0000000i128);
    assert_eq!(payload.remaining_amount, 600_0000000i128);
    assert_eq!(payload.fee_amount, expected_fee);
}

#[test]
fn test_partial_release_multiple() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128; // 1000 USDC

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    client.partial_release(&agent, &escrow_id, &300_0000000i128); // 300 USDC
    client.partial_release(&agent, &escrow_id, &700_0000000i128); // 700 USDC

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.amount, 0);

    let total_agent_received = TokenClient::new(&env, &usdc_id).balance(&agent);
    let fee1 = (300_0000000i128 * 250) / 10000;
    let fee2 = (700_0000000i128 * 250) / 10000;
    assert_eq!(total_agent_received, 300_0000000i128 - fee1 + 700_0000000i128 - fee2);
}

#[test]
#[should_panic(expected = "Release amount exceeds escrow balance")]
fn test_partial_release_exceeds_balance() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.partial_release(&agent, &escrow_id, &1_100_0000000i128); // 1100 USDC > 1000
}

#[test]
#[should_panic(expected = "Escrow is not in pending state")]
fn test_partial_release_wrong_status() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.release_escrow(&agent, &escrow_id); // moves to Released

    client.partial_release(&agent, &escrow_id, &1_000000000i128);
}

#[test]
#[should_panic(expected = "Only the agent can release escrow")]
fn test_partial_release_wrong_caller() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let impostor = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.partial_release(&impostor, &escrow_id, &1_000000000i128);
}

#[test]
fn test_partial_release_event_fields() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.partial_release(&agent, &escrow_id, &600_0000000i128);

    let event_name: Val = Symbol::new(&env, "PartialRelease").into_val(&env);
    let events = env.events().all();
    let pr_event = events.iter().find(|(_, topics, _)| {
        topics.iter().any(|topic| topic == &event_name)
    });
    assert!(pr_event.is_some(), "PartialRelease event not emitted");
    let (_, _, data) = pr_event.unwrap();
    let payload: PartialRelease = soroban_sdk::from_val(&env, data);

    assert_eq!(payload.escrow_id, escrow_id);
    assert_eq!(payload.released_amount, 600_0000000i128);
    assert_eq!(payload.remaining_amount, 400_0000000i128);
    assert_eq!(payload.fee_amount, (600_0000000i128 * 250) / 10000);
}

#[test]
fn test_cleanup_escrow_after_retention() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.cancel_escrow(&sender, &escrow_id);

    env.ledger().with_mut(|li| {
        li.timestamp += 90 * 24 * 60 * 60 + 1;
    });

    client.cleanup_escrow(&admin, &escrow_id);

    let result = std::panic::catch_unwind(|| {
        client.get_escrow(&escrow_id);
    });
    assert!(result.is_err());
    let err_str = format!("{:?}", result.err().unwrap());
    assert!(err_str.contains("Escrow 1 not found"));
}

#[test]
#[should_panic(expected = "Only the agent can release escrow")]
fn test_release_wrong_caller() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let impostor = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.release_escrow(&impostor, &escrow_id);
}

#[test]
#[should_panic(expected = "Only the sender can cancel escrow")]
fn test_cancel_wrong_caller() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let impostor = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.cancel_escrow(&impostor, &escrow_id);
}

#[test]
#[should_panic(expected = "Escrow is not in pending state")]
fn test_double_release() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.release_escrow(&agent, &escrow_id);
    client.release_escrow(&agent, &escrow_id);
}

#[test]
#[should_panic(expected = "Escrow is not in pending state")]
fn test_cancel_after_release() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &250);
    client.release_escrow(&agent, &escrow_id);
    client.cancel_escrow(&sender, &escrow_id);
}

#[test]
fn test_accumulated_fees_initial() {
    let (_, client, _, _) = setup();
    assert_eq!(client.get_accumulated_fees(), 0);
}

#[test]
fn test_withdraw_fees() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    let fee_bps = 500u32;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &fee_bps);
    client.release_escrow(&agent, &escrow_id);

    let expected_fee = (amount * fee_bps as i128) / 10000;
    assert_eq!(client.get_accumulated_fees(), expected_fee);

    client.withdraw_fees(&admin, &expected_fee);
    assert_eq!(client.get_accumulated_fees(), 0);
    assert_eq!(
        TokenClient::new(&env, &usdc_id).balance(&admin),
        expected_fee
    );
}

#[test]
fn test_withdraw_fees_emits_event() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;
    let fee_bps = 500u32;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &fee_bps);
    client.release_escrow(&agent, &escrow_id);

    let expected_fee = (amount * fee_bps as i128) / 10000;
    client.withdraw_fees(&admin, &expected_fee);

    let event_name: Val = Symbol::new(&env, "FeesWithdrawn").into_val(&env);
    let events = env.events().all();
    let fee_event = events.iter().find(|(_, topics, _)| {
        topics.iter().any(|topic| topic == &event_name)
    });

    assert!(fee_event.is_some(), "FeesWithdrawn event not emitted");

    let (_, _, data) = fee_event.unwrap();
    let payload: FeesWithdrawn = soroban_sdk::from_val(&env, data);

    assert_eq!(payload.admin, admin);
    assert_eq!(payload.amount, expected_fee);
}

#[test]
#[should_panic(expected = "Only admin can withdraw fees")]
fn test_withdraw_fees_wrong_caller() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let impostor = Address::generate(&env);

    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &500);
    client.release_escrow(&agent, &escrow_id);
    client.withdraw_fees(&impostor, &500_0000000);
}

#[test]
#[should_panic(expected = "Escrow 999 not found")]
fn test_get_nonexistent_escrow() {
    let (_, client, _, _) = setup();
    client.get_escrow(&999);
}

// ── #346: distinct addresses ──────────────────────────────────────────────────

#[test]
#[should_panic(expected = "Sender, recipient, and agent must be distinct addresses")]
fn test_create_escrow_sender_equals_agent() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &sender, &1_000_0000000, &250);
}

#[test]
#[should_panic(expected = "Sender, recipient, and agent must be distinct addresses")]
fn test_create_escrow_sender_equals_recipient() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &sender, &agent, &1_000_0000000, &250);
}

#[test]
#[should_panic(expected = "Sender, recipient, and agent must be distinct addresses")]
fn test_create_escrow_agent_equals_recipient() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    client.create_escrow(&sender, &recipient, &recipient, &1_000_0000000, &250);
}

// ── #347: withdraw_fees amount > 0 ───────────────────────────────────────────

#[test]
#[should_panic(expected = "Amount must be positive")]
fn test_withdraw_fees_zero_amount_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    mint_usdc(&env, &usdc_id, &admin, &sender, 1_000_0000000);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &1_000_0000000, &500);
    client.release_escrow(&agent, &escrow_id);
    client.withdraw_fees(&admin, &0);
}

#[test]
fn test_deposit_into_active_escrow() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 500_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount * 2);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.deposit(&sender, &escrow_id, &amount);

    assert_eq!(client.get_escrow(&escrow_id).amount, amount * 2);
}

// fix #334: release_escrow now enforces expiry — agent cannot release after the 30-day window.
#[test]
#[should_panic(expected = "Escrow has expired")]
fn test_release_escrow_after_expiry_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60 + 1;
    });

    client.release_escrow(&agent, &escrow_id); // must panic: "Escrow has expired"
}

#[test]
#[should_panic(expected = "Escrow has expired")]
fn test_release_escrow_at_exact_expiry_boundary_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60; // exactly at boundary — >= means expired
    });

    client.release_escrow(&agent, &escrow_id); // must panic: "Escrow has expired"
}

#[test]
fn test_release_escrow_before_expiry_succeeds() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60 - 1; // one second before expiry
    });

    client.release_escrow(&agent, &escrow_id);
    assert_eq!(client.get_escrow(&escrow_id).status, EscrowStatus::Released);
}

// ── Time-lock expiry: expire_escrow tests ─────────────────────────────────────

#[test]
fn test_expire_escrow_after_expiry() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60 + 1;
    });

    let anyone = Address::generate(&env);
    client.expire_escrow(&anyone, &escrow_id);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Cancelled);
    assert_eq!(TokenClient::new(&env, &usdc_id).balance(&sender), amount);
}

#[test]
#[should_panic(expected = "Escrow has not expired yet")]
fn test_expire_escrow_before_expiry_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60;
    });

    let anyone = Address::generate(&env);
    client.expire_escrow(&anyone, &escrow_id); // panic: not expired yet at exact boundary
}

#[test]
#[should_panic(expected = "Escrow has not expired yet")]
fn test_expire_escrow_still_before_boundary_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60 - 1;
    });

    let anyone = Address::generate(&env);
    client.expire_escrow(&anyone, &escrow_id);
}

#[test]
#[should_panic(expected = "Escrow is not in pending state")]
fn test_expire_escrow_on_cancelled_escrow_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.cancel_escrow(&sender, &escrow_id);

    let anyone = Address::generate(&env);
    client.expire_escrow(&anyone, &escrow_id);
}

#[test]
#[should_panic(expected = "Insufficient accumulated fees")]
fn test_withdraw_fees_exceeds_accumulated_panics() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 1_000_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount);
    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.release_escrow(&agent, &escrow_id);

    let accumulated = client.get_accumulated_fees();
    client.withdraw_fees(&admin, &(accumulated + 1));
}

#[test]
#[should_panic(expected = "Escrow has expired")]
fn test_deposit_into_expired_escrow_is_rejected() {
    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 500_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount * 2);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);

    env.ledger().with_mut(|li| {
        li.timestamp += 30 * 24 * 60 * 60 + 1;
    });

    client.deposit(&sender, &escrow_id, &amount);
}

// --- #345: EscrowDeposited event test ---

#[test]
fn test_deposit_emits_escrow_deposited_event() {
    use crate::EscrowDeposited;

    let (env, client, admin, usdc_id) = setup();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let agent = Address::generate(&env);
    let amount = 500_0000000i128;
    let deposit_amount = 200_0000000i128;

    mint_usdc(&env, &usdc_id, &admin, &sender, amount + deposit_amount);

    let escrow_id = client.create_escrow(&sender, &recipient, &agent, &amount, &250);
    client.deposit(&sender, &escrow_id, &deposit_amount);

    let event_name: Val = Symbol::new(&env, "EscrowDeposited").into_val(&env);
    let events = env.events().all();
    let deposit_event = events.iter().find(|(_, topics, _)| {
        topics.iter().any(|topic| topic == &event_name)
    });

    assert!(deposit_event.is_some(), "EscrowDeposited event not emitted");

    let (_, _, data) = deposit_event.unwrap();
    let payload: EscrowDeposited = soroban_sdk::from_val(&env, data);

    assert_eq!(payload.escrow_id, escrow_id);
    assert_eq!(payload.depositor, sender);
    assert_eq!(payload.amount, deposit_amount);
    assert_eq!(payload.new_total, amount + deposit_amount);
}
