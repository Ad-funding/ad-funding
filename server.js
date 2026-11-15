// server.js - نظام تعدد المشتركين (لكل مشترك رابط ViaBTC مستقل + تسجيل بالبطاقة + OTP 7 أرقام)
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

const DEFAULT_VIABTC_URL = (process.env.VIABTC_OBSERVER_URL || "").trim();
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "2026").trim();
const WHATSAPP_API_URL = (process.env.WHATSAPP_API_URL || "").trim();
const WHATSAPP_API_TOKEN = (process.env.WHATSAPP_API_TOKEN || "").trim();

const STATE_FILE = path.join(__dirname, "multi_payout_state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        }
    } catch (e) {}
    return {
        usdToEgpRate: 56.26,
        maintenanceEndTime: 0,
        usersState: {}, // حالة الرصيد والسجل لكل رقم هاتف مستقل
        passwordOverrides: {} // حفظ كلمات المرور المحدثة عبر نسيان الباسورد
    };
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(appState, null, 2), "utf8");
    } catch (e) {}
}

let appState = loadState();
const activeSessions = new Map(); // token -> phone
const otpStore = new Map(); // phone -> { code, expires, purpose }

// ============================================================================
// 2. قراءة حسابات المشتركين من Environment Variables (USER_01xxxxxxxxx)
// ============================================================================
function getRegisteredUsersMap() {
    const users = {};

    for (const [key, val] of Object.entries(process.env)) {
        if (key.startsWith("USER_01") && val) {
            const phone = key.replace("USER_", "").trim();
            const parts = val.split("|").map(s => s.trim());
            if (parts.length >= 2) {
                const name = parts[0] || "مشترك معتمد";
                const envPassword = parts[1];
                const viabtcUrl = parts[2] || DEFAULT_VIABTC_URL;
                const finalPassword = appState.passwordOverrides?.[phone] || envPassword;

                users[phone] = {
                    phone,
                    name,
                    password: finalPassword,
                    viabtcUrl
                };
            }
        }
    }

    return users;
}

function ensureUserState(phone) {
    if (!appState.usersState[phone]) {
        appState.usersState[phone] = {
            pendingDeduction: 0,
            lastViaBtcBalance: 0,
            history: []
        };
    }
    return appState.usersState[phone];
}

function getUserAvailableBalance(phone) {
    const uState = ensureUserState(phone);
    return Math.max(0, (uState.lastViaBtcBalance || 0) - (uState.pendingDeduction || 0));
}

// ============================================================================
// 3. إعداد Express وفحص وضع الصيانة
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" })); // السماح برفع صورة البطاقة الشخصية

app.use((req, res, next) => {
    const endTime = appState.maintenanceEndTime || 0;
    if (endTime > 0 && Date.now() >= endTime) {
        appState.maintenanceEndTime = 0;
        saveState();
    }

    const isMaintenanceActive = (appState.maintenanceEndTime || 0) > Date.now();
    if (
        req.path.startsWith("/api/") ||
        req.path === "/dev-panel-lock" ||
        req.path === "/maintenance.html" ||
        req.path === "/protection.js" ||
        req.path === "/app-icon.svg" ||
        req.path === "/manifest.json" ||
        req.path === "/sw.js"
    ) {
        return next();
    }

    if (isMaintenanceActive) {
        return res.sendFile(path.join(__dirname, "maintenance.html"));
    }
    next();
});

app.use(express.static(__dirname));

// ============================================================================
// 4. تحديث سعر الصرف الرسمي للبنوك
// ============================================================================
async function updateOfficialExchangeRate() {
    try {
        const res = await fetch("https://open.er-api.com/v6/latest/USD");
        const data = await res.json();
        if (data && data.rates && data.rates.EGP) {
            appState.usdToEgpRate = parseFloat(data.rates.EGP.toFixed(2));
            saveState();
        }
    } catch (err) {}
    return appState.usdToEgpRate || 56.26;
}

updateOfficialExchangeRate();
setInterval(updateOfficialExchangeRate, 30 * 60 * 1000);

