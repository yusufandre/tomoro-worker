// @ts-nocheck
import puppeteer from '@cloudflare/puppeteer';

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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const EXCLUDED_GROUPS = ["merchandise"];

// Menyimpan token WAF aktif di memori instance Worker untuk mengurangi pemanggilan browser
let cachedWafToken = "";
let harvestPromise = null;

const delay = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fungsi untuk membuka browser headless Cloudflare dan memanen token baru
 */
async function harvestWafToken(browserBinding) {
  console.log("[WAF] Memanen token WAF baru menggunakan Cloudflare Browser Rendering...");
  if (!browserBinding) {
    throw new Error("MY_BROWSER binding is not defined! Pastikan Anda sudah menambahkan binding 'Browser Run' dengan nama 'MY_BROWSER' di settings Worker Anda.");
  }
  
  const browser = await puppeteer.launch(browserBinding);
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
  
  let detectedToken = "";
  
  // Intercept request untuk menangkap token
  page.on('request', req => {
    const url = req.url();
    if (url.includes('acw_sc__v2=')) {
      const match = url.match(/acw_sc__v2=([^&]+)/);
      if (match) detectedToken = match[1];
    }
  });

  try {
    // Buka H5 App untuk memicu bypass WAF di browser
    await page.goto('https://h5-app.tomoro-coffee.id/order/', { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });
    
    await delay(4000);
    
    // Ambil langsung dari cookies jika ada
    const cookies = await page.cookies();
    const wafCookie = cookies.find(c => c.name === 'acw_sc__v2');
    
    if (wafCookie && wafCookie.value) {
      detectedToken = wafCookie.value;
    }
    
    if (detectedToken) {
      console.log("[WAF] Token WAF berhasil didapatkan:", detectedToken);
      cachedWafToken = detectedToken;
      return detectedToken;
    }
    throw new Error("Tidak menemukan cookie acw_sc__v2 setelah memuat halaman.");
  } catch (err) {
    console.error("[WAF] Gagal saat memanen token:", err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

/**
 * Mendapatkan token aktif atau memanen token baru (menghindari perlombaan request / concurrency)
 */
async function getOrHarvestToken(browserBinding) {
  if (cachedWafToken) return cachedWafToken;
  
  if (harvestPromise) {
    console.log("[WAF] Menunggu pemanenan token yang sedang berjalan...");
    return harvestPromise;
  }
  
  harvestPromise = harvestWafToken(browserBinding).then(token => {
    harvestPromise = null;
    return token;
  }).catch(err => {
    harvestPromise = null;
    throw err;
  });
  
  return harvestPromise;
}

/**
 * Panggil API Tomoro secara langsung (direct HTTP fetch tanpa browser)
 */
async function callTomoroApi(pathAndQuery) {
  const connector = pathAndQuery.includes('?') ? '&' : '?';
  const url = `${TOMORO_BASE}${pathAndQuery}${connector}acw_sc__v2=${cachedWafToken}`;
  
  console.log(`[API] Fetching: ${url}`);
  
  const response = await fetch(url, { 
    headers: {
      ...TOMORO_HEADERS,
      'Cookie': `acw_sc__v2=${cachedWafToken}`
    } 
  });
  
  const text = await response.text();
  
  if (text.includes('<!DOCTYPE html>') || text.includes('_waf_')) {
    return { error: 'WAF_BLOCKED' };
  }
  
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS });
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // ─── GET /debug ──────────────────────────────────────────────────
      if (path === "/debug" && request.method === "GET") {
        return new Response(JSON.stringify({
          status: "OK",
          cached_token: cachedWafToken ? `${cachedWafToken.slice(0, 6)}...` : "empty",
          browser_binding_configured: !!env.MY_BROWSER
        }), { headers: CORS });
      }

      // 1. Ambil token WAF dari KV Cache jika ada (opsional, jika Anda membuat KV namespace bernama TOMORO_CACHE)
      if (env.TOMORO_CACHE && !cachedWafToken) {
        cachedWafToken = await env.TOMORO_CACHE.get("waf_token") || "";
      }

      // 2. Jika tidak ada token di cache, panen dulu
      if (!cachedWafToken) {
        try {
          await getOrHarvestToken(env.MY_BROWSER);
          if (env.TOMORO_CACHE && cachedWafToken) {
            await env.TOMORO_CACHE.put("waf_token", cachedWafToken, { expirationTtl: 3600 }); // simpan 1 jam
          }
        } catch (err) {
          if (err.message.includes("429") || err.message.includes("Rate limit")) {
            return new Response(JSON.stringify({
              error: "WAF_BLOCKED",
              reason: "CLOUDFLARE_RATE_LIMIT",
              message: "Batas limit harian browser Cloudflare Workers Anda habis. Silakan tunggu besok atau gunakan input manual."
            }), { status: 429, headers: CORS });
          }
          throw err;
        }
      }

      // ─── GET /outlets ────────────────────────────────────────────────
      if (path === "/outlets" && request.method === "GET") {
        const keyword = url.searchParams.get("keyword") || "";
        const page = parseInt(url.searchParams.get("page") || "1");
        const pageSize = parseInt(url.searchParams.get("page_size") || "20");

        let data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreList/v3?pageNo=${page}&pageSize=${pageSize}&storeName=${encodeURIComponent(keyword)}`);
        
        // Jika token kadaluarsa (WAF memblokir), panen token baru dan coba sekali lagi
        if (data.error === 'WAF_BLOCKED') {
          console.log("[WAF] Token kadaluarsa. Memanen ulang...");
          cachedWafToken = "";
          if (env.TOMORO_CACHE) await env.TOMORO_CACHE.delete("waf_token");
          
          try {
            await getOrHarvestToken(env.MY_BROWSER);
            if (env.TOMORO_CACHE && cachedWafToken) {
              await env.TOMORO_CACHE.put("waf_token", cachedWafToken, { expirationTtl: 3600 });
            }
            // Coba fetch ulang API
            data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreList/v3?pageNo=${page}&pageSize=${pageSize}&storeName=${encodeURIComponent(keyword)}`);
          } catch (err) {
            return new Response(JSON.stringify({ error: "WAF_BLOCKED", reason: "HARVEST_FAILED", message: err.message }), { status: 403, headers: CORS });
          }
        }

        const stores = data?.data?.records || [];
        return new Response(JSON.stringify({
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
          page: page,
          pages: 1,
          hasMore: false
        }), { headers: CORS });
      }

      // ─── GET /outlet-detail ──────────────────────────────────────────
      if (path === "/outlet-detail" && request.method === "GET") {
        const code = url.searchParams.get("code") || "";
        let data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreDetail/v2?storeCode=${code}`);
        
        if (data.error === 'WAF_BLOCKED') {
          cachedWafToken = "";
          if (env.TOMORO_CACHE) await env.TOMORO_CACHE.delete("waf_token");
          try {
            await getOrHarvestToken(env.MY_BROWSER);
            if (env.TOMORO_CACHE && cachedWafToken) {
              await env.TOMORO_CACHE.put("waf_token", cachedWafToken, { expirationTtl: 3600 });
            }
            data = await callTomoroApi(`/portal/app/basic/storeInfo/getStoreDetail/v2?storeCode=${code}`);
          } catch (err) {
            return new Response(JSON.stringify({ error: "WAF_BLOCKED", message: err.message }), { status: 403, headers: CORS });
          }
        }
        return new Response(JSON.stringify(data), { headers: CORS });
      }

      // ─── GET /menu ───────────────────────────────────────────────────
      if (path === "/menu" && request.method === "GET") {
        const code = url.searchParams.get("code") || "";
        let data = await callTomoroApi(`/portal/app/basic/menu/getMenuList?storeCode=${code}&mainMenuType=1`);
        
        if (data.error === 'WAF_BLOCKED') {
          cachedWafToken = "";
          if (env.TOMORO_CACHE) await env.TOMORO_CACHE.delete("waf_token");
          try {
            await getOrHarvestToken(env.MY_BROWSER);
            if (env.TOMORO_CACHE && cachedWafToken) {
              await env.TOMORO_CACHE.put("waf_token", cachedWafToken, { expirationTtl: 3600 });
            }
            data = await callTomoroApi(`/portal/app/basic/menu/getMenuList?storeCode=${code}&mainMenuType=1`);
          } catch (err) {
            return new Response(JSON.stringify({ error: "WAF_BLOCKED", message: err.message }), { status: 403, headers: CORS });
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

        return new Response(JSON.stringify({ groups }), { headers: CORS });
      }

      return new Response(JSON.stringify({ error: "Endpoint tidak ditemukan" }), { status: 404, headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({
        error: "INTERNAL_SERVER_ERROR",
        message: e.message,
        stack: e.stack
      }), { status: 500, headers: CORS });
    }
  }
};
