//! # Stellar Flow — DAO Payroll Protocol
//!
//! Soroban akıllı sözleşmesi: bir employer belirli bir USDC miktarını
//! kilitler; employee her periyot sonunda `claim()` çağırarak ödemeyi alır.
//! Employer istediği zaman `cancel()` ile iptal edebilir, kalan bakiye iade edilir.

#![no_std]

#[cfg(test)]
mod test;

use core::convert::TryFrom;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env,
};

// ── Sabitler ─────────────────────────────────────────────────────────────────

/// 1 günün saniye cinsinden değeri (30 gün → 2_592_000 sn)
const SECONDS_PER_DAY: u64 = 86_400;

/// Sözleşme instance TTL uzatma miktarı (ledger sayısı, ~14 gün ≈ 100_000)
const TTL_EXTEND: u32 = 100_000;

// ── Veri yapıları ─────────────────────────────────────────────────────────────

/// Bir ödeme akışının tüm durumunu tutan yapı.
/// Soroban storage'ına XDR ile serialize edilerek yazılır.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Stream {
    /// USDC'yi kilitleyen işveren
    pub employer: Address,
    /// Periyodik ödeme alacak çalışan
    pub employee: Address,
    /// Sözleşmedeki USDC token'ının adresi (Testnet USDC)
    pub usdc_token: Address,
    /// Her periyotta ödenecek USDC miktarı (stroops; 1 USDC = 10_000_000)
    pub amount_per_period: i128,
    /// Periyot süresi saniye cinsinden (interval_days * 86_400)
    pub interval_seconds: u64,
    /// Toplam kilitlenen USDC
    pub total_amount: i128,
    /// Bugüne kadar çekilmiş toplam USDC
    pub claimed_amount: i128,
    /// Son başarılı claim anının Unix timestamp'i
    pub last_claim_time: u64,
    /// Akışın oluşturulma Unix timestamp'i
    pub start_time: u64,
    /// Akış aktif mi? (cancel veya tam tükeniş sonrası false olur)
    pub active: bool,
}

/// Storage anahtarı — multi-stream model.
#[contracttype]
pub enum DataKey {
    Stream(u64),
    NextStreamId,
}

fn interval_days_to_seconds(interval_days: u64) -> u64 {
    assert!(interval_days > 0, "interval_days must be at least 1");
    interval_days
        .checked_mul(SECONDS_PER_DAY)
        .expect("interval overflow")
}

fn remaining_amount(stream: &Stream) -> i128 {
    stream
        .total_amount
        .checked_sub(stream.claimed_amount)
        .expect("Invalid stream: claimed exceeds total")
}

fn elapsed_periods(now: u64, stream: &Stream) -> u64 {
    if !stream.active || stream.interval_seconds == 0 || now < stream.start_time {
        return 0;
    }

    let elapsed = now.saturating_sub(stream.last_claim_time);
    elapsed / stream.interval_seconds
}

fn compute_claimable(now: u64, stream: &Stream) -> i128 {
    if !stream.active || stream.amount_per_period <= 0 {
        return 0;
    }

    if stream.claimed_amount >= stream.total_amount {
        return 0;
    }

    let remaining = remaining_amount(stream);
    if remaining <= 0 {
        return 0;
    }

    let periods = elapsed_periods(now, stream);
    if periods == 0 {
        return 0;
    }

    let periods_i128 = i128::try_from(periods).unwrap_or(i128::MAX);
    let gross = periods_i128
        .checked_mul(stream.amount_per_period)
        .unwrap_or(i128::MAX);

    let capped = gross.min(remaining);
    if capped < 0 { 0 } else { capped }
}

fn next_stream_id(env: &Env) -> u64 {
    let current: u64 = env.storage().instance().get(&DataKey::NextStreamId).unwrap_or(1);
    let next = current.checked_add(1).expect("stream_id overflow");
    env.storage().instance().set(&DataKey::NextStreamId, &next);
    current
}

// ── Kontrat ───────────────────────────────────────────────────────────────────

#[contract]
pub struct StellarFlowContract;