// ============================================================================
// 5. ربط بوت التيليجرام بمعالجة الحسابات المتعددة
// ============================================================================
const botManager = new TelegramBotManager(
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    async (targetPhone, action, txId) => {
        if (action === "clear_all") {
            for (const phoneKey of Object.keys(appState.usersState)) {
                appState.usersState[phoneKey].pendingDeduction = 0;
                appState.usersState[phoneKey].history = [];
            }
            saveState();
            return { cleared: true };
        }

        if (action === "clear_user") {
            const uState = ensureUserState(targetPhone);
            uState.pendingDeduction = 0;
            uState.history = [];
            saveState();
            return { cleared: true };
        }

        if (action === "get_status") {
            const usersMap = getRegisteredUsersMap();
            let totalHistory = 0;
            for (const u of Object.values(appState.usersState)) {
                totalHistory += (u.history?.length || 0);
            }
            return {
                usersCount: Object.keys(usersMap).length,
                exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
                historyCount: totalHistory
            };
        }

        const uState = ensureUserState(targetPhone);
        const recordIndex = uState.history.findIndex(item => item.id === txId);
        if (recordIndex === -1) return null;

        const record = uState.history[recordIndex];
        if (record.status !== "pending") return record;

        if (action === "approve") {
            record.status = "approved";
        } else if (action === "reject") {
            record.status = "rejected";
            const amountToRefund = parseFloat(record.gross) || 0;
            uState.pendingDeduction = Math.max(0, uState.pendingDeduction - amountToRefund);
        }

        saveState();
        return record;
    }
);

botManager.startListening();

// ============================================================================
// 6. قراءة رصيد ViaBTC المستقل لكل مشترك (data-v-dbcf2a1c)
// ============================================================================
let isScrapingNow = false;

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

async function scrapeAllUsersViaBtc() {
    if (isScrapingNow) return;
    const usersMap = getRegisteredUsersMap();
    const userEntries = Object.values(usersMap).filter(u => u.viabtcUrl && u.viabtcUrl.startsWith("http"));
    if (userEntries.length === 0) return;

    isScrapingNow = true;
    let browser = null;

    try {
        const executablePath = await chromium.executablePath();
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium.headless
        });

        for (const user of userEntries) {
            const page = await browser.newPage();
            const interceptedApis = [];

            try {
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

                await page.goto(user.viabtcUrl, { waitUntil: "networkidle2", timeout: 35000 });
                try {
                    await page.waitForSelector("[data-v-dbcf2a1c]", { timeout: 10000 });
                    await new Promise(r => setTimeout(r, 2000));
                } catch {}

                const domResult = await page.evaluate(() => {
                    const nodes = Array.from(document.querySelectorAll("[data-v-dbcf2a1c]"));
                    const texts = nodes
                        .map(el => (el.innerText || el.textContent || "").trim())
                        .filter(t => t.length > 0 && /[0-9]/.test(t));
                    const mainArea = document.querySelector(".l-observer-main");
                    return { texts, mainText: mainArea ? mainArea.innerText : "" };
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

                if (detectedUsd !== null && !isNaN(detectedUsd)) {
                    const uState = ensureUserState(user.phone);
                    if (uState.lastViaBtcBalance > 0 && detectedUsd < uState.lastViaBtcBalance) {
                        const diff = uState.lastViaBtcBalance - detectedUsd;
                        uState.pendingDeduction = Math.max(0, uState.pendingDeduction - diff);
                    }
                    uState.lastViaBtcBalance = detectedUsd;
                    saveState();
                }
            } catch (e) {
                console.error(`خطأ قراءة ViaBTC للمشترك ${user.phone}:`, e.message);
            } finally {
                try { await page.close(); } catch {}
            }
        }
    } catch (err) {
        console.error("خطأ في تشغيل متصفح القراءة:", err.message);
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
        isScrapingNow = false;
    }
}

