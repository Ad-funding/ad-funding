// whatsappClient.js - إرسال كود الـ 7 أرقام (OTP) تلقائياً ومباشرة إلى واتساب المشترك بدون تدخل
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
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
    }

    formatEgyptianPhone(phoneStr) {
        let cleaned = String(phoneStr || "").replace(/\D/g, "");
        if (cleaned.startsWith("01") && cleaned.length === 11) {
            cleaned = "2" + cleaned;
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
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                logger: pino({ level: "silent" }),
                printQRInTerminal: false,
                auth: state,
                browser: ["Ubuntu", "Chrome", "20.0.04"],
                syncFullHistory: false
            });

            this.sock.ev.on("creds.update", saveCreds);

            if (!this.sock.authState.creds.registered && this.pairingPhone) {
                setTimeout(async () => {
                    await this.generatePairingCodeNow(this.pairingPhone);
                }, 4000);
            }

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    this.isConnected = true;
                    this.isInitializing = false;
                    console.log("✅ واتساب السيرفر متصل وجاهز للإرسال التلقائي المباشر!");
                    if (this.onNotifyAdmin) {
                        await this.onNotifyAdmin(
                            "✅ *تم ربط واتساب بالسيرفر بنجاح!*\nسيتم الآن إرسال كود الـ 7 أرقام (OTP) إلى واتساب المشتركين تلقائياً دون أي تدخل منك."
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
                        try {
                            fs.rmSync(this.authFolder, { recursive: true, force: true });
                        } catch (e) {}
                        if (this.onNotifyAdmin) {
                            await this.onNotifyAdmin(
                                "⚠️ *تم فصل جلسة واتساب السيرفر.*\nلإعادة تفعيل الإرسال التلقائي، أرسل في البوت:\n`ربط 010xxxxxxxx`"
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

    async requestNewPairingFromBot(phoneInput) {
        const formatted = this.formatEgyptianPhone(phoneInput);
        if (!formatted || formatted.length < 12) {
            return { success: false, message: "رقم الهاتف غير صالح. اكتب الرقم بصيغة 010xxxxxxxx" };
        }

        try {
            if (this.sock) {
                try { this.sock.end(undefined); } catch (e) {}
                this.sock = null;
            }
            this.isConnected = false;
            this.isInitializing = false;
            try {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (e) {}

            await this.initialize(formatted);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async generatePairingCodeNow(targetPhone) {
        if (!this.sock || this.sock.authState?.creds?.registered) return;
        try {
            await delay(2000);
            const code = await this.sock.requestPairingCode(targetPhone);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`🔑 WhatsApp Pairing Code: ${formattedCode}`);

            if (this.onNotifyAdmin) {
                await this.onNotifyAdmin(
`📲 *كود ربط الواتساب التلقائي بالسيرفر*
━━━━━━━━━━━━━━━━━━━━
رقم الإرسال: \`${targetPhone}\`
🔑 *كود الربط الفوري (اضغط لنسخه):*
\`${formattedCode}\`
━━━━━━━━━━━━━━━━━━━━
*خطوات التفعيل لمرة واحدة فقط:*
1️⃣ افتح واتساب في هاتفك ← *الأجهزة المرتبطة*.
2️⃣ اضغط *ربط جهاز* ← ثم بالأسفل اختر *الربط برقم الهاتف بدلاً من ذلك*.
3️⃣ أدخل الكود أعلاه، وسيقوم السيرفر بإرسال جميع الأكواد للمشتركين تلقائياً.`
                );
            }
        } catch (err) {
            console.error("خطأ أثناء توليد كود الربط:", err.message);
        }
    }

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
🔐 كود التحقق الخاص بك (${purposeTitle}) هو:

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
