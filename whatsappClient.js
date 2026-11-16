// whatsappClient.js - إرسال كود الـ 7 أرقام (OTP) تلقائياً ومباشرة إلى واتساب المشترك
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
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
    }

    // ضبط رقم الهاتف المصري ليصبح 12 رقماً بالضبط (201xxxxxxxxx)
    formatEgyptianPhone(phoneStr) {
        let cleaned = String(phoneStr || "").replace(/\D/g, "");
        if (!cleaned) return "";

        if (cleaned.startsWith("00")) {
            cleaned = cleaned.slice(2);
        }
        if (cleaned.startsWith("2001") && cleaned.length === 13) {
            cleaned = "20" + cleaned.slice(3);
        }
        if (cleaned.startsWith("01") && cleaned.length === 11) {
            cleaned = "2" + cleaned;
        }
        if (/^1[0125]\d{8}$/.test(cleaned)) {
            cleaned = "20" + cleaned;
        }
        return cleaned;
    }

    async initialize(customPhone = null) {
        if (this.isInitializing) return;
        this.isInitializing = true;

        if (customPhone) {
            this.pairingPhone = this.formatEgyptianPhone(customPhone);
        }

        try {
            const logger = pino({ level: "silent" });
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                logger,
                printQRInTerminal: false,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                browser: Browsers.ubuntu("Chrome"),
                markOnlineOnConnect: false,
                syncFullHistory: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 15000
            });

            this.sock.ev.on("creds.update", saveCreds);

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // طلب كود الربط عند جاهزية قناة التشفير (qr)
                if (qr && !this.sock.authState.creds.registered && this.pairingPhone && !this.pairingCodeRequested) {
                    this.pairingCodeRequested = true;
                    await this.generatePairingCodeNow(this.pairingPhone);
                }

                if (connection === "open") {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.pairingCodeRequested = false;
                    console.log("✅ واتساب السيرفر متصل وجاهز للإرسال التلقائي المباشر!");
                    if (this.onNotifyAdmin) {
                        await this.onNotifyAdmin(
                            "✅ *تم ربط جهاز واتساب بالسيرفر بنجاح!*\nسيتم الآن إرسال كود الـ 7 أرقام (OTP) إلى واتساب المشتركين تلقائياً وفوراً."
                        );
                    }
                } else if (connection === "close") {
                    this.isConnected = false;
                    this.isInitializing = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        setTimeout(() => this.initialize(), 5000);
                    } else {
                        this.pairingCodeRequested = false;
                        try {
                            fs.rmSync(this.authFolder, { recursive: true, force: true });
                        } catch (e) {}
                        if (this.onNotifyAdmin) {
                            await this.onNotifyAdmin(
                                "⚠️ *انتهت جلسة واتساب السيرفر.*\nلإعادة الربط أرسل في البوت:\n`ربط 010xxxxxxxx`"
                            );
                        }
                    }
                }
            });
        } catch (err) {
            this.isInitializing = false;
            console.error("خطأ في تهيئة واتساب:", err.message);
        }
    }

    // طلب كود ربط جديد نظيف من داخل بوت التيليجرام
    async requestNewPairingFromBot(phoneInput) {
        const formatted = this.formatEgyptianPhone(phoneInput);

        if (!/^201[0125]\d{8}$/.test(formatted)) {
            return {
                success: false,
                message: `رقم الهاتف غير صحيح (${formatted || "فارغ"}). يرجى كتابته بصيغة: ربط 01012345678`
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
            this.pairingCodeRequested = false;

            try {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (e) {}

            await delay(1000);
            await this.initialize(formatted);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async generatePairingCodeNow(targetPhone) {
        if (!this.sock || this.sock.authState?.creds?.registered) return;
        try {
            await delay(1500);
            const rawCode = await this.sock.requestPairingCode(targetPhone);
            const formattedCode = rawCode?.match(/.{1,4}/g)?.join("-") || rawCode;
            const localDisplayPhone = "0" + targetPhone.slice(2);

            console.log(`🔑 WhatsApp Pairing Code for ${targetPhone}: ${formattedCode}`);

            if (this.onNotifyAdmin) {
                await this.onNotifyAdmin(
`📲 *كود ربط الواتساب الجاهز للتفعيل*
━━━━━━━━━━━━━━━━━━━━
📌 *الرقم المربوط به الكود:* \`${localDisplayPhone}\` (دولي: \`+${targetPhone}\`)
🔑 *كود الربط (انسخه بدون الشرطة):*
\`${rawCode}\`
*(أو مقسماً: \`${formattedCode}\`)*
━━━━━━━━━━━━━━━━━━━━
*خطوات التفعيل في هاتفك:*
1️⃣ افتح واتساب الرقم (\`${localDisplayPhone}\`) ← *الأجهزة المرتبطة*.
2️⃣ اضغط *ربط جهاز* ← ثم بالأسفل اختر *الربط برقم الهاتف بدلاً من ذلك*.
3️⃣ أدخل الكود أعلاه خلال 60 ثانية.`
                );
            }
        } catch (err) {
            this.pairingCodeRequested = false;
            console.error("خطأ أثناء توليد كود الربط:", err.message);
        }
    }

    // الإرسال الفوري التلقائي لكود الـ 7 أرقام إلى واتساب المشترك
    async sendOtpMessage(subscriberPhone, otpCode, purpose) {
        if (!this.isConnected || !this.sock) {
            return false;
        }

        try {
            const intlPhone = this.formatEgyptianPhone(subscriberPhone);
            let targetJid = `${intlPhone}@s.whatsapp.net`;

            try {
                const [result] = await this.sock.onWhatsApp(intlPhone);
                if (result && result.exists && result.jid) {
                    targetJid = result.jid;
                }
            } catch (e) {}

            const purposeTitle = purpose === "register" ? "تأكيد تسجيل الحساب الجديد" : "استعادة كلمة المرور";

            const text =
`🌐 *منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
🔐 كود التحقق الخاص بك (${purposeTitle}) المكون من 7 أرقام هو:

*${otpCode}*

⏳ هذا الكود صالح لمدة 10 دقائق. يرجى كتابته في الموقع لإتمام العملية.`;

            await this.sock.sendMessage(targetJid, { text });
            console.log(`✅ تم إرسال كود OTP (${otpCode}) تلقائياً إلى واتساب المشترك: ${subscriberPhone}`);
            return true;
        } catch (err) {
            console.error("فشل إرسال رسالة واتساب التلقائية:", err.message);
            return false;
        }
    }

    // إرسال إشعار ترحيبي تلقائي لواتساب المشترك عند تفعيل حسابه
    async sendActivationNotice(subscriberPhone, subscriberName) {
        if (!this.isConnected || !this.sock) return false;
        try {
            const intlPhone = this.formatEgyptianPhone(subscriberPhone);
            let targetJid = `${intlPhone}@s.whatsapp.net`;

            try {
                const [result] = await this.sock.onWhatsApp(intlPhone);
                if (result && result.exists && result.jid) {
                    targetJid = result.jid;
                }
            } catch (e) {}

            const text =
`🎉 *مرحباً بك أ/ ${subscriberName}*
━━━━━━━━━━━━━━━━━━━━
تم مراجعة بياناتك وتفعيل حسابك المستقل في *منصة AD$ للتمويل الإعلاني* بنجاح ✅
يمكنك الآن تسجيل الدخول برقم هاتفك وكلمة المرور الخاصة بك لمتابعة وسحب عوائدك.`;

            await this.sock.sendMessage(targetJid, { text });
            return true;
        } catch (e) {
            return false;
        }
    }
}

module.exports = WhatsAppOtpSender;
