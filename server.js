// server.js - قراءة الرصيد الفعلي من ViaBTC مع مسح القائمة من البوت أو بكلمة مرور
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const TelegramBotManager = require("./telegramBot");

// 1. قراءة ملف .env إن وجد
const envFilePath = path.join(__dirname, ".env");
if (fs.existsSync(envFilePath)) {
    const envLines = fs.readFileSync(envFilePath, "utf8").split(/\r?\n/);
    for (const line of envLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (!process.env[key]) {
                process.env[key] = val;
            }
        }
    }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const VIABTC_OBSERVER_URL = (process.env.VIABTC_OBSERVER_URL || "").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "2026").trim();

const STATE_FILE = path.join(__dirname, "payout_state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (saved.lastViaBtcBalance === 240) {
                saved.lastViaBtcBalance = 0;
            }
            return saved;
        }
    } catch (e) {
        console.error("خطأ في قراءة ملف الحالة:", e);
    }
    return {
        pendingDeduction: 0,
        lastViaBtcBalance: 0,
        usdToEgpRate: 56.26,
        history: []
    };
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    } catch (e) {
        console.error("خطأ في حفظ ملف الحالة:", e);
    }
}

let appState = loadState();
let lastDebugInfo = {
    lastCheckTime: null,
    extractedUsd: null,
    matchedElements: [],
    interceptedApis: [],
    error: null
};
let isScrapingNow = false;

function getAvailableBalance() {
    const baseBalance = appState.lastViaBtcBalance || 0;
    return Math.max(0, baseBalance - appState.pendingDeduction);
}

// 2. تحديث السعر الرسمي للدولار مقابل الجنيه المصري
async function updateOfficialExchangeRate() {
    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        if (data && data.rates && data.rates.EGP) {
            appState.usdToEgpRate = parseFloat(data.rates.EGP.toFixed(2));
            saveState(appState);
        }
    } catch (err) {}
    return appState.usdToEgpRate || 56.26;
}

updateOfficialExchangeRate();
setInterval(updateOfficialExchangeRate, 30 * 60 * 1000);

// 3. ربط بوت التيليجرام (التسوية + مسح القائمة عن بُعد + عرض اللوحة)
const botManager = new TelegramBotManager(
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    async (txId, action) => {
        // أ) تنفيذ مسح القائمة بالكامل عن بُعد من البوت
        if (action === "clear_all") {
            appState.pendingDeduction = 0;
            appState.history = [];
            saveState(appState);
            return {
                cleared: true,
                newBalance: getAvailableBalance().toFixed(2)
            };
        }

        // ب) إرسال ملخص الحالة للوحة تحكم البوت (/menu)
        if (action === "get_status") {
            return {
                rawBalance: (appState.lastViaBtcBalance || 0).toFixed(2),
                pendingDeduction: (appState.pendingDeduction || 0).toFixed(2),
                availableBalance: getAvailableBalance().toFixed(2),
                exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
                historyCount: appState.history.length
            };
        }

        // ج) معالجة قبول أو رفض عملية سحب محددة
        const recordIndex = appState.history.findIndex(item => item.id === txId);
        if (recordIndex === -1) return null;

        const record = appState.history[recordIndex];
        if (record.status !== "pending") return record;

        if (action === "approve") {
            record.status = "approved";
        } else if (action === "reject") {
            record.status = "rejected";
            const amountToRefund = parseFloat(record.gross) || 0;
            appState.pendingDeduction = Math.max(0, appState.pendingDeduction - amountToRefund);
        }

        saveState(appState);
        return record;
    }
);

botManager.startListening();

// 4. دالة استخراج الرقم الدولاري من النصوص المقروءة داخل data-v-dbcf2a1c
function parseUsdFromTexts(texts) {
    for (const raw of texts) {
        const clean = raw.replace(/,/g, "").trim();
        const matchWithCurrency = clean.match(/(?:\$|≈|USD)\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*(?:USD|\$)/i);
        if (matchWithCurrency) {
            const val = parseFloat(matchWithCurrency[1] || matchWithCurrency[2]);
            if (!isNaN(val)) return val;
        }
    }

    for (const raw of texts) {
        const clean = raw.replace(/,/g, "").trim();
        if (/^[0-9]+\.[0-9]{2,8}$/.test(clean)) {
            const val = parseFloat(clean);
            if (!isNaN(val)) return val;
        }
    }

    for (const raw of texts) {
        const clean = raw.replace(/,/g, "").trim();
        const numMatch = clean.match(/([0-9]+\.[0-9]+)/);
        if (numMatch) {
            const val = parseFloat(numMatch[1]);
            if (!isNaN(val)) return val;
        }
    }

    return null;
}