scrapeAllUsersViaBtc();
setInterval(scrapeAllUsersViaBtc, 60 * 1000);

// ============================================================================
// 7. إرسال كود التحقق OTP (7 أرقام) عبر واتساب + إشعار البوت
// ============================================================================
async function sendWhatsAppSevenDigitOtp(phone, otpCode, purpose) {
    let sentViaApi = false;
    const intlPhone = "2" + phone;
    const messageBody = `منصة AD$ للتمويل الإعلاني\nكود التحقق الخاص بك المكون من 7 أرقام هو: ${otpCode}`;

    // إذا قام المشرف بإضافة WHATSAPP_API_URL في Environment يرسل تلقائياً
    if (WHATSAPP_API_URL) {
        try {
            const res = await fetch(WHATSAPP_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: WHATSAPP_API_TOKEN,
                    to: `+${intlPhone}`,
                    body: messageBody
                })
            });
            if (res.ok) sentViaApi = true;
        } catch (e) {}
    }

    // إرسال الكود لبوت الإدارة مع زر توجيه فوري لواتساب المشترك
    await botManager.sendOtpAlertToAdmin(phone, otpCode, purpose, sentViaApi);
}

// مسار طلب كود واتساب من 7 أرقام (للتسجيل أو نسيان كلمة المرور)
app.post("/api/auth/send-otp", async (req, res) => {
    const { phone, purpose } = req.body || {};
    const cleanPhone = String(phone || "").trim();

    if (!/^01[0-9]{9}$/.test(cleanPhone)) {
        return res.status(400).json({
            success: false,
            message: "يرجى إدخال رقم هاتف مصري صحيح يبدأ بـ 01 ومكون من 11 رقماً."
        });
    }

    const usersMap = getRegisteredUsersMap();
    if (purpose === "reset" && !usersMap[cleanPhone]) {
        return res.status(404).json({
            success: false,
            message: "رقم الهاتف هذا غير مسجل في المنصة حالياً."
        });
    }

    // توليد كود من 7 أرقام بالضبط
    const otpCode = String(Math.floor(1000000 + Math.random() * 9000000));
    otpStore.set(cleanPhone, {
        code: otpCode,
        purpose: purpose || "register",
        expires: Date.now() + 10 * 60 * 1000 // صالح لمدة 10 دقائق
    });

    await sendWhatsAppSevenDigitOtp(cleanPhone, otpCode, purpose || "register");

    res.json({
        success: true,
        message: "تم إصدار كود المصادقة المكون من 7 أرقام وإرساله عبر واتساب."
    });
});

// مسار تسجيل مشترك جديد مع صورة البطاقة الشخصية وكود الـ 7 أرقام
app.post("/api/auth/register", async (req, res) => {
    try {
        const { fullName, phone, password, otpCode, idCardBase64, deviceInfo } = req.body || {};
        const cleanPhone = String(phone || "").trim();
        const cleanOtp = String(otpCode || "").trim();

        if (!fullName || !/^01[0-9]{9}$/.test(cleanPhone) || !password || password.length < 4) {
            return res.status(400).json({
                success: false,
                message: "يرجى استكمال الاسم ورقم الهاتف (11 رقماً) وكلمة المرور بشكل صحيح."
            });
        }

        if (!/^\d{7}$/.test(cleanOtp)) {
            return res.status(400).json({
                success: false,
                message: "كود التحقق يجب أن يتكون من 7 أرقام."
            });
        }

        const savedOtp = otpStore.get(cleanPhone);
        if (!savedOtp || savedOtp.code !== cleanOtp || Date.now() > savedOtp.expires) {
            return res.status(400).json({
                success: false,
                message: "كود التحقق (7 أرقام) غير صحيح أو منتهي الصلاحية."
            });
        }

        if (!idCardBase64) {
            return res.status(400).json({
                success: false,
                message: "يرجى تصوير أو إرفاق صورة البطاقة الشخصية لإتمام التوثيق."
            });
        }

        otpStore.delete(cleanPhone);

        await botManager.sendNewRegistrationWithIdCard({
            fullName: fullName.trim(),
            phone: cleanPhone,
            password: password.trim(),
            idCardBase64,
            deviceInfo,
            date: new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })
        });

        res.json({
            success: true,
            message: "تم التحقق من الكود وإرسال بياناتك وصورة البطاقة للإدارة لتفعيل حسابك المستقل!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء إرسال طلب التسجيل." });
    }
});

