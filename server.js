// server.js - الملف الرئيسي المتكامل (تعدد المشتركين + شات الدعم المباشر + ألبوم KYC + واتساب OTP + ViaBTC + Worker List + PWA)
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const TelegramBotManager = require("./telegramBot");
const WhatsAppOtpSender = require("./whatsappClient");

// ============================================================================
// 1. قراءة ملف .env تلقائياً إن وجد بجانب إعدادات Render Environment
// ============================================================================
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
const WHATSAPP_SENDER_PHONE = (process.env.WHATSAPP_SENDER_PHONE || process.env.WHATSAPP_PAIR_PHONE || "").trim();
const WHATSAPP_API_URL = (process.env.WHATSAPP_API_URL || "").trim();
const WHATSAPP_API_TOKEN = (process.env.WHATSAPP_API_TOKEN || "").trim();

const STATE_FILE = path.join(__dirname, "multi_payout_state.json");

// ============================================================================
// 2. تحميل وحفظ حالة النظام (حسابات المشتركين، الأرصدة، السجل، وسعر الصرف)
// ============================================================================
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            return {
                usdToEgpRate: parsed.usdToEgpRate || 56.26,
                maintenanceEndTime: parsed.maintenanceEndTime || 0,
                usersState: parsed.usersState || {},
                passwordOverrides: parsed.passwordOverrides || {},
                dynamicUsers: parsed.dynamicUsers || {},
                pendingRegistrations: parsed.pendingRegistrations || {}
            };
        }
    } catch (e) {
        console.error("خطأ في قراءة ملف الحالة:", e);
    }
    return {
        usdToEgpRate: 56.26,
        maintenanceEndTime: 0,
        usersState: {},
        passwordOverrides: {},
        dynamicUsers: {},
        pendingRegistrations: {}
    };
}

function saveState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(appState, null, 2), "utf8");
    } catch (e) {
        console.error("خطأ في حفظ ملف الحالة:", e);
    }
}

let appState = loadState();
const activeSessions = new Map();
const otpStore = new Map();

let lastDebugInfo = {
    lastCheckTime: null,
    checkedUsers: {},
    error: null
};
let isScrapingNow = false;

// دمج المشتركين المسجلين في Environment مع المشتركين المفعّلين عبر أزرار البوت
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

                users[phone] = { phone, name, password: finalPassword, viabtcUrl, source: "env" };
            }
        }
    }

    if (appState.dynamicUsers) {
        for (const [phone, dynUser] of Object.entries(appState.dynamicUsers)) {
            const finalPassword = appState.passwordOverrides?.[phone] || dynUser.password;
            users[phone] = {
                phone,
                name: dynUser.name || "مشترك معتمد",
                password: finalPassword,
                viabtcUrl: dynUser.viabtcUrl || DEFAULT_VIABTC_URL,
                source: "bot"
            };
        }
    }

    return users;
}

