use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn mk_stream(env: &Env) -> Stream {
    Stream {
        employer: Address::generate(env),
        employee: Address::generate(env),
        usdc_token: Address::generate(env),
        amount_per_period: 100,
        interval_seconds: SECONDS_PER_DAY,
        total_amount: 1_000,
        claimed_amount: 0,
        last_claim_time: 1_000,
        start_time: 1_000,
        active: true,
    }
}

#[test]
fn interval_days_to_seconds_checked() {
    assert_eq!(interval_days_to_seconds(1), 86_400);
    assert_eq!(interval_days_to_seconds(30), 2_592_000);
}

#[test]
#[should_panic(expected = "interval_days must be at least 1")]
fn interval_days_zero_rejected() {
    let _ = interval_days_to_seconds(0);
}

#[test]
fn claimable_is_zero_when_start_time_in_future() {
    let env = Env::default();
    let mut s = mk_stream(&env);
    s.start_time = 2_000;
    s.last_claim_time = 2_000;

    let claimable = compute_claimable(1_500, &s);
    assert_eq!(claimable, 0);
}

#[test]
fn claimable_is_zero_for_partial_period() {
    let env = Env::default();
    let s = mk_stream(&env);

    let claimable = compute_claimable(s.last_claim_time + s.interval_seconds - 1, &s);
    assert_eq!(claimable, 0);
}

#[test]
fn claimable_is_exact_for_full_periods() {
    let env = Env::default();
    let s = mk_stream(&env);

    let now = s.last_claim_time + (2 * s.interval_seconds);
    let claimable = compute_claimable(now, &s);
    assert_eq!(claimable, 200);
}

#[test]
fn claimable_is_capped_by_remaining_and_overflow_safe() {
    let env = Env::default();
    let mut s = mk_stream(&env);
    s.amount_per_period = i128::MAX;
    s.total_amount = 750;
    s.claimed_amount = 250;

    let now = s.last_claim_time + (10 * s.interval_seconds);
    let claimable = compute_claimable(now, &s);

    // remaining = 500, gross very large olsa bile cap uygulanmalı
    assert_eq!(claimable, 500);
}

#[test]
fn claimable_is_zero_after_cancel_inactive_stream() {
    let env = Env::default();
    let mut s = mk_stream(&env);
    s.active = false;

    let now = s.last_claim_time + (10 * s.interval_seconds);
    let claimable = compute_claimable(now, &s);
    assert_eq!(claimable, 0);
}
