// server.js - السيرفر الرئيسي مع جلب السعر الرسمي للدولار مقابل الجنيه المصري
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const TelegramBotManager = require("./telegramBot");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================================
// الإعدادات السرية (ضع بياناتك هنا أو في Environment Variables داخل Render)
// ============================================================================
const VIABTC_OBSERVER_URL = process.env.VIABTC_OBSERVER_URL || "ضع_رابط_المراقب_الخاص_بك_من_فيا_هنا";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "ضع_توكن_بوت_التيليجرام_هنا";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "ضع_ايدي_حسابك_في_تيليجرام_هنا";

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
        usdToEgpRate: 56.26, // السعر الرسمي الافتراضي للبنوك في حال انقطاع المصدر
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

// ============================================================================
// جلب سعر الدولار الرسمي في البنوك مقابل الجنيه المصري تلقائياً
// ============================================================================
async function updateOfficialExchangeRate() {
    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        if (data && data.rates && data.rates.EGP) {
            appState.usdToEgpRate = parseFloat(data.rates.EGP.toFixed(2));
            saveState(appState);
        }
    } catch (err) {
        console.error("تعذر تحديث سعر الصرف اللحظي، يتم استخدام آخر سعر رسمي مسجل:", appState.usdToEgpRate);
    }
    return appState.usdToEgpRate || 56.26;
}

// تحديث سعر الصرف عند تشغيل السيرفر وكل 30 دقيقة
updateOfficialExchangeRate();
setInterval(updateOfficialExchangeRate, 30 * 60 * 1000);

// ============================================================================
// ربط ملف التليجرام بالسيرفر لمعالجة القبول والرفض
// ============================================================================
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

// دالة جلب الرصيد من ViaBTC ومزامنته
async function syncViaBtcBalance() {
    try {
        if (!VIABTC_OBSERVER_URL.includes("ضع_رابط")) {
            const res = await fetch(VIABTC_OBSERVER_URL);
            const data = await res.json();
            const fetchedBalance = parseFloat(data?.data?.total_profit || data?.balance);

            if (!isNaN(fetchedBalance)) {
                if (appState.lastViaBtcBalance !== null && fetchedBalance < appState.lastViaBtcBalance) {
                    const diff = appState.lastViaBtcBalance - fetchedBalance;
                    appState.pendingDeduction = Math.max(0, appState.pendingDeduction - diff);
                }
                appState.lastViaBtcBalance = fetchedBalance;
                saveState(appState);
            }
        }
    } catch (err) {}

    const baseBalance = appState.lastViaBtcBalance ?? 240.00;
    return Math.max(0, baseBalance - appState.pendingDeduction);
}

// 1. مسار جلب الرصيد وسعر الصرف الرسمي وسجل العمليات
app.get("/api/balance", async (req, res) => {
    const availableBalance = await syncViaBtcBalance();
    res.json({
        success: true,
        balance: availableBalance.toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: appState.history
    });
});

// 2. مسار إنشاء طلب سحب جديد محول للجنيه المصري
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
        const netEgp = netUsd * currentRate; // التحويل إلى الجنيه المصري حسب سعر البنك
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

        // تمرير الطلب إلى ملف البوت مع المبلغ بالجنيه المصري
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

// 3. مسار مسح القائمة
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
});