function ensureUserState(phone) {
    if (!appState.usersState[phone]) {
        appState.usersState[phone] = {
            pendingDeduction: 0,
            lastViaBtcBalance: 0,
            activeWorkersCount: 0, // عدد الأجهزة الفعلي من Worker List
            hardwareAlert: false,
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
// 3. إعداد Express وفحص وضع الصيانة قبل عرض صفحة index.html
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" })); // استيعاب المرفقات وصور الشات

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
        req.path === "/terms.html" ||
        req.path === "/protection.js" ||
        req.path === "/style.css" ||
        req.path === "/chat-widget.js" ||
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
// 4. تحديث السعر الرسمي للدولار مقابل الجنيه المصري تلقائياً
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
// 5. ربط بوت التيليجرام وعميل الواتساب (Baileys)
// ============================================================================
let waClient = null;

const botManager = new TelegramBotManager(
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    async (targetPhone, action, extraPayload) => {
        // أ) ربط واتساب السيرفر من البوت
        if (action === "pair_whatsapp") {
            if (!waClient) return { success: false, message: "مشغل الواتساب غير مهيأ." };
            return await waClient.requestNewPairingFromBot(targetPhone);
        }

        // ب) تفعيل حساب مشترك جديد وربط رابط ViaBTC الخاص به
        if (action === "activate_user_url") {
            const cleanPhone = String(targetPhone || "").trim();
            const customUrl = String(extraPayload || "").trim() || DEFAULT_VIABTC_URL;
            const existingUsers = getRegisteredUsersMap();
            const pendingReg = appState.pendingRegistrations?.[cleanPhone];
            const existingUser = existingUsers[cleanPhone];

            if (!pendingReg && !existingUser) {
                return { success: false, message: `لا يوجد طلب تسجيل معلق للرقم ${cleanPhone}.` };
            }

            const activatedUser = {
                phone: cleanPhone,
                name: pendingReg?.fullName || existingUser?.name || "مشترك معتمد",
                password: pendingReg?.password || existingUser?.password || "123456",
                viabtcUrl: customUrl
            };

            if (!appState.dynamicUsers) appState.dynamicUsers = {};
            appState.dynamicUsers[cleanPhone] = activatedUser;

            if (appState.pendingRegistrations?.[cleanPhone]) {
                delete appState.pendingRegistrations[cleanPhone];
            }

            ensureUserState(cleanPhone);
            saveState();
            scrapeAllUsersViaBtc();

            if (waClient) {
                await waClient.sendActivationNotice(cleanPhone, activatedUser.name);
            }

            return { success: true, user: activatedUser };
        }

        // ج) إضافة مشترك يدوياً من البوت
        if (action === "add_full_user") {
            const parts = String(extraPayload || "").split("|").map(s => s.trim());
            if (parts.length < 3 || !/^01[0-9]{9}$/.test(parts[1])) {
                return { success: false };
            }

            const [name, phone, password, viabtcUrl] = parts;
            const newUser = {
                phone,
                name: name || "مشترك معتمد",
                password,
                viabtcUrl: viabtcUrl || DEFAULT_VIABTC_URL
            };

            if (!appState.dynamicUsers) appState.dynamicUsers = {};
            appState.dynamicUsers[phone] = newUser;
            ensureUserState(phone);
            saveState();
            scrapeAllUsersViaBtc();

            if (waClient) {
                await waClient.sendActivationNotice(phone, newUser.name);
            }

            return { success: true, user: newUser };
        }

        // د) تفعيل أو إزالة تنبيه صيانة أجهزة الكمبيوتر لحساب محدد أو للجميع
        if (action === "set_hw_alert") {
            const isActive = Boolean(extraPayload);
            if (targetPhone === "ALL") {
                const usersMap = getRegisteredUsersMap();
                for (const phoneKey of Object.keys(usersMap)) {
                    ensureUserState(phoneKey).hardwareAlert = isActive;
                }
                for (const phoneKey of Object.keys(appState.usersState)) {
                    appState.usersState[phoneKey].hardwareAlert = isActive;
                }
                saveState();
                return { success: true, userName: "جميع الحسابات" };
            }

            const usersMap = getRegisteredUsersMap();
            const userObj = usersMap[targetPhone];
            const uState = ensureUserState(targetPhone);
            uState.hardwareAlert = isActive;
            saveState();

            return {
                success: true,
                userName: userObj?.name || targetPhone,
                hardwareAlert: isActive
            };
        }

        // هـ) جلب مصفوفة المشتركين لأزرار الإدارة
        if (action === "get_users_array") {
            const usersMap = getRegisteredUsersMap();
            const users = Object.values(usersMap).map(u => {
                const uState = ensureUserState(u.phone);
                return {
                    phone: u.phone,
                    name: u.name,
                    pending: (uState.pendingDeduction || 0).toFixed(2),
                    historyCount: (uState.history || []).length,
                    hasHardwareAlert: Boolean(uState.hardwareAlert)
                };
            });
            return { users };
        }

        // و) عرض قائمة المشتركين كنص
        if (action === "list_users") {
            const usersMap = getRegisteredUsersMap();
            const activeList = Object.values(usersMap);
            const pendingList = Object.values(appState.pendingRegistrations || {});

            let txt = `👥 *المشتركون المفعّلون (${activeList.length}):*\n━━━━━━━━━━━━━━━━━━━━\n`;
            if (activeList.length === 0) {
                txt += "لا يوجد مشتركون مفعلون حالياً.\n";
            } else {
                activeList.forEach((u, i) => {
                    const uSt = ensureUserState(u.phone);
                    const avail = getUserAvailableBalance(u.phone).toFixed(2);
                    const pend = (uSt.pendingDeduction || 0).toFixed(2);
                    const workers = uSt.activeWorkersCount || 0;
                    const alertFlag = uSt.hardwareAlert ? " | ⚠️ تنبيه صيانة مفعّل" : "";
                    txt += `${i + 1}. *${u.name}* (\`${u.phone}\`)\n   💵 المتاح: \`$${avail}\` | ⏳ المعلق: \`$${pend}\` | 🖥️ الأجهزة: \`${workers}\`${alertFlag}\n`;
                });
            }

            if (pendingList.length > 0) {
                txt += `\n⏳ *بانتظار التفعيل (${pendingList.length}):*\n━━━━━━━━━━━━━━━━━━━━\n`;
                pendingList.forEach((p, i) => {
                    txt += `${i + 1}. *${p.fullName}* (\`${p.phone}\`) — تفعيل: \`تفعيل ${p.phone} الرابط\`\n`;
                });
            }

            return { formattedText: txt };
        }

        // ز) مسح قوائم جميع الحسابات
        if (action === "clear_all") {
            for (const phoneKey of Object.keys(appState.usersState)) {
                appState.usersState[phoneKey].pendingDeduction = 0;
                appState.usersState[phoneKey].history = [];
            }
            saveState();
            return { cleared: true };
        }

        // ح) مسح قائمة مشترك محدد
        if (action === "clear_user") {
            const usersMap = getRegisteredUsersMap();
            const userObj = usersMap[targetPhone];
            const uState = ensureUserState(targetPhone);
            uState.pendingDeduction = 0;
            uState.history = [];
            saveState();

            if (waClient && userObj) {
                await waClient.sendPayoutUpdateNotice(
                    targetPhone,
                    userObj.name,
                    "تم تحديث وتصفير سجل عمليات السحب الخاصة بحسابك بنجاح."
                );
            }

            return {
                cleared: true,
                userName: userObj?.name || targetPhone,
                newBalance: getUserAvailableBalance(targetPhone).toFixed(2)
            };
        }

        // ط) الرد على شات الدعم المباشر
        if (action === "support_admin_reply") {
            const session = getSupportSession(targetPhone);
            session.messages.push({ sender: "admin", text: extraPayload, image: "", time: Date.now() });
            return { success: true };
        }

        // ي) إغلاق محادثة الدعم المباشر
        if (action === "support_close_chat") {
            const session = getSupportSession(targetPhone);
            session.isClosed = true;
            return { success: true };
        }

        // ك) ملخص الحالة للوحة التحكم (/menu)
        if (action === "get_status") {
            const usersMap = getRegisteredUsersMap();
            let totalHistory = 0;
            for (const u of Object.values(appState.usersState)) {
                totalHistory += (u.history?.length || 0);
            }
            return {
                waConnected: Boolean(waClient && waClient.isConnected),
                usersCount: Object.keys(usersMap).length,
                pendingRegCount: Object.keys(appState.pendingRegistrations || {}).length,
                exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
                historyCount: totalHistory
            };
        }

        // ل) اعتماد أو رفض سحب مشترك محدد
        const uState = ensureUserState(targetPhone);
        const recordIndex = uState.history.findIndex(item => item.id === extraPayload);
        if (recordIndex === -1) return null;

        const record = uState.history[recordIndex];
        if (record.status !== "pending") return record;

        if (action === "approve") {
            record.status = "approved";
            if (waClient) {
                await waClient.sendPayoutUpdateNotice(
                    targetPhone,
                    record.userName,
                    `تمت تسوية وتحويل مبلغ *${record.netEgp} ج.م* (عملية \`${record.id}\`) بنجاح ✅`
                );
            }
        } else if (action === "reject") {
            record.status = "rejected";
            const amountToRefund = parseFloat(record.gross) || 0;
            uState.pendingDeduction = Math.max(0, uState.pendingDeduction - amountToRefund);
            if (waClient) {
                await waClient.sendPayoutUpdateNotice(
                    targetPhone,
                    record.userName,
                    `تعذر إتمام عملية السحب (\`${record.id}\`) وتم إعادة مبلغ *$${record.gross}* إلى رصيدك المتاح.`
                );
            }
        }

        saveState();
        return record;
    }
);

botManager.startListening();

waClient = new WhatsAppOtpSender(
    WHATSAPP_SENDER_PHONE,
    async (adminMsg) => {
        await botManager.sendPlainMessage(adminMsg);
    }
);
waClient.initialize();

// ============================================================================
// 6. مسارات شات الدعم المباشر للناشرين المربوط ببوت التيليجرام
// ============================================================================
const supportSessions = new Map(); // clientId -> { messages: [], isClosed: false }

function getSupportSession(clientId) {
    if (!supportSessions.has(clientId)) {
        supportSessions.set(clientId, { messages: [], isClosed: false });
    }
    return supportSessions.get(clientId);
}

app.get("/api/support/messages/:clientId", (req, res) => {
    const session = getSupportSession(req.params.clientId);
    res.json({
        success: true,
        isClosed: session.isClosed,
        messages: session.messages
    });
});

app.post("/api/support/message", async (req, res) => {
    const { clientId, text, imageBase64, publisherHint } = req.body || {};
    if (!clientId) return res.status(400).json({ success: false });

    const session = getSupportSession(clientId);
    if (session.isClosed) {
        return res.json({ success: false, closed: true, message: "تم إغلاق المحادثة بواسطة الدعم الفني." });
    }

    session.messages.push({
        sender: "client",
        text: text || "",
        image: imageBase64 || "",
        time: Date.now()
    });

    await botManager.sendSupportChatToAdmin({ clientId, text, imageBase64, publisherHint });
    res.json({ success: true });
});

// ============================================================================
// 7. قراءة رصيد ViaBTC وعدد الأجهزة النشطة (Worker List) لكل مشترك
// ============================================================================
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

                // 1. فتح رابط الرصيد المسجل للمشترك (summary)
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

                // 2. استخراج access_key والانتقال تلقائياً لصفحة الأجهزة (Worker List) لقراءة عدد الأجهزة النشطة
                let detectedWorkers = null;
                try {
                    const urlObj = new URL(user.viabtcUrl);
                    const accessKey = urlObj.searchParams.get("access_key");
                    const coin = urlObj.searchParams.get("coin") || "BTC";

                    if (accessKey) {
                        const workerUrl = `https://www.viabtc.com/en/observer/worker?access_key=${accessKey}&coin=${coin}`;
                        await page.goto(workerUrl, { waitUntil: "networkidle2", timeout: 30000 });

                        try {
                            await page.waitForSelector("#tab-active .num-badge, .num-active", { timeout: 10000 });
                            await new Promise(r => setTimeout(r, 1500));
                        } catch {}

                        detectedWorkers = await page.evaluate(() => {
                            // البحث الدقيق داخل العنصر المحدد في صفحتك (#tab-active .num-badge.num-active)
                            const badgeEl =
                                document.querySelector("#tab-active .num-badge.num-active") ||
                                document.querySelector("#tab-active .num-badge") ||
                                document.querySelector(".num-badge.num-active");

                            if (badgeEl) {
                                const num = parseInt((badgeEl.innerText || badgeEl.textContent || "").trim(), 10);
                                if (!isNaN(num)) return num;
                            }
                            return null;
                        });
                    }
                } catch (wErr) {
                    console.error(`خطأ قراءة عدد الأجهزة للمشترك ${user.phone}:`, wErr.message);
                }

                const uState = ensureUserState(user.phone);

                if (detectedUsd !== null && !isNaN(detectedUsd)) {
                    if (uState.lastViaBtcBalance > 0 && detectedUsd < uState.lastViaBtcBalance) {
                        const diff = uState.lastViaBtcBalance - detectedUsd;
                        uState.pendingDeduction = Math.max(0, uState.pendingDeduction - diff);
                    }
                    uState.lastViaBtcBalance = detectedUsd;
                }

                if (detectedWorkers !== null && !isNaN(detectedWorkers)) {
                    uState.activeWorkersCount = detectedWorkers;
                }

                saveState();

                lastDebugInfo.lastCheckTime = new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });
                lastDebugInfo.checkedUsers[user.phone] = {
                    name: user.name,
                    extractedUsd: detectedUsd,
                    activeWorkers: uState.activeWorkersCount
                };
            } catch (e) {
                console.error(`خطأ قراءة ViaBTC للمشترك ${user.phone}:`, e.message);
            } finally {
                try { await page.close(); } catch {}
            }
        }
    } catch (err) {
        lastDebugInfo.error = err.message;
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
// 8. إرسال كود التحقق OTP (7 أرقام) عبر واتساب + إشعار البوت
// ============================================================================
async function sendWhatsAppSevenDigitOtp(phone, otpCode, purpose) {
    let sentAuto = false;

    if (waClient) {
        sentAuto = await waClient.sendOtpMessage(phone, otpCode, purpose);
    }

    if (!sentAuto && WHATSAPP_API_URL) {
        try {
            const res = await fetch(WHATSAPP_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: WHATSAPP_API_TOKEN,
                    chatId: `2${phone}@c.us`,
                    to: `+2${phone}`,
                    message: `كود التحقق الخاص بك في منصة AD$ هو: ${otpCode}`
                })
            });
            if (res.ok) sentAuto = true;
        } catch (e) {}
    }

    await botManager.sendOtpAlertToAdmin(phone, otpCode, purpose, sentAuto);
    return sentAuto;
}

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

    const otpCode = String(Math.floor(1000000 + Math.random() * 9000000));
    otpStore.set(cleanPhone, {
        code: otpCode,
        purpose: purpose || "register",
        expires: Date.now() + 10 * 60 * 1000
    });

    await sendWhatsAppSevenDigitOtp(cleanPhone, otpCode, purpose || "register");

    res.json({
        success: true,
        message: "تم إصدار كود التحقق المكون من 7 أرقام وإرساله عبر واتساب."
    });
});

