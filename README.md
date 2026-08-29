# Telegram Automation Tool 🚀

Modern, güvenli ve çoklu hesap destekli Telegram otomasyon ve pazarlama paneli.

## ✨ Özellikler

- **Çoklu Hesap Yönetimi:** Birden fazla Telegram hesabını bağlama, oturum yönetimi ve rotasyon.
- **Otomatik Paylaşım (Auto Poster):**
  - Belirtilen dakika aralıklarında katıldığınız tüm gruplara veya özel hedef listesine otomatik mesaj gönderimi.
  - Her numara için **farklı özel mesaj** ve **farklı görsel** belirleyebilme.
  - Görsel desteği ve medya kısıtlamalı gruplarda otomatik metin fallback desteği.
  - Karakter limitine takılmayan akıllı açıklama (caption) yönetimi.
- **Grup Üye Çekici (Scraper):**
  - Hedef gruplardan üye listesi çıkarma (aktiflik filtresi ve gizli üyeler için mesaj geçmişi tarama modu).
- **Gruba Üye Ekleme (Adder):**
  - Çekilen üyeleri hesap rotasyonu ve güvenli bekleme süreleriyle kendi grubunuza ekleme.
- **Toplu DM Gönderme:**
  - Belirlenen kullanıcılara hesaplar arası rotasyonla özel mesaj iletme.
- **Eşzamanlı Çoklu Görev (Multi-Tasking):**
  - Paylaşım yaparken aynı anda üye çekme ve ekleme işlemlerini birbirini durdurmadan yürütebilme.
- **Canlı WebSocket Konsolu:**
  - Tüm işlemleri anlık olarak izleyebileceğiniz modern karanlık tema arayüzü.

## 🛠 Kurulum ve Çalıştırma

1. **Gereksinimleri yükleyin:**
   `ash
   pip install -r requirements.txt
   `

2. **Sunucuyu başlatın:**
   `ash
   python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   `

3. **Arayüze erişin:**
   Tarayıcınızda [http://127.0.0.1:8000](http://127.0.0.1:8000) adresini açın.
