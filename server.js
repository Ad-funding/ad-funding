// server.js - يدعم قراءة .env واستخراج رصيد محفظة مراقب ViaBTC تلقائياً
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const TelegramBotManager = require("./telegramBot");

// 1. قراءة ملف .env تلقائياً إن وجد بجانب إعدادات Render Environment
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

// 2. قراءة المتغيرات البيئية
const VIABTC_OBSERVER_URL = (process.env.VIABTC_OBSERVER_URL || "").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();

const STATE_FILE = path.join(__dirname, "payout_state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        }
    } catch (e) {
        console.error("خطأ في قراءة ملف الحالة:", e);
    }
    return {
        pendingDeduction: 0,
        lastViaBtcBalance: 240.00,
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

// 3. تحديث السعر الرسمي للدولار مقابل الجنيه المصري
async function updateOfficialExchangeRate() {
    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        if (data && data.rates && data.rates.EGP) {
            appState.usdToEgpRate = parseFloat(data.rates.EGP.toFixed(2));
            saveState(appState);
        }
    } catch (err) {
        console.error("يتم استخدام آخر سعر صرف محفوظ:", appState.usdToEgpRate);
    }
    return appState.usdToEgpRate || 56.26;
}

updateOfficialExchangeRate();
setInterval(updateOfficialExchangeRate, 30 * 60 * 1000);

