# Kurulum Rehberi (Türkçe)

Bu uygulama, Trendyol, Hepsiburada, Amazon.com.tr ve N11'deki ürünlerin fiyatını düzenli olarak kaydeder ve
**Efsane Cuma / Black Friday** geldiğinde indirimin gerçek mi, yoksa önce zam yapılıp sonra "indirilmiş" mi
olduğunu gösterir.

Uygulama bilgisayarında sürekli açık duran küçük bir web sunucusudur. Tarayıcıdan `http://localhost:3100`
adresiyle açarsın. Bilgisayar uykuya geçerse o sürede kontrol yapılmaz, uyanınca kaldığı yerden devam eder.

---

## 1. Gerekenler (bir kere)

| | Windows | Mac |
|---|---|---|
| **Node.js 22** | https://nodejs.org → "LTS" indir, kur | https://nodejs.org → "LTS" indir, kur |
| **Git** | https://git-scm.com/download/win | Terminal'de `git --version` yaz, kurmayı önerirse kabul et |

Kurulumdan sonra bir terminal aç (Windows: **PowerShell**, Mac: **Terminal**) ve kontrol et:

```bash
node --version   # v22.x görmelisin
git --version
```

## 2. Kodu indir ve kur

```bash
git clone https://github.com/alpkucukkayalar/price-tracker-tr.git
cd price-tracker-tr

cd server && npm ci && npx playwright install chromium && cd ..
cd client && npm ci && npm run build && cd ..
cd server && npm run build && cd ..
```

## 3. Ayar dosyası

```bash
# Windows (PowerShell):  copy .env.example .env
# Mac:                   cp .env.example .env
```

`.env` dosyasını bir metin editörüyle aç ve şunları doldur:

```ini
NODE_ENV=production
DATABASE_PATH=./data/price-tracker.db      # veriler bu tek dosyada durur (server/data altında)
COOKIE_SECURE=false                         # localhost'ta http ile giriş için
JWT_SECRET=...                              # aşağıdaki komutun çıktısı
SETTINGS_ENCRYPTION_KEY=...                 # aşağıdaki komutun çıktısı (ikinci kez çalıştır)
```

Gizli anahtarları üretmek için (iki kere çalıştır, birini `JWT_SECRET`, diğerini `SETTINGS_ENCRYPTION_KEY` yap):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Kampanya tarihleri varsayılan olarak **27–30 Kasım 2026**. Değiştirmek istersen `.env` içindeki
`CAMPAIGN_START` / `CAMPAIGN_END` satırlarını düzenle.

## 4. Çalıştır

```bash
cd server
npm run start:env      # .env dosyasını okuyarak başlatır
```

İlk açılışta terminalde şuna benzer bir satır görürsün:

```
FIRST-RUN SETUP: http://localhost:3100/setup?token=....
```

O linki tarayıcıda aç, yönetici hesabını oluştur. Artık `http://localhost:3100` adresinden girebilirsin.

## 5. Ürün ekle

**Add Tracker** → Trendyol / Hepsiburada / Amazon.com.tr / N11 ürün linkini yapıştır → **Test** ile fiyatın doğru
okunduğunu kontrol et (ör. `Found: 1.299,99 TL`) → kaydet.

- Varsayılan kontrol aralığı 6 saat; Black Friday'e kadar bu yeterli. Kampanya günlerinde uygulama otomatik
  olarak **saatlik** kontrole geçer.
- **Efsane Cuma** sekmesi tüm ürünlerin kararını gösterir; mağazaya göre filtreleyebilirsin.
- Ürün sayfasındaki **Efsane Cuma analizi** kartı grafiği ve detayları gösterir.

## 6. Bildirim (isteğe bağlı ama önerilir)

**Settings** sayfasından bir kanal ekle. En kolayı telefon için **ntfy** uygulaması:
1. Telefona *ntfy* uygulamasını kur, rastgele bir konu adı aboneliği oluştur (ör. `alp-fiyat-8341`).
2. Settings → ntfy URL: `https://ntfy.sh/alp-fiyat-8341`.

Alacağın bildirimler:
- Hedef fiyat / rekor düşük fiyat uyarıları (orijinal özellik)
- **Kampanya öncesi zam uyarısı** — bir ürünün fiyatı normalinin %5+ üstüne çıkınca (günde en fazla 1)
- **Kampanya günlük özeti** — kampanya günlerinde her akşam 21:00
- **İndirim karnesi** — kampanya bitince tek seferlik özet

## 7. Bilgisayar açıldığında otomatik başlasın (isteğe bağlı)

En kolayı `pm2`:

```bash
npm install -g pm2
cd server
pm2 start npm --name fiyat-takip -- run start:env
pm2 save
# Windows: npm install -g pm2-windows-startup && pm2-startup install
# Mac:     pm2 startup   (çıkan komutu kopyalayıp çalıştır)
```

Ayrıca bilgisayarın **uyku moduna geçmemesini** ayarla (Windows: Ayarlar → Sistem → Güç; Mac: Sistem Ayarları →
Pil/Enerji → "Ekran kapalıyken otomatik uykuyu engelle").

---

## Sahte indirim nasıl belirleniyor?

| Karar | Anlamı |
|---|---|
| ✅ **Gerçek indirim** | Kampanya fiyatı, kampanyadan önceki 30 günün en düşük fiyatından en az %3 daha ucuz ve öncesinde zam yok |
| ⚠️ **Abartılı indirim** | Gerçek bir düşüş var, ama öncesinde zam yapıldığı için sitedeki indirim oranı şişirilmiş |
| 🚩 **Sahte indirim** | 30 günlük en düşük fiyata göre indirim yok (<%3), ama ya kampanyadan önceki 10 günde %5+ zam yapılmış ya da site %10+ indirim iddia ediyor |
| 📈 **Fiyat arttı** | Kampanyada fiyat, 30 günlük en düşükten yüksek |
| ➖ **İndirim yok** | Fiyat aynı, kimse de indirim iddia etmiyor |

Referans olarak **son 30 günün en düşük fiyatı** kullanılır; Ticaret Bakanlığı'nın indirimli satış kuralı da
indirimi bu fiyata göre ölçer. Sitenin "üstü çizili" fiyatı ayrıca kaydedilir ve iddia edilen indirimle gerçek
indirim yan yana gösterilir.

> Karar için kampanyadan önce **en az 7 günlük** veri gerekir. Ürünleri ne kadar erken eklersen analiz o kadar
> güvenilir olur.

## Sorun giderme

- **Fiyat okunamıyor / "Could not extract price"**: Site tasarımını değiştirmiş olabilir. Ürün sayfasında fiyata
  sağ tık → İncele ile CSS seçicisini bulup tracker'ın **CSS Selector** alanına yazabilirsin. Bana da haber ver,
  okuyucuyu güncelleyelim.
- **Fiyat 1.000 kat yanlış**: Olmamalı; olursa linki ve görülen fiyatı paylaş.
- **Siteler engelliyor**: Ev internetinden genelde sorun olmaz. Kontrol aralığını çok düşürme (≥ 60 dk).