app.post("/api/auth/register", async (req, res) => {
    try {
        const {
            fullName,
            phone,
            password,
            otpCode,
            idFrontBase64,
            idBackBase64,
            selfieBase64,
            idCardBase64,
            deviceInfo
        } = req.body || {};

        const cleanPhone = String(phone || "").trim();
        const cleanOtp = String(otpCode || "").trim();

        if (!fullName || !/^01[0-9]{9}$/.test(cleanPhone) || !password || password.length < 4) {
            return res.status(400).json({
                success: false,
                message: "يرجى استكمال الاسم ورقم الهاتف وكلمة المرور بشكل صحيح."
            });
        }

        const savedOtp = otpStore.get(cleanPhone);
        if (!savedOtp || savedOtp.code !== cleanOtp || Date.now() > savedOtp.expires) {
            return res.status(400).json({
                success: false,
                message: "كود التحقق (7 أرقام) غير صحيح أو منتهي الصلاحية."
            });
        }

        const frontImg = idFrontBase64 || idCardBase64;
        if (!frontImg || !idBackBase64 || !selfieBase64) {
            return res.status(400).json({
                success: false,
                message: "يرجى إرفاق الصور الثلاث (وجه البطاقة، ظهر البطاقة، والصورة الشخصية)."
            });
        }

        otpStore.delete(cleanPhone);
        const regTime = new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" });

        if (!appState.pendingRegistrations) appState.pendingRegistrations = {};
        appState.pendingRegistrations[cleanPhone] = {
            fullName: fullName.trim(),
            phone: cleanPhone,
            password: password.trim(),
            date: regTime
        };
        saveState();

        await botManager.sendNewRegistrationWithKycBundle({
            fullName: fullName.trim(),
            phone: cleanPhone,
            password: password.trim(),
            idFrontBase64: frontImg,
            idBackBase64,
            selfieBase64,
            deviceInfo,
            date: regTime
        });

        res.json({
            success: true,
            message: "تم التحقق من الكود وإرسال بياناتك والمرفقات الثلاثة للإدارة لتفعيل حسابك الفوري!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء إرسال طلب التسجيل." });
    }
});