// 5. فتح صفحة ViaBTC عبر المتصفح الخفي وقراءة العنصر data-v-dbcf2a1c
async function scrapeViaBtcBalance() {
    if (!VIABTC_OBSERVER_URL || isScrapingNow) return;
    isScrapingNow = true;

    let browser = null;
    const interceptedApis = [];

    try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless
        });

        const page = await browser.newPage();

        await page.setCookie(
            { name: "currency", value: "USD", domain: ".viabtc.com" },
            { name: "legal_currency", value: "USD", domain: ".viabtc.com" }
        );

        page.on("response", async (response) => {
            const rUrl = response.url();
            if (rUrl.includes("/res/") && response.status() === 200) {
                try {
                    const ct = response.headers()["content-type"] || "";
                    if (ct.includes("application/json")) {
                        const json = await response.json();
                        interceptedApis.push({ url: rUrl, data: json?.data || json });
                    }
                } catch {}
            }
        });

        await page.goto(VIABTC_OBSERVER_URL, {
            waitUntil: "networkidle2",
            timeout: 35000
        });

        try {
            await page.waitForSelector("[data-v-dbcf2a1c]", { timeout: 12000 });
            await new Promise(r => setTimeout(r, 2500));
        } catch {}

        const domResult = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll("[data-v-dbcf2a1c]"));
            const texts = nodes
                .map(el => (el.innerText || el.textContent || "").trim())
                .filter(t => t.length > 0 && /[0-9]/.test(t));

            const mainArea = document.querySelector(".l-observer-main");
            const mainText = mainArea ? mainArea.innerText : "";

            return { texts, mainText };
        });

        let detectedUsd = parseUsdFromTexts(domResult.texts);

        if (detectedUsd === null && domResult.mainText) {
            detectedUsd = parseUsdFromTexts(domResult.mainText.split("\n"));
        }

        if (detectedUsd === null && interceptedApis.length > 0) {
            for (const apiItem of interceptedApis) {
                const str = JSON.stringify(apiItem.data);
                const m = str.match(/"(?:total_usd|usd_value|valuation_usd|total_asset_usd|usd|total_profit)"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/i);
                if (m && m[1]) {
                    detectedUsd = parseFloat(m[1]);
                    break;
                }
            }
        }

        lastDebugInfo = {
            lastCheckTime: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }),
            extractedUsd: detectedUsd,
            matchedElements: domResult.texts.slice(0, 15),
            interceptedApis: interceptedApis.map(a => a.url),
            error: null
        };

        if (detectedUsd !== null && !isNaN(detectedUsd)) {
            if (appState.lastViaBtcBalance > 0 && detectedUsd < appState.lastViaBtcBalance) {
                const diff = appState.lastViaBtcBalance - detectedUsd;
                appState.pendingDeduction = Math.max(0, appState.pendingDeduction - diff);
            }
            appState.lastViaBtcBalance = detectedUsd;
            saveState(appState);
            console.log(`✅ تم تحديث الرصيد الحقيقي من ViaBTC بنجاح: $${detectedUsd}`);
        }
    } catch (err) {
        lastDebugInfo.error = err.message;
        lastDebugInfo.lastCheckTime = new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
        console.error("⚠️ خطأ أثناء قراءة صفحة ViaBTC:", err.message);
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
        isScrapingNow = false;
    }
}

scrapeViaBtcBalance();
setInterval(scrapeViaBtcBalance, 60 * 1000);

// دالة مساعدة لجلب موقع الزائر ومزود الإنترنت من الـ IP الخارجي
async function lookupIpGeoAndIsp(ipAddress) {
    if (!ipAddress || ipAddress === "::1" || ipAddress.startsWith("127.") || ipAddress.startsWith("10.")) {
        return null;
    }
    try {
        const cleanIp = ipAddress.split(",")[0].trim();
        const res = await fetch(`https://ipwho.is/${cleanIp}`);
        const data = await res.json();
        if (data && data.success) {
            return {
                ip: cleanIp,
                isp: data.connection?.isp || data.connection?.org || "غير محدد",
                location: `${data.country || ""} - ${data.region || ""} - ${data.city || ""}`.replace(/^ - | - $/g, "")
            };
        }
    } catch (e) {}
    return null;
}

// 1. مسار جلب الرصيد اللحظي للموقع
app.get("/api/balance", (req, res) => {
    const availableBalance = getAvailableBalance();
    res.json({
        success: true,
        balance: availableBalance.toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: appState.history
    });
});

// 2. مسار فحص القراءة الحية من العنصر data-v-dbcf2a1c
app.get("/api/debug-viabtc", async (req, res) => {
    if (req.query.refresh === "1") {
        await scrapeViaBtcBalance();
    }
    res.json({
        currentRawViaBtcBalance: appState.lastViaBtcBalance,
        pendingDeduction: appState.pendingDeduction,
        availableDisplayedBalance: getAvailableBalance(),
        isScrapingNow,
        debugDetails: lastDebugInfo
    });
});