// 4. ربط بوت التيليجرام بمعالجة طلبات السحب
const botManager = new TelegramBotManager(
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    async (txId, action) => {
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

// 5. استخراج access_key وجلب رصيد محفظة المراقب من ViaBTC بالدولار
function extractAccessKey(urlStr) {
    try {
        const parsed = new URL(urlStr);
        return parsed.searchParams.get("access_key") || "";
    } catch {
        const match = urlStr.match(/access_key=([a-zA-Z0-9]+)/);
        return match ? match[1] : "";
    }
}

async function fetchViaBtcUsdTotal() {
    if (!VIABTC_OBSERVER_URL) return null;

    const accessKey = extractAccessKey(VIABTC_OBSERVER_URL);
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*"
    };

    // المحاولة الأولى: طلب واجهة برمجة محفظة المراقب الرسمية في ViaBTC
    if (accessKey) {
        const apiEndpoints = [
            `https://www.viabtc.com/res/observer/wallet/balance?access_key=${accessKey}`,
            `https://www.viabtc.com/res/observer/wallet/summary?access_key=${accessKey}`
        ];

        for (const endpoint of apiEndpoints) {
            try {
                const res = await fetch(endpoint, { headers });
                const contentType = res.headers.get("content-type") || "";
                if (contentType.includes("application/json")) {
                    const json = await res.json();
                    const payload = json?.data || json;

                    // إذا كان هناك حقل إجمالي بالدولار مباشرة
                    const directUsd = parseFloat(
                        payload?.total_usd ??
                        payload?.usd_balance ??
                        payload?.total_profit ??
                        payload?.total_asset_usd ??
                        payload?.balance
                    );
                    if (!isNaN(directUsd) && directUsd >= 0) {
                        return directUsd;
                    }

                    // إذا أعاد قائمة عملات داخل المحفظة، نحسب قيمتها بالدولار
                    if (Array.isArray(payload)) {
                        let sumUsd = 0;
                        for (const coinObj of payload) {
                            const val = parseFloat(coinObj.usd_value || coinObj.estimated_usd || 0);
                            if (!isNaN(val)) sumUsd += val;
                        }
                        if (sumUsd > 0) return sumUsd;
                    }
                }
            } catch (e) {}
        }
    }

    // المحاولة الثانية: قراءة الرابط المباشر واستخراج القيمة الدولارية منه
    try {
        const res = await fetch(VIABTC_OBSERVER_URL, { headers });
        const text = await res.text();

        // إذا كان الرد JSON
        try {
            const data = JSON.parse(text);
            const parsedVal = parseFloat(data?.data?.total_profit || data?.data?.total_usd || data?.balance);
            if (!isNaN(parsedVal)) return parsedVal;
        } catch {}

        // إذا كان الرد صفحة HTML تحتوي على قيمة الرصيد بالدولار
        const usdMatch = text.match(/(?:total_usd|usd_value|total_asset)[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
        if (usdMatch && usdMatch[1]) {
            return parseFloat(usdMatch[1]);
        }
    } catch (err) {
        console.error("تعذر قراءة رابط ViaBTC:", err.message);
    }

    return null;
}

async function syncViaBtcBalance() {
    const fetchedBalance = await fetchViaBtcUsdTotal();

    if (fetchedBalance !== null && !isNaN(fetchedBalance)) {
        // إذا انخفض رصيد ViaBTC الفعلي نتيجة سحبك الحقيقي منه
        if (appState.lastViaBtcBalance !== null && fetchedBalance < appState.lastViaBtcBalance) {
            const diff = appState.lastViaBtcBalance - fetchedBalance;
            appState.pendingDeduction = Math.max(0, appState.pendingDeduction - diff);
        }
        appState.lastViaBtcBalance = fetchedBalance;
        saveState(appState);
    }

    const baseBalance = appState.lastViaBtcBalance ?? 240.00;
    return Math.max(0, baseBalance - appState.pendingDeduction);
}

// مسار جلب الرصيد وسعر الصرف وسجل السحوبات
app.get("/api/balance", async (req, res) => {
    const availableBalance = await syncViaBtcBalance();
    res.json({
        success: true,
        balance: availableBalance.toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: appState.history
    });
});

// مسار فحص حالة الربط (لتتأكد من قراءة متغيرات .env بنجاح)
app.get("/api/status", async (req, res) => {
    const accessKey = extractAccessKey(VIABTC_OBSERVER_URL);
    res.json({
        envLoaded: {
            hasViaBtcUrl: Boolean(VIABTC_OBSERVER_URL),
            extractedAccessKey: accessKey ? `${accessKey.slice(0, 6)}...` : "غير موجود",
            hasTelegramToken: Boolean(TELEGRAM_BOT_TOKEN),
            telegramChatId: TELEGRAM_CHAT_ID || "غير موجود"
        },
        currentRawBalance: appState.lastViaBtcBalance,
        pendingDeduction: appState.pendingDeduction,
        exchangeRate: appState.usdToEgpRate
    });
});

// مسار تسجيل طلب سحب جديد
app.post("/api/withdraw", async (req, res) => {
    try {
        const { userName, amount, paymentMethod, destination } = req.body;
        const requestedAmount = parseFloat(amount);
        const availableBalance = await syncViaBtcBalance();
        const currentRate = await updateOfficialExchangeRate();

        if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > availableBalance) {
            return res.status(400).json({
                success: false,
                message: "المبلغ المطلوب غير صالح أو يتجاوز الرصيد المتاح."
            });
        }

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
            status: "pending",
            date: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
        };

        appState.history.unshift(newRecord);
        saveState(appState);

        await botManager.sendWithdrawNotification(newRecord, appState.pendingDeduction);

        const newAvailable = Math.max(0, (appState.lastViaBtcBalance ?? 240.00) - appState.pendingDeduction);

        res.json({
            success: true,
            netAmountUsd: netUsd.toFixed(2),
            netAmountEgp: netEgp.toFixed(2),
            exchangeRate: currentRate.toFixed(2),
            newBalance: newAvailable.toFixed(2),
            history: appState.history
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ في السيرفر" });
    }
});

// مسار مسح القائمة
app.post("/api/clear", async (req, res) => {
    appState.pendingDeduction = 0;
    appState.history = [];
    saveState(appState);

    const availableBalance = await syncViaBtcBalance();
    res.json({
        success: true,
        newBalance: availableBalance.toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: []
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 ViaBTC Access Key loaded: ${Boolean(extractAccessKey(VIABTC_OBSERVER_URL))}`);
});