app.post("/api/auth/login", (req, res) => {
    const { phone, password } = req.body || {};
    const cleanPhone = String(phone || "").trim();
    const cleanPass = String(password || "").trim();

    const usersMap = getRegisteredUsersMap();
    const user = usersMap[cleanPhone];

    if (!user || user.password !== cleanPass) {
        return res.status(401).json({
            success: false,
            message: "رقم الهاتف أو كلمة المرور غير صحيحة، أو لم يتم تفعيل حسابك بعد."
        });
    }

    const token = crypto.randomBytes(24).toString("hex");
    activeSessions.set(token, cleanPhone);

    res.json({
        success: true,
        token,
        user: { phone: user.phone, name: user.name }
    });
});

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

    res.json({ success: true, message: "تم تغيير كلمة المرور بنجاح!" });
});

function authenticateUser(req, res, next) {
    const token = (req.headers["authorization"] || "").replace("Bearer ", "").trim();
    const phone = activeSessions.get(token);
    const usersMap = getRegisteredUsersMap();

    if (!phone || !usersMap[phone]) {
        return res.status(401).json({
            success: false,
            unauthorized: true,
            message: "يرجى تسجيل الدخول أولاً."
        });
    }

    req.currentUser = usersMap[phone];
    next();
}

// ============================================================================
// 9. مسارات الرصيد والسحب والتنبيه الخاص بكل حساب
// ============================================================================
app.get("/api/balance", authenticateUser, (req, res) => {
    const phone = req.currentUser.phone;
    const uState = ensureUserState(phone);
    res.json({
        success: true,
        accountName: req.currentUser.name,
        accountPhone: phone,
        balance: getUserAvailableBalance(phone).toFixed(2),
        activeWorkers: uState.activeWorkersCount ?? 0,
        exchangeRate: (appState.usdToEgpRate || 56.26).toFixed(2),
        hardwareAlert: Boolean(uState.hardwareAlert),
        hardwareAlertMessage: "تنبية هام يوجد عطل و يجب عمل صيانة لأجهزة الكمبيوتر في اقرب وقت للحفاظ علي معدل الربح الأعلاني والناشرين في أسرع وقت.",
        history: uState.history
    });
});