// مسار تسجيل الدخول برقم الهاتف وكلمة المرور
app.post("/api/auth/login", (req, res) => {
    const { phone, password } = req.body || {};
    const cleanPhone = String(phone || "").trim();
    const cleanPass = String(password || "").trim();

    const usersMap = getRegisteredUsersMap();
    const user = usersMap[cleanPhone];

    if (!user || user.password !== cleanPass) {
        return res.status(401).json({
            success: false,
            message: "رقم الهاتف أو كلمة المرور غير صحيحة، أو لم يتم تفعيل حسابك في Environment بعد."
        });
    }

    const token = crypto.randomBytes(24).toString("hex");
    activeSessions.set(token, cleanPhone);

    res.json({
        success: true,
        token,
        user: {
            phone: user.phone,
            name: user.name
        }
    });
});

// مسار استعادة وتغيير كلمة المرور بكود الـ 7 أرقام
app.post("/api/auth/reset-password", async (req, res) => {
    const { phone, otpCode, newPassword } = req.body || {};
    const cleanPhone = String(phone || "").trim();
    const cleanOtp = String(otpCode || "").trim();

    const usersMap = getRegisteredUsersMap();
    const user = usersMap[cleanPhone];

    if (!user) {
        return res.status(404).json({ success: false, message: "رقم الهاتف غير مسجل." });
    }

    const savedOtp = otpStore.get(cleanPhone);
    if (!savedOtp || savedOtp.code !== cleanOtp || Date.now() > savedOtp.expires) {
        return res.status(400).json({
            success: false,
            message: "كود التحقق المكون من 7 أرقام غير صحيح أو منتهي الصلاحية."
        });
    }

    if (!newPassword || String(newPassword).trim().length < 4) {
        return res.status(400).json({
            success: false,
            message: "كلمة المرور الجديدة يجب أن تكون 4 أحرف أو أرقام على الأقل."
        });
    }

    otpStore.delete(cleanPhone);
    if (!appState.passwordOverrides) appState.passwordOverrides = {};
    appState.passwordOverrides[cleanPhone] = String(newPassword).trim();
    saveState();

    user.password = String(newPassword).trim();
    await botManager.sendPasswordResetNotice(user);

    res.json({
        success: true,
        message: "تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول."
    });
});

// التحقق من جلسة المشترك
function authenticateUser(req, res, next) {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.replace("Bearer ", "").trim();
    const phone = activeSessions.get(token);
    const usersMap = getRegisteredUsersMap();

    if (!phone || !usersMap[phone]) {
        return res.status(401).json({ success: false, unauthorized: true, message: "يرجى تسجيل الدخول أولاً." });
    }

    req.currentUser = usersMap[phone];
    next();
}

// ============================================================================
// 8. مسارات الرصيد والسحب المستقلة لكل مشترك
// ============================================================================
app.get("/api/balance", authenticateUser, (req, res) => {
    const phone = req.currentUser.phone;
    const uState = ensureUserState(phone);
    const availableBalance = getUserAvailableBalance(phone);

    res.json({
        success: true,
        accountName: req.currentUser.name,
        accountPhone: phone,
        balance: availableBalance.toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: uState.history
    });
});

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

