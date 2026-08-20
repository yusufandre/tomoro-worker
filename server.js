import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const PORT = process.env.PORT || 10000;
const __dirname = path.resolve();

const TOMORO_BASE = "https://api-service.tomoro-coffee.id";
const TOMORO_HEADERS = {
  "Content-Type": "application/json;charset=UTF-8",
  "revision": "2.9.1",
  "appLanguage": "en",
  "appChannel": "h5",
  "deviceCode": "e3e77f97-446e-4eb1-931c-db4bd6b64355",
  "requestId": "09ef48e0-cf0c-4b93-a62f-993b38c3e68c",
  "timeZone": "Asia/Jakarta",
  "countryCode": "id",
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Caching WAF Token
let cachedWafToken = "";
let harvestPromise = null;

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Memanen token WAF acw_sc__v2 dengan meluncurkan browser Puppeteer lokal secara headless.
 * Ini berjalan di komputer lokal Anda (atau di server cloud seperti Render/Railway).
 */
async function harvestWafToken() {
  console.log("[WAF] Meluncurkan browser Puppeteer untuk memanen token WAF baru...");
  
  const browser = await puppeteer.launch({
    headless: "new",
    // Parameter args di bawah ini wajib untuk lingkungan cloud/Docker seperti Render & Railway
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set user agent mobile agar menyerupai H5 App
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
    
    let detectedToken = "";
    
    // Intercept request untuk menangkap token yang lewat di query string
    page.on('request', req => {
      const urlStr = req.url();
      if (urlStr.includes('acw_sc__v2=')) {
        const match = urlStr.match(/acw_sc__v2=([^&]+)/);
        if (match) detectedToken = match[1];
      }
    });

    // Buka H5 App untuk memicu bypass WAF di browser
    await page.goto('https://h5-app.tomoro-coffee.id/order/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 25000 
    });
    
    await delay(5000);
    
    // Jika tidak tertangkap dari request, ambil dari cookies
    const cookies = await page.cookies();
    const wafCookie = cookies.find(c => c.name === 'acw_sc__v2');
    
    if (wafCookie && wafCookie.value) {
      detectedToken = wafCookie.value;
    }
    
    if (detectedToken) {
      console.log("[WAF] Sukses memanen token baru:", detectedToken);
      cachedWafToken = detectedToken;
      return detectedToken;
    }
    
    throw new Error("Gagal menemukan cookie acw_sc__v2.");
  } catch (err) {
    console.error("[WAF] Error memanen token:", err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

/**
 * Mengembalikan token aktif atau memulai pemanenan token jika belum ada
 */
async function getOrHarvestToken() {
  if (cachedWafToken) return cachedWafToken;
  
  if (harvestPromise) {
    console.log("[WAF] Menunggu pemanenan token yang sedang berjalan...");
    return harvestPromise;
  }
  
  harvestPromise = harvestWafToken().then(token => {
    harvestPromise = null;
    return token;
  }).catch(err => {
    harvestPromise = null;
    throw err;
  });
  
  return harvestPromise;
}

/**
 * Panggil API Tomoro secara langsung (Direct HTTP Fetch) menggunakan token WAF yang disimpan di cache
 */
async function callTomoroApi(pathAndQuery) {
  const token = await getOrHarvestToken();
  const connector = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${TOMORO_BASE}${pathAndQuery}${connector}acw_sc__v2=${token}`;
  
  console.log(`[API] Direct Fetching: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...TOMORO_HEADERS,
      'Cookie': `acw_sc__v2=${token}`
    }
  });
  
  const text = await response.text();
  
  if (text.includes('<!DOCTYPE html>') || text.includes('_waf_')) {
    console.warn("[WAF] Token kadaluarsa atau terblokir. Mengosongkan cache token...");
    cachedWafToken = ""; // Hapus token kadaluarsa dari cache
    throw new Error("WAF_BLOCKED");
  }
  
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // 1. SERVE STATIC FILES
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading index.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
    return;
  }

  if (pathname === '/scraper' || pathname === '/scraper.html') {
    fs.readFile(path.join(__dirname, 'scraper.html'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading scraper.html');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      }
    });
    return;
  }

  // 2. API PROXY ENDPOINTS (Tanpa ZenRows API Key!)
  try {
    // ─── GET /outlets ───
    if (pathname === '/outlets') {
      const keyword = reqUrl.searchParams.get("keyword") || "";
      const page = reqUrl.searchParams.get("page") || "1";
      const pageSize = reqUrl.searchParams.get("page_size") || "20";
      
      let data;
      try {
        data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreList/v3?pageNo=${page}&pageSize=${pageSize}&storeName=${encodeURIComponent(keyword)}`);
      } catch (err) {
        if (err.message === "WAF_BLOCKED") {
          // Token kadaluarsa, panen ulang dan coba sekali lagi
          data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreList/v3?pageNo=${page}&pageSize=${pageSize}&storeName=${encodeURIComponent(keyword)}`);
        } else {
          throw err;
        }
      }
      
      const stores = data?.data?.records || [];
      
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify({
        outlets: stores.map(s => ({
          code: s.storeCode,
          name: s.storeName,
          address: s.storeAddress,
          city: s.city,
          category: "Coffee",
          lat: parseFloat(s.latitude),
          lng: parseFloat(s.longitude),
          img: s.storePicture,
          isOpen: s.businessStatus === 0,
          phone: s.storePhone,
          deliverable: s.isDelivery === 1,
          brands: ["Tomoro Coffee"]
        })),
        total: stores.length,
        page: parseInt(page),
        pages: 1,
        hasMore: false
      }));
      return;
    }

    // ─── GET /outlet-detail ───
    if (pathname === '/outlet-detail') {
      const code = reqUrl.searchParams.get("code") || "";
      
      let data;
      try {
        data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreDetail/v2?storeCode=${code}`);
      } catch (err) {
        if (err.message === "WAF_BLOCKED") {
          data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreDetail/v2?storeCode=${code}`);
        } else {
          throw err;
        }
      }
      
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify(data));
      return;
    }

    // ─── GET /menu ───
    if (pathname === '/menu') {
      const code = reqUrl.searchParams.get("code") || "";
      
      let data;
      try {
        data = await callTomoroApi(`/portal/app/basic/menu/getMenuList?storeCode=${code}&mainMenuType=1`);
      } catch (err) {
        if (err.message === "WAF_BLOCKED") {
          data = await callTomoroApi(`/portal/app/basic/menu/getMenuList?storeCode=${code}&mainMenuType=1`);
        } else {
          throw err;
        }
      }
      
      const allGroups = data?.data?.menuVos || [];
      const filtered = allGroups.filter(g => {
        const name = (g.menuName || "").toLowerCase();
        return !name.includes("merchandise");
      });

      const groups = filtered.map(g => ({
        code: g.menuCode,
        name: g.menuName,
        products: (g.items || []).map(p => ({
          id: p.code,
          name: p.name,
          description: p.desc || "",
          image: p.picture?.main || p.pictureUrls || "",
          price: p.price,
          origPrice: p.price,
          hasPromo: p.isSellOut === 1 && p.price < p.priceShow,
          isSoldOut: p.isSellOut === 0,
          brand: "Tomoro Coffee",
          productCode: p.code,
          bundleCode: null,
        })),
      })).filter(g => g.products.length > 0);

      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify({ groups }));
      return;
    }

    res.writeHead(404, CORS_HEADERS);
    res.end(JSON.stringify({ error: "Endpoint tidak ditemukan" }));

  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    res.writeHead(500, CORS_HEADERS);
    res.end(JSON.stringify({
      error: "SERVER_ERROR",
      message: `Gagal memproses request API: ${err.message}`
    }));
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 LOCAL / CLOUD PROXY SERVER ACTIVE!`);
  console.log(`======================================================`);
  console.log(`PORT                 : ${PORT}`);
  console.log(`Halaman Pemesanan    : http://localhost:${PORT}`);
  console.log(`Halaman Scraper      : http://localhost:${PORT}/scraper.html`);
  console.log(`======================================================\n`);
});
