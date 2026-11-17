// whatsappClient.js - نسخة مستقرة تمنع تكرار رسائل الربط وتعالج رفض الكود
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
        this.manualPairingMode = false; // يفعّل فقط عند إرسال أمر "ربط" من تيليجرام
        this.pairingCodeSentForSession = false;
        this.lastConnectedNotifyTime = 0;
        this.sendQueue = Promise.resolve();
    }

    // توحيد صيغة الرقم المصري إلى الصيغة الدولية الدقيقة: 201xxxxxxxxx (12 رقماً)
    formatEgyptianPhone(phoneStr) {
        let digits = String(phoneStr || "").replace(/\D/g, "");
        if (digits.startsWith("0020")) digits = digits.slice(2);
        if (digits.startsWith("2001") && digits.length === 13) digits = "20" + digits.slice(3);
        if (digits.startsWith("01") && digits.length === 11) digits = "2" + digits;
        if (/^1[0125]\d{8}$/.test(digits)) digits = "20" + digits;
        return digits;
    }

    async initialize(customPhone = null, isManualPair = false) {
        if (this.isInitializing) return;

        // إذا لم تكن هناك جلسة محفوظة ولم يطلب المدير الربط يدوياً، لا تبدأ حلقة طلب أكواد عشوائية
        const hasSavedCreds = fs.existsSync(path.join(this.authFolder, "creds.json"));
        if (!hasSavedCreds && !isManualPair) {
            console.log("ℹ️ لا توجد جلسة واتساب محفوظة حالياً. أرسل (ربط 010xxxxxxxx) في تيليجرام للربط.");
            return;
        }

        this.isInitializing = true;
        if (isManualPair) {
            this.manualPairingMode = true;
            this.pairingCodeSentForSession = false;
        }

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
                browser: ["Ubuntu", "Chrome", "124.0.0"],
                syncFullHistory: false,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000
            });

            this.sock.ev.on("creds.update", saveCreds);

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // توليد كود الربط مرة واحدة فقط عند طلب المدير اليدوي
                if (
                    qr &&
                    this.manualPairingMode &&
                    !this.sock.authState.creds.registered &&
                    !this.pairingCodeSentForSession
                ) {
                    if (this.pairingPhone && /^201[0125]\d{8}$/.test(this.pairingPhone)) {
                        this.pairingCodeSentForSession = true;
                        await this.generatePairingCodeNow(this.pairingPhone, qr);
                    }
                }

                if (connection === "open") {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.manualPairingMode = false;
                    this.pairingCodeSentForSession = false;
                    console.log("✅ واتساب السيرفر متصل ومستقر!");

                    // منع تكرار رسالة "تم الربط بنجاح" إذا حدثت إعادة اتصال سريعة
                    const now = Date.now();
                    if (this.onNotifyAdmin && now - this.lastConnectedNotifyTime > 60000) {
                        this.lastConnectedNotifyTime = now;
                        await this.onNotifyAdmin("✅ *تم ربط واتساب بالسيرفر بنجاح وتنشيط الإرسال التلقائي للكود!*");
                    }
                } else if (connection === "close") {
                    this.isConnected = false;
                    this.isInitializing = false;

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const errorReason = lastDisconnect?.error?.message || "";

                    // إذا تم طرد الجلسة من الهاتف أو انتهت صلاحيتها
                    if (statusCode === DisconnectReason.loggedOut) {
                        this.manualPairingMode = false;
                        try {
                            fs.rmSync(this.authFolder, { recursive: true, force: true });
                        } catch (e) {}
                        if (this.onNotifyAdmin) {
                            await this.onNotifyAdmin("⚠️ *تم تسجيل الخروج من واتساب.*\nلإعادة الربط أرسل في البوت:\n`ربط 010xxxxxxxx`");
                        }
                        return;
                    }

                    // إذا كان هناك تعارض أثناء إعادة تشغيل Render، انتظر 12 ثانية قبل إعادة الاتصال
                    const reconnectDelay = errorReason.includes("conflict") || statusCode === 440 ? 12000 : 5000;
                    if (fs.existsSync(path.join(this.authFolder, "creds.json"))) {
                        setTimeout(() => this.initialize(null, false), reconnectDelay);
                    }
                }
            });
        } catch (err) {
            this.isInitializing = false;
            console.error("خطأ في تهيئة واتساب:", err.message);
        }
    }

    // طلب ربط جديد يدوياً من تيليجرام: ربط 010xxxxxxxx
    async requestNewPairingFromBot(phoneInput) {
        const formatted = this.formatEgyptianPhone(phoneInput);
        if (!/^201[0125]\d{8}$/.test(formatted)) {
            return {
                success: false,
                message: "رقم الهاتف غير صحيح! اكتب رقماً مصرياً مكوناً من 11 رقماً يبدأ بـ 01 (مثال: ربط 01012345678)."
            };
        }

        try {
            if (this.sock) {
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.end(undefined);
                } catch (e) {}
                this.sock = null;
            }

            this.isConnected = false;
            this.isInitializing = false;
            this.manualPairingMode = true;
            this.pairingCodeSentForSession = false;

            // مسح الجلسة السابقة بالكامل لضمان عدم رفض الكود الجديد
            try {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (e) {}

            await delay(1000);
            await this.initialize(formatted, true);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async generatePairingCodeNow(targetPhone, rawQrString) {
        if (!this.sock || this.sock.authState?.creds?.registered) return;
        try {
            await delay(2500); // انتظار استقرار المقبس قبل طلب الكود
            const code = await this.sock.requestPairingCode(targetPhone);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            const localDisplayPhone = "0" + targetPhone.slice(2);
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=450x450&margin=15&data=${encodeURIComponent(rawQrString || "")}`;

            if (this.onNotifyAdmin) {
                await this.onNotifyAdmin(
`📲 *كود ربط الواتساب بالسيرفر (صالح لدقيقتين)*
━━━━━━━━━━━━━━━━━━━━
📌 *الرقم المربوط:* \`${localDisplayPhone}\`
🔑 *كود الربط:* \`${formattedCode}\`
━━━━━━━━━━━━━━━━━━━━
⚠️ *ملاحظة هامة لنجاح الربط:*
1️⃣ افتح واتساب على نفس الهاتف صاحب الرقم \`${localDisplayPhone}\` ← *الأجهزة المرتبطة* ← *ربط جهاز* ← *الربط برقم الهاتف*.
2️⃣ اكتب الكود أعلاه فوراً (قبل انتهاء دقيقتين).
3️⃣ إذا ظهر *"تعذر ربط الجهاز"* امسح أي أجهزة قديمة غير مستخدمة من قائمة *الأجهزة المرتبطة* في هاتفك ثم أرسل \`ربط ${localDisplayPhone}\` مرة واحدة فقط.
━━━━━━━━━━━━━━━━━━━━
📷 *أو امسح رمز QR مباشرة:* [اضغط لفتح صورة الـ QR](${qrImageUrl})`
                );
            }
        } catch (err) {
            console.error("خطأ أثناء توليد كود الربط:", err.message);
            this.manualPairingMode = false;
        }
    }

    async ensureActiveConnection() {
        const wsState = this.sock?.ws?.readyState;
        if (this.sock && this.isConnected && wsState === 1) {
            return true;
        }

        if (fs.existsSync(path.join(this.authFolder, "creds.json")) && !this.isInitializing) {
            this.initialize(null, false);
        }

        for (let i = 0; i < 16; i++) {
            await delay(500);
            if (this.sock && this.isConnected && this.sock?.ws?.readyState === 1) {
                return true;
            }
        }
        return false;
    }

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

            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    await this.sock.sendPresenceUpdate("available", targetJid);
                    await delay(300);
                    const sentMsg = await this.sock.sendMessage(targetJid, { text });
                    if (sentMsg && sentMsg.key) {
                        console.log(`✅ تم إرسال رسالة واتساب بنجاح إلى: ${subscriberPhone}`);
                        return true;
                    }
                } catch (err) {
                    console.error(`⚠️ تعثرت المحاولة ${attempt} للإرسال إلى ${subscriberPhone}:`, err.message);
                    await delay(1200);
                }
            }
            return false;
        };

        const resultPromise = this.sendQueue.then(() => task()).catch(() => false);
        this.sendQueue = resultPromise.then(() => delay(600));
        return resultPromise;
    }

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

    async sendActivationNotice(subscriberPhone, subscriberName) {
        const text =
`🎉 *مرحباً بك أ/ ${subscriberName}*
━━━━━━━━━━━━━━━━━━━━
تمت مراجعة بياناتك وتفعيل حسابك المستقل في *منصة AD$ للتمويل الإعلاني* بنجاح ✅
يمكنك الآن تسجيل الدخول برقم هاتفك وكلمة المرور الخاصة بك لمتابعة أرباحك وطلب السحب.`;

        return await this.enqueueSafeSend(subscriberPhone, text);
    }

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
