# Sunucu Kurulumu — Hiç bilmeyenler için adım adım

Toplam süre: ~30 dakika. Bilgisayarın Windows olabilir; sunucu ayrı bir makine, ona internetten bağlanacaksın.

---

## Adım 1 — Sunucu kirala (Natro önerisi)

Neden **Natro**: Türk firması, sunucuları İstanbul'da (Trendyol/Hepsiburada'nın bot engeline takılma ihtimali
düşük), panel ve destek Türkçe, ödeme TL ve kredi kartıyla.
(Turhost, Güzel Hosting gibi başka yerli firmalar da olur; aşağıdaki seçimler aynıdır.)

1. **natro.com**'a gir → üst menüden **Sunucu → VPS / Bulut Sunucu** (adı "XCloud" olabilir).
2. Paket seç: **en az 2 GB RAM** (5–10 arkadaş için yeter; daha kalabalıksa 4 GB).
3. **İşletim sistemi:** listeden **Ubuntu 24.04** (yoksa 22.04) seç. ❗ *Windows Server seçme.*
4. Ek hizmetlerden **"cPanel / Plesk" gibi paneller isteme** — gerek yok, ücretlidir.
5. Hesap aç, öde.
6. Birkaç dakika–birkaç saat içinde e-posta gelir. İçinde şunlar olur:
   - **IP adresi** (ör. `185.123.45.67`)
   - **Kullanıcı adı:** `root`
   - **Şifre**

   Bu bilgileri kimseyle (bana da) paylaşma.

## Adım 2 — Sunucuya bağlan (Windows)

1. Klavyede **Windows tuşu**na bas, **PowerShell** yaz, aç.
2. Şunu yaz (IP'yi kendi IP'n ile değiştir) ve Enter'a bas:

   ```
   ssh root@185.123.45.67
   ```

3. İlk seferde `Are you sure you want to continue connecting?` sorar → **yes** yaz, Enter.
4. **Şifre** sorar → e-postadaki şifreyi yapıştır (sağ tık = yapıştır). *Yazarken ekranda hiçbir şey görünmez,
   bu normal.* Enter.
5. `root@...:~#` gibi bir satır görürsen sunucunun içindesin. 🎉

## Adım 3 — Tek komutla kur

Aşağıdaki satırın **tamamını** kopyala, PowerShell penceresine sağ tıkla (yapıştırır), Enter:

```
curl -fsSL https://raw.githubusercontent.com/alpkucukkayalar/price-tracker-tr/main/scripts/kur-vps.sh | bash
```

5–10 dakika sürer, ekranda yazılar akar. Bitince şöyle bir şey görürsün:

```
==> Kurulum tamam!
  Adres:  https://185-123-45-67.sslip.io
  İlk yönetici hesabını oluşturmak için bu linki aç:
    https://185-123-45-67.sslip.io/setup?token=abc123...
```

## Adım 4 — Hesabını aç

1. Ekrandaki **setup linkini** kopyala, tarayıcıda aç.
2. E-posta, şifre, adını gir → yönetici hesabın hazır.
3. Bundan sonra adres: `https://<IP-tireli>.sslip.io` (yer imlerine ekle, telefondan da açılır).

## Adım 5 — Arkadaşlarını davet et

**Settings → Invites** (ya da Admin) → **davet kodu oluştur** → linki arkadaşına gönder. Herkes kendi
hesabını açar, kendi ürünlerini ekler.

## Adım 6 — Ürün ekle

**Add Tracker** → Trendyol / Hepsiburada / Amazon.com.tr / N11 linkini yapıştır → **Test** (fiyatı doğru okuyor
mu bak) → kaydet. Sonuçlar **Efsane Cuma** sekmesinde.

Telefon bildirimi için: telefona **ntfy** uygulamasını kur, bir konu aç (ör. `alp-fiyat-8341`), sonra
Settings → ntfy URL'ye `https://ntfy.sh/alp-fiyat-8341` yaz.

---

## Sık lazım olacaklar (PowerShell'de `ssh root@IP` ile bağlandıktan sonra)

| Ne | Komut |
|---|---|
| Uygulama çalışıyor mu? | `systemctl status fiyat-takip` |
| Son loglar | `journalctl -u fiyat-takip -n 50` |
| Güncelle (yeni sürüm) | Adım 3'teki komutu tekrar çalıştır |
| Yeniden başlat | `systemctl restart fiyat-takip` |
| Çıkış | `exit` |

Veriler `/opt/fiyat-takip/data/price-tracker.db` dosyasında. Sunucu yeniden başlasa da uygulama kendiliğinden açılır.