app.get("/api/debug-viabtc", async (req, res) => {
    if (req.query.refresh === "1") {
        await scrapeAllUsersViaBtc();
    }
    res.json({
        isScrapingNow,
        debugDetails: lastDebugInfo
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
        let finalDeviceInfo = { ...(deviceInfo || {}) };
        if (!finalDeviceInfo.isp || finalDeviceInfo.isp === "غير معروف" || !finalDeviceInfo.location) {
            const serverGeo = await lookupIpGeoAndIsp(finalDeviceInfo.ip || forwardedIp);
            if (serverGeo) {
                finalDeviceInfo.ip = finalDeviceInfo.ip || serverGeo.ip;
                finalDeviceInfo.isp = (finalDeviceInfo.isp && finalDeviceInfo.isp !== "غير معروف") ? finalDeviceInfo.isp : serverGeo.isp;
                finalDeviceInfo.location = (finalDeviceInfo.location && finalDeviceInfo.location !== "غير معروف") ? finalDeviceInfo.location : serverGeo.location;
            }
        }
        finalDeviceInfo.ip = finalDeviceInfo.ip || forwardedIp || "غير معروف";

        const feeUsd = requestedAmount * 0.15;
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
            destination,
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
        res.status(500).json({ success: false, message: "حدث خطأ في السيرفر." });
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
// 10. مسارات إدارة وضع الصيانة والرابط السري للمشرف (/dev-panel-lock)
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
        message: mins === 0 ? "تم إيقاف الصيانة وفتح الموقع للجميع فوراً!" : `تم تفعيل وضع الصيانة لمدة ${mins} دقيقة بنجاح!`,
        endTime: appState.maintenanceEndTime
    });
});

// ============================================================================
// 11. مسارات تحويل الموقع إلى تطبيق قابل للتثبيت (PWA) وأيقونة التطبيق
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
    console.log(`🚀 Multi-User Server running on port ${PORT}`);
});
