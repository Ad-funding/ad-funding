// whatsappClient.js - إرسال كود الـ 7 أرقام (OTP) وإشعارات التفعيل والتسوية عبر واتساب السيرفر (محصن للإرسال المتكرر)
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

class WhatsAppOtpSender {
    constructor(defaultPairingPhone, onNotifyAdmin) {
        this.pairingPhone = this.formatEgyptianPhone(defaultPairingPhone);
        this.onNotifyAdmin = onNotifyAdmin;
        this.authFolder = path.join(__dirname, "wa_auth_session");
        this.sock = null;
        this.isConnected = false;
        this.isInitializing = false;
        this.pairingCodeRequested = false;
        this.sendQueue = Promise.resolve(); // طابور تسلسلي لمنع تعارض مفاتيح التشفير عند الإرسال المتكرر
    }

    // توحيد صيغة الرقم المصري إلى الصيغة الدولية 201xxxxxxxxx
    formatEgyptianPhone(phoneStr) {
        let digits = String(phoneStr || "").replace(/\D/g, "");
        if (digits.startsWith("0020")) digits = digits.slice(2);
        if (digits.startsWith("2001") && digits.length === 13) digits = "20" + digits.slice(3);
        if (digits.startsWith("01") && digits.length === 11) digits = "2" + digits;
        if (/^1[0125]\d{8}$/.test(digits)) digits = "20" + digits;
        return digits;
    }