#[contractimpl]
impl StellarFlowContract {
    // ─────────────────────────────────────────────────────────────────────────
    /// ## `create_stream`
    ///
    /// Yeni bir ödeme akışı oluşturur.
    ///
    /// ### Parametreler
    /// | Parametre          | Açıklama                                    |
    /// |--------------------|---------------------------------------------|
    /// | `employer`         | İşveren adresi (USDC'yi gönderecek)        |
    /// | `employee`         | Çalışan adresi (USDC'yi alacak)            |
    /// | `usdc_token`       | Testnet USDC token kontrat adresi          |
    /// | `amount_per_period`| Her periyotta ödenecek miktar (stroops)    |
    /// | `interval_days`    | Periyot süresi gün cinsinden               |
    /// | `total_amount`     | Kilitlenecek toplam USDC (stroops)         |
    ///
    /// ### Yapılan işlemler
    /// 1. `employer.require_auth()` → employer imzası zorunlu
    /// 2. Girdi doğrulamaları
    /// 3. `token::transfer(employer → contract, total_amount)`
    /// 4. `Stream` struct storage'a yazılır
    /// 5. `"created"` event yayılır
    // ─────────────────────────────────────────────────────────────────────────
    pub fn create_stream(
        env: Env,
        employer: Address,
        employee: Address,
        usdc_token: Address,
        amount_per_period: i128,
        interval_days: u64,
        total_amount: i128,
    ) -> u64 {
        // 1. İmza doğrulama
        employer.require_auth();

        // 2. Girdi doğrulamaları
        assert!(amount_per_period > 0, "amount_per_period must be positive");
        assert!(interval_days > 0, "interval_days must be at least 1");
        assert!(
            total_amount >= amount_per_period,
            "total_amount must be >= amount_per_period"
        );
        assert!(employer != employee, "employer and employee cannot be the same address");

        let stream_id = next_stream_id(&env);

        // 3. USDC'yi employer'dan bu kontraat adresine transfer et
        let token_client = token::Client::new(&env, &usdc_token);
        token_client.transfer(
            &employer,
            &env.current_contract_address(),
            &total_amount,
        );

        // 4. Akışı kaydet
        let interval_seconds = interval_days_to_seconds(interval_days);
        let now = env.ledger().timestamp();

        let stream = Stream {
            employer: employer.clone(),
            employee: employee.clone(),
            usdc_token,
            amount_per_period,
            interval_seconds,
            total_amount,
            claimed_amount: 0,
            last_claim_time: now,
            start_time: now,
            active: true,
        };

        env.storage()
            .instance()
            .set(&DataKey::Stream(stream_id), &stream);
        env.storage().instance().extend_ttl(TTL_EXTEND, TTL_EXTEND);

        // 5. Event
        env.events().publish(
            (symbol_short!("created"), employer),
            (stream_id, employee, total_amount, interval_days),
        );

        stream_id
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// ## `claim`
    ///
    /// Çalışanın (employee) periyot dolduktan sonra USDC çekmesini sağlar.
    ///
    /// ### Kurallar
    /// - Yalnızca `employee` çağırabilir (`require_auth`)
    /// - Akış aktif olmalı
    /// - Son claim üzerinden en az `interval_seconds` geçmiş olmalı
    /// - Birden fazla periyot geçmişse hepsini tek çekimde toplar
    ///   (ör: 2 periyot → 2 × amount_per_period)
    /// - `total_amount` aşılmaz; son çekimde akış otomatik kapanır
    ///
    /// ### Döndürür
    /// Çekilen USDC miktarı (stroops)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn claim(env: Env, stream_id: u64) -> i128 {
        let key = DataKey::Stream(stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .expect("No stream found; call create_stream first");

        // Sadece employee yetkili
        stream.employee.require_auth();

        assert!(stream.active, "Stream is not active");
        assert!(stream.amount_per_period > 0, "Invalid stream: amount_per_period must be positive");
        assert!(stream.claimed_amount <= stream.total_amount, "Invalid stream: claimed exceeds total");

        let now = env.ledger().timestamp();
        let periods_elapsed = elapsed_periods(now, &stream);
        let actual_claimable = compute_claimable(now, &stream);

        assert!(actual_claimable > 0, "Nothing to claim");

        // State güncelleme
        stream.claimed_amount = stream
            .claimed_amount
            .checked_add(actual_claimable)
            .expect("claimed overflow");
        assert!(
            stream.claimed_amount <= stream.total_amount,
            "Invalid state: claimed exceeds total"
        );

        // last_claim_time'ı tam periyot adımıyla ilerlet (fraksiyonu koru)
        let claim_advance = periods_elapsed
            .checked_mul(stream.interval_seconds)
            .expect("time advance overflow");
        stream.last_claim_time = stream
            .last_claim_time
            .checked_add(claim_advance)
            .expect("last_claim_time overflow");

        // Tüm ödeme tamamlandıysa akışı kapat
        if stream.claimed_amount >= stream.total_amount {
            stream.active = false;
        }

        // USDC transferi
        let token_client = token::Client::new(&env, &stream.usdc_token);
        token_client.transfer(
            &env.current_contract_address(),
            &stream.employee,
            &actual_claimable,
        );

        env.storage().instance().set(&key, &stream);
        env.storage().instance().extend_ttl(TTL_EXTEND, TTL_EXTEND);

        env.events().publish(
            (symbol_short!("claimed"), stream.employee.clone()),
            actual_claimable,
        );

        actual_claimable
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// ## `cancel`
    ///
    /// İşveren (employer) akışı iptal eder; kalan USDC bakiyesi iade edilir.
    ///
    /// ### Kurallar
    /// - Yalnızca `employer` çağırabilir
    /// - Akış aktif olmalı
    /// - Çekilmemiş (unclaimed) tüm USDC `employer`'a geri transfer edilir
    ///
    /// ### Döndürür
    /// İade edilen USDC miktarı (stroops)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn cancel(env: Env, stream_id: u64) -> i128 {
        let key = DataKey::Stream(stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .expect("No stream found");

        // Sadece employer yetkili
        stream.employer.require_auth();

        assert!(stream.active, "Stream is already inactive");

        assert!(stream.claimed_amount <= stream.total_amount, "Invalid stream: claimed exceeds total");
        let remaining = stream
            .total_amount
            .checked_sub(stream.claimed_amount)
            .expect("Invalid stream: claimed exceeds total");

        // Checks-Effects-Interactions: önce state'i kapat, sonra transfer et
        stream.active = false;
        env.storage().instance().set(&key, &stream);
        env.storage().instance().extend_ttl(TTL_EXTEND, TTL_EXTEND);

        // Kalan bakiyeyi iade et
        if remaining > 0 {
            let token_client = token::Client::new(&env, &stream.usdc_token);
            token_client.transfer(
                &env.current_contract_address(),
                &stream.employer,
                &remaining,
            );
        }

        env.events().publish(
            (symbol_short!("cancel"), stream.employer.clone()),
            remaining,
        );

        remaining
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// ## `get_stream`
    ///
    /// Mevcut akışın tüm verilerini döner (read-only).
    /// Frontend / indexer entegrasyonu için kullanılır.
    // ─────────────────────────────────────────────────────────────────────────
    pub fn get_stream(env: Env, stream_id: u64) -> Stream {
        env.storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("No stream found")
    }

    /// Bir sonraki oluşturulacak stream id'sini döner (read-only).
    pub fn get_next_stream_id(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::NextStreamId).unwrap_or(1)
    }

    // ─────────────────────────────────────────────────────────────────────────
    /// ## `claimable_amount`
    ///
    /// Şu an `claim()` ile çekilebilecek USDC miktarını hesaplar.
    /// Kontrata yazma yapmaz; simulation / UI için idealdir.
    ///
    /// ### Döndürür
    /// - `0` → periyot dolmadı veya akış kapalı
    /// - `> 0` → çekilebilir miktar (stroops)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn claimable_amount(env: Env, stream_id: u64) -> i128 {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&DataKey::Stream(stream_id))
            .expect("No stream found");

        let now = env.ledger().timestamp();
        compute_claimable(now, &stream)
    }
}