app.post("/api/withdraw", authenticateUser, async (req, res) => {
    try {
        const phone = req.currentUser.phone;
        const uState = ensureUserState(phone);
        const { userName, amount, paymentMethod, destination, deviceInfo } = req.body;
        const requestedAmount = parseFloat(amount);
        const availableBalance = getUserAvailableBalance(phone);
        const currentRate = await updateOfficialExchangeRate();

        if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > availableBalance) {
            return res.status(400).json({
                success: false,
                message: "المبلغ المطلوب غير صالح أو يتجاوز الرصيد المتاح في حسابك."
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

        uState.pendingDeduction += requestedAmount;

        const newRecord = {
            id: txId,
            userPhone: phone,
            accountOwnerName: req.currentUser.name,
            userName: userName || req.currentUser.name,
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

        uState.history.unshift(newRecord);
        saveState();

        await botManager.sendWithdrawNotification(newRecord, uState.pendingDeduction);

        res.json({
            success: true,
            netAmountUsd: netUsd.toFixed(2),
            netAmountEgp: netEgp.toFixed(2),
            exchangeRate: currentRate.toFixed(2),
            newBalance: getUserAvailableBalance(phone).toFixed(2),
            history: uState.history
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ في السيرفر" });
    }
});

app.post("/api/clear", authenticateUser, (req, res) => {
    const { password } = req.body || {};
    if (!password || String(password).trim() !== ADMIN_PASSWORD) {
        return res.status(403).json({
            success: false,
            message: "كلمة مرور الإدارة غير صحيحة!"
        });
    }

    const phone = req.currentUser.phone;
    const uState = ensureUserState(phone);
    uState.pendingDeduction = 0;
    uState.history = [];
    saveState();

    res.json({
        success: true,
        newBalance: getUserAvailableBalance(phone).toFixed(2),
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        history: []
    });
});

// ============================================================================
// 9. مسارات الصيانة وتثبيت التطبيق (PWA)
// ============================================================================
app.get("/dev-panel-lock", (req, res) => {
    res.sendFile(path.join(__dirname, "maintenance.html"));
});

app.get("/api/maintenance/status", (req, res) => {
    const endTime = appState.maintenanceEndTime || 0;
    if (endTime > 0 && Date.now() >= endTime) {
        appState.maintenanceEndTime = 0;
        saveState();
    }
    res.json({
        active: (appState.maintenanceEndTime || 0) > Date.now(),
        endTime: appState.maintenanceEndTime || 0
    });
});

app.post("/api/maintenance/set", (req, res) => {
    const { password, minutes } = req.body || {};
    if (!password || String(password).trim() !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, message: "كلمة مرور المشرف غير صحيحة!" });
    }
    const mins = parseInt(minutes, 10);
    if (isNaN(mins) || mins < 0) {
        return res.status(400).json({ success: false, message: "عدد الدقائق غير صالح." });
    }
    appState.maintenanceEndTime = mins === 0 ? 0 : Date.now() + (mins * 60 * 1000);
    saveState();
    res.json({
        success: true,
        message: mins === 0 ? "تم فتح الموقع فوراً!" : `تم تفعيل الصيانة لمدة ${mins} دقيقة!`,
        endTime: appState.maintenanceEndTime
    });
});

const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#2563eb"/><stop offset="100%" stop-color="#10b981"/></linearGradient></defs>
  <rect width="120" height="120" rx="26" fill="#0f172a"/><rect x="6" y="6" width="108" height="108" rx="22" fill="none" stroke="url(#g)" stroke-width="5"/>
  <path d="M28 76 L48 54 L64 66 L90 34" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="90" cy="34" r="7" fill="#10b981"/><text x="60" y="102" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">AD$</text>
</svg>`;

app.get("/app-icon.svg", (req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(APP_ICON_SVG);
});

app.get("/manifest.json", (req, res) => {
    res.json({
        name: "منصة AD$ لعوائد التمويل الإعلاني",
        short_name: "عوائد AD$",
        start_url: "/",
        display: "standalone",
        background_color: "#070b14",
        theme_color: "#070b14",
        icons: [{ src: "/app-icon.svg", sizes: "192x192 512x512", type: "image/svg+xml", purpose: "any maskable" }]
    });
});

app.get("/sw.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.send(`self.addEventListener('install', () => self.skipWaiting());self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Multi-User Server running on port ${PORT}`);
});
