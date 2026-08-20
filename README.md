# Tomoro Coffee Proxy API & Web App (Cloudflare Workers)

Proyek ini berisi *Cloudflare Worker* sebagai Proxy API Tomoro Coffee untuk mem-bypass pemblokiran cors dan memformat data, serta aplikasi frontend web untuk melakukan pencarian gerai, penayangan menu, dan scraper data.

## File yang Tersedia:
1.  `worker.js`: Kode program utama untuk dideploy ke **Cloudflare Workers**.
2.  `index.html`: Antarmuka halaman pemesanan (storefront) dengan menu, detail gerai, dan keranjang belanja.
3.  `scraper.html`: Antarmuka pengumpul data (scraper) menu gerai untuk ekspor ke Excel/JSON.

---

## 🚀 Cara Deploy Cloudflare Worker:
1.  Buka dashboard [Cloudflare Workers](https://workers.cloudflare.com/) dan login/daftar akun.
2.  Klik tombol **Create Application** lalu pilih **Create Worker**.
3.  Beri nama Worker Anda (contoh: `tomoro-api-proxy`), lalu klik **Deploy**.
4.  Klik **Edit Code** pada halaman Worker yang baru dibuat.
5.  Hapus seluruh kode bawaan, lalu salin dan tempel (*paste*) isi berkas **`worker.js`** dari folder ini.
6.  Klik **Save and Deploy**.
7.  Salin URL Worker Anda yang berakhiran `.workers.dev` (contoh: `https://tomoro-api-proxy.username.workers.dev`).

---

## 💻 Cara Menjalankan Halaman Web (Lokal):
1.  Buka berkas **`index.html`** atau **`scraper.html`** langsung dengan mengklik dua kali (*double click*) berkas tersebut untuk membukanya di browser web Anda (Chrome/Edge).
2.  Di bagian atas halaman, masukkan **URL Cloudflare Worker** yang telah Anda deploy tadi.
3.  Dapatkan token WAF `acw_sc__v2` dari browser Anda (buka H5 App Tomoro Coffee, aktifkan F12 -> tab Network, cari request ke `getStoreList/v3`, lalu salin tokennya).
4.  Masukkan token WAF ke kolom input yang tersedia di web, klik **Simpan & Mulai**, lalu mulailah mencari gerai dan mengunduh menu kopi pilihanmu!