    async initialize(customPhone = null) {
        if (this.isInitializing) return;
        this.isInitializing = true;
        this.pairingCodeRequested = false;

        if (customPhone) {
            this.pairingPhone = this.formatEgyptianPhone(customPhone);
        }

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                logger: pino({ level: "silent" }),
                printQRInTerminal: false,
                auth: state,
                browser: Browsers.ubuntu("Chrome"),
                syncFullHistory: false,
                markOnlineOnConnect: true,
                generateHighQualityLinkPreview: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 20000,
                retryRequestDelayMs: 1500
            });

            this.sock.ev.on("creds.update", saveCreds);

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !this.sock.authState.creds.registered && !this.pairingCodeRequested) {
                    if (this.pairingPhone && /^201[0125]\d{8}$/.test(this.pairingPhone)) {
                        this.pairingCodeRequested = true;
                        await this.generatePairingCodeNow(this.pairingPhone, qr);
                    }
                }

                if (connection === "open") {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.pairingCodeRequested = false;
                    console.log("✅ واتساب السيرفر متصل وجاهز للإرسال المستمر!");
                    if (this.onNotifyAdmin) {
                        await this.onNotifyAdmin("✅ *تم ربط واتساب بالسيرفر بنجاح وتنشيط الإرسال التلقائي للكود!*");
                    }
                } else if (connection === "close") {
                    this.isConnected = false;
                    this.isInitializing = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        setTimeout(() => this.initialize(), 4000);
                    } else {
                        try {
                            fs.rmSync(this.authFolder, { recursive: true, force: true });
                        } catch (e) {}
                        if (this.onNotifyAdmin) {
                            await this.onNotifyAdmin("⚠️ *انتهت جلسة واتساب.*\nلإعادة الربط أرسل في البوت:\n`ربط 010xxxxxxxx`");
                        }
                    }
                }
            });
        } catch (err) {
            this.isInitializing = false;
            console.error("خطأ في تهيئة واتساب:", err.message);
        }
    }

    // طلب ربط جديد من أمر التليجرام: ربط 010xxxxxxxx
    async requestNewPairingFromBot(phoneInput) {
        const formatted = this.formatEgyptianPhone(phoneInput);
        if (!/^201[0125]\d{8}$/.test(formatted)) {
            return {
                success: false,
                message: "رقم الهاتف غير صحيح! اكتب رقماً مصرياً (مثال: ربط 01012345678)."
            };
        }

        try {
            if (this.sock) {
                try { this.sock.end(undefined); } catch (e) {}
                this.sock = null;
            }
            this.isConnected = false;
            this.isInitializing = false;
            this.pairingCodeRequested = false;

            try {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (e) {}

            await this.initialize(formatted);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async generatePairingCodeNow(targetPhone, rawQrString) {
        if (!this.sock || this.sock.authState?.creds?.registered) return;
        try {
            await delay(1500);
            const code = await this.sock.requestPairingCode(targetPhone);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            const localDisplayPhone = "0" + targetPhone.slice(2);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=450x450&margin=15&data=${encodeURIComponent(rawQrString || "")}`;

            if (this.onNotifyAdmin) {
                await this.onNotifyAdmin(
`📲 *كود ربط الواتساب بالسيرفر*
━━━━━━━━━━━━━━━━━━━━
📌 *الرقم:* \`${localDisplayPhone}\`
🔑 *كود الربط (بدون شرطة):* \`${code}\`
🔢 *بالتنسيق:* \`${formattedCode}\`
━━━━━━━━━━━━━━━━━━━━
1️⃣ من واتساب هاتفك ادخل: *الأجهزة المرتبطة* ← *ربط جهاز* ← *الربط برقم الهاتف*.
2️⃣ إذا طلب رقمك بجانب \`+20\` اكتبه هكذا: \`${targetPhone.slice(2)}\`.
━━━━━━━━━━━━━━━━━━━━
📷 *بديل فوري (QR):* [اضغط هنا لفتح صورة رمز الـ QR وامسحه بكاميرا واتساب](${qrImageUrl})`
                );
            }
        } catch (err) {
            console.error("خطأ أثناء توليد كود الربط:", err.message);
        }
    }

    // التحقق الحي من جاهزية الاتصال قبل الإرسال وإعادة التنشيط إذا كان في وضع خمول
    async ensureActiveConnection() {
        const wsState = this.sock?.ws?.readyState;
        // في WebSocket: القيمة 1 تعني OPEN
        if (this.sock && this.isConnected && wsState === 1) {
            return true;
        }

        // إذا كانت ملفات الجلسة موجودة لكن الاتصال خامل، نعيد تهيئته وننتظر حتى 8 ثوانٍ
        if (fs.existsSync(path.join(this.authFolder, "creds.json")) && !this.isInitializing) {
            console.log("🔄 إعادة تنشيط اتصال واتساب قبل الإرسال...");
            this.initialize();
        }

        for (let i = 0; i < 16; i++) {
            await delay(500);
            if (this.sock && this.isConnected && this.sock?.ws?.readyState === 1) {
                return true;
            }
        }
        return false;
    }

    // دالة إرسال موحدة ومضمونة تعمل عبر طابور متسلسل مع إعادة المحاولة التلقائية
    enqueueSafeSend(subscriberPhone, text) {
        const task = async () => {
            const ready = await this.ensureActiveConnection();
            if (!ready) {
                console.error("⚠️ تعذر الإرسال: واتساب السيرفر غير متصل حالياً.");
                return false;
            }

            const intlPhone = this.formatEgyptianPhone(subscriberPhone);
            let targetJid = `${intlPhone}@s.whatsapp.net`;

            try {
                const [result] = await this.sock.onWhatsApp(intlPhone);
                if (result && result.exists && result.jid) {
                    targetJid = result.jid;
                }
            } catch (e) {}

            // محاولة الإرسال الأولى + محاولة ثانية تلقائية في حال تعثر الجلسة
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    await this.sock.sendPresenceUpdate("available", targetJid);
                    await delay(300);
                    const sentMsg = await this.sock.sendMessage(targetJid, { text });
                    if (sentMsg && sentMsg.key) {
                        console.log(`✅ تم إرسال رسالة واتساب بنجاح (محاولة ${attempt}) إلى: ${subscriberPhone}`);
                        return true;
                    }
                } catch (err) {
                    console.error(`⚠️ تعثرت المحاولة ${attempt} للإرسال إلى ${subscriberPhone}:`, err.message);
                    await delay(1200);
                }
            }
            return false;
        };

        // ربط المهمة بالطابور التسلسلي لضمان عدم تداخل الرسائل المتتالية
        const resultPromise = this.sendQueue.then(() => task()).catch(() => false);
        this.sendQueue = resultPromise.then(() => delay(600));
        return resultPromise;
    }

    // 1. إرسال الكود (OTP) للتسجيل أو استعادة كلمة المرور
    async sendOtpMessage(subscriberPhone, otpCode, purpose) {
        const purposeTitle = purpose === "register" ? "تأكيد تسجيل الحساب الجديد" : "استعادة كلمة المرور";
        const text =
`🌐 *منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
🔐 كود التحقق الخاص بك (${purposeTitle}) هو:

*${otpCode}*

⏳ هذا الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`;

        return await this.enqueueSafeSend(subscriberPhone, text);
    }

    // 2. إرسال إشعار تفعيل الحساب الجديد للمشترك
    async sendActivationNotice(subscriberPhone, subscriberName) {
        const text =
`🎉 *مرحباً بك أ/ ${subscriberName}*
━━━━━━━━━━━━━━━━━━━━
تمت مراجعة بياناتك وتفعيل حسابك المستقل في *منصة AD$ للتمويل الإعلاني* بنجاح ✅
يمكنك الآن تسجيل الدخول برقم هاتفك وكلمة المرور الخاصة بك لمتابعة أرباحك وطلب السحب.`;

        return await this.enqueueSafeSend(subscriberPhone, text);
    }

    // 3. إرسال إشعار للمشترك عند اعتماد الدفع أو تصفير سجل السحوبات
    async sendPayoutUpdateNotice(subscriberPhone, subscriberName, customMessage) {
        const text =
`📢 *إشعار من منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
أهلاً أ/ *${subscriberName}*،
${customMessage}`;

        return await this.enqueueSafeSend(subscriberPhone, text);
    }
}

module.exports = WhatsAppOtpSender;
