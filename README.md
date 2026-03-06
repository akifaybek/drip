# Drip

Drip, Soroban üzerinde çalışan USDC tabanlı payroll (maaş akışı) uygulamasıdır.

- **Contract (Rust/Soroban):** Multi-stream ödeme akışları (`stream_id` tabanlı)
- **Frontend (React + Freighter):** Akış oluşturma, görüntüleme, claim/cancel

## Özellikler

- Multi-stream model: `Map<stream_id, Stream>`
- Güvenli `claim/cancel` akışı (auth + checked arithmetic + invariants)
- BigInt-safe frontend token hesaplamaları (i128 uyumlu)
- Tx lifecycle UX: `simulate -> sign -> send -> confirm`
- Global tx durumları: `idle | simulating | signing | submitting | confirming | done | error`

## Proje Yapısı

```text
drip/
  contracts/
    stellar-flow/      # Soroban contract crate adı (mevcut klasör adı)
  frontend/            # CRA frontend
```

## Gereksinimler

- Node.js 18+
- npm
- Rust toolchain
- Soroban CLI (deploy işlemleri için)
- Freighter Wallet (browser extension)

## Development Kurulumu

### 1) Frontend environment dosyasını hazırlayın

```bash
cd frontend
cp .env.example .env
```

Ardından `.env` içindeki değerleri doldurun.

### 2) Frontend geliştirme sunucusu

```bash
cd frontend
npm install
npm start
```

### 3) Frontend production build

```bash
cd frontend
npm run build
```

## Contract Build/Test

```bash
cd contracts/stellar-flow
cargo test -q
cargo build --target wasm32v1-none --release
```

## Contract Deploy (Özet Akış)

> Kullandığınız ağa (testnet/mainnet) göre RPC/passphrase değerlerini doğru seçin.

1. Contract wasm çıktısını üretin (`cargo build ... --release`)
2. Soroban CLI ile deploy edin
3. Deploy sonucunda oluşan **Contract ID** değerini alın
4. Frontend `.env` içinde `REACT_APP_CONTRACT_ID` olarak güncelleyin

## Contract ID Güncelleme

Frontend tarafı kontrat adresini sadece `.env` üzerinden okur:

```env
REACT_APP_CONTRACT_ID=YOUR_DEPLOYED_CONTRACT_ID
```

Contract yeniden deploy edilirse bu değeri mutlaka güncelleyin.

## Network Konfigürasyonu

Frontend `REACT_APP_NETWORK` değeri ile çalışır:

- `testnet`
- `public`

Örnek:

```env
REACT_APP_NETWORK=testnet
REACT_APP_RPC_URL=https://soroban-testnet.stellar.org
```

## Known Issues

- MVP yaklaşımı gereği frontend son oluşturulan `stream_id` bilgisini `localStorage` içinde tutar.
- Farklı cüzdan/adres kombinasyonlarında eski local storage verisi stream görünümünü etkileyebilir.
- Freighter imza popup’ı kullanıcı tarafından kapatılırsa işlem `sign` aşamasında hata verir (beklenen davranış).
- Ağ yoğunluğunda confirmation/poll süresi uzayabilir.

## Production Checklist

Deploy öncesi aşağıdakilerin tamamını doğrulayın:

- [ ] `cargo test -q` başarılı
- [ ] `cargo build --target wasm32v1-none --release` başarılı
- [ ] `frontend` için `npm run build` başarılı
- [ ] `REACT_APP_CONTRACT_ID` güncel deploy ID ile eşleşiyor
- [ ] `REACT_APP_NETWORK` ve `REACT_APP_RPC_URL` hedef ağ ile uyumlu
- [ ] `REACT_APP_USDC_ADDRESS` doğru token contract adresi
- [ ] Freighter ile create/claim/cancel uçtan uca smoke test yapıldı
- [ ] Tx lifecycle durumları UI’da doğru gözüküyor (`simulate/sign/send/confirm`)
- [ ] Explorer üzerinden tx hash doğrulandı

## Lisans

Proje lisans dosyasına bakın: `LICENSE`.