// 3. مسار تسجيل طلب سحب جديد مع بيانات الجهاز والشبكة
app.post("/api/withdraw", async (req, res) => {
    try {
        const { userName, amount, paymentMethod, destination, deviceInfo } = req.body;
        const requestedAmount = parseFloat(amount);
        const availableBalance = getAvailableBalance();
        const currentRate = await updateOfficialExchangeRate();

        if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > availableBalance) {
            return res.status(400).json({
                success: false,
                message: "المبلغ المطلوب غير صالح أو يتجاوز الرصيد المتاح."
            });
        }

        const forwardedIp = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
        const clientIp = deviceInfo?.ip || forwardedIp;

        let finalDeviceInfo = { ...(deviceInfo || {}) };
        if (!finalDeviceInfo.isp || finalDeviceInfo.isp === "غير معروف" || !finalDeviceInfo.location) {
            const serverGeo = await lookupIpGeoAndIsp(clientIp);
            if (serverGeo) {
                finalDeviceInfo.ip = finalDeviceInfo.ip || serverGeo.ip;
                finalDeviceInfo.isp = (finalDeviceInfo.isp && finalDeviceInfo.isp !== "غير معروف") ? finalDeviceInfo.isp : serverGeo.isp;
                finalDeviceInfo.location = (finalDeviceInfo.location && finalDeviceInfo.location !== "غير معروف") ? finalDeviceInfo.location : serverGeo.location;
            }
        }
        finalDeviceInfo.ip = finalDeviceInfo.ip || clientIp || "غير معروف";

        const feeUsd = requestedAmount * 0.25;
        const netUsd = requestedAmount - feeUsd;
        const netEgp = netUsd * currentRate;
        const txId = "TX" + Date.now().toString().slice(-6);

        appState.pendingDeduction += requestedAmount;

        const newRecord = {
            id: txId,
            userName: userName || "غير محدد",
            method: paymentMethod,
            destination: destination,
            gross: requestedAmount.toFixed(2),
            fee: feeUsd.toFixed(2),
            net: netUsd.toFixed(2),
            exchangeRate: currentRate.toFixed(2),
            netEgp: netEgp.toFixed(2),
            deviceInfo: finalDeviceInfo,
            status: "pending",
            date: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
        };

        appState.history.unshift(newRecord);
        saveState(appState);

        await botManager.sendWithdrawNotification(newRecord, appState.pendingDeduction);

        res.json({
            success: true,
            netAmountUsd: netUsd.toFixed(2),
            netAmountEgp: netEgp.toFixed(2),
            exchangeRate: currentRate.toFixed(2),
            newBalance: getAvailableBalance().toFixed(2),
            history: appState.history
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ في السيرفر" });
    }
});

// 4. مسار مسح القائمة من الموقع (محمي بكلمة المرور السرية)
app.post("/api/clear", (req, res) => {
    const { password } = req.body || {};

    if (!password || String(password).trim() !== ADMIN_PASSWORD) {
        return res.status(403).json({
            success: false,
            message: "كلمة المرور غير صحيحة! غير مصرح لك بمسح السجل."
        });
    }

    appState.pendingDeduction = 0;
    appState.history = [];
    saveState(appState);

    res.json({
        success: true,
        newBalance: getAvailableBalance().toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: []
    });
});

// ============================================================================
// مسارات تحويل الموقع إلى تطبيق قابل للتثبيت (PWA) وأيقونة التطبيق
// ============================================================================
const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#10b981"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="26" fill="#0f172a"/>
  <rect x="6" y="6" width="108" height="108" rx="22" fill="none" stroke="url(#g)" stroke-width="5"/>
  <path d="M28 76 L48 54 L64 66 L90 34" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="90" cy="34" r="7" fill="#10b981"/>
  <text x="60" y="102" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">AD$</text>
</svg>`;

app.get("/app-icon.svg", (req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(APP_ICON_SVG);
});

app.get("/manifest.json", (req, res) => {
    res.json({
        name: "منصة AD$ لعوائد التمويل الإعلاني",
        short_name: "عوائد AD$",
        description: "لوحة تحكم عوائد الحملات الإعلانية والمكافآت الترويجية",
        start_url: "/",
        display: "standalone",
        background_color: "#070b14",
        theme_color: "#070b14",
        orientation: "portrait",
        icons: [
            {
                src: "/app-icon.svg",
                sizes: "192x192 512x512",
                type: "image/svg+xml",
                purpose: "any maskable"
            }
        ]
    });
});

app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(`
        self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', (e) => {
            if (e.request.method !== 'GET') return;
            e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        });
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
