// whatsappClient.js - ملف منفرد لإرسال كود الـ 7 أرقام (OTP) عبر واتساب تلقائياً ومجاناً
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

class WhatsAppOtpSender {
    constructor(pairingPhone, onNotifyAdmin) {
        // تنسيق رقم الهاتف المرسل ليبدأ بكود مصر 201xxxxxxxxx
        this.pairingPhone = String(pairingPhone || "").replace(/\D/g, "");
        if (this.pairingPhone.startsWith("01")) {
            this.pairingPhone = "2" + this.pairingPhone;
        }
        this.onNotifyAdmin = onNotifyAdmin;
        this.authFolder = path.join(__dirname, "wa_auth_session");
        this.sock = null;
        this.isConnected = false;
        this.pairingSent = false;
    }

    async initialize() {
        if (!this.pairingPhone) {
            console.log("ℹ️ لم يتم تحديد WHATSAPP_SENDER_PHONE في Environment لربط الواتساب التلقائي.");
            return;
        }

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                logger: pino({ level: "silent" }),
                printQRInTerminal: false,
                auth: state,
                browser: ["Ubuntu", "Chrome", "20.0.04"]
            });

            this.sock.ev.on("creds.update", saveCreds);

            // إذا لم يكن الرقم مربوطاً من قبل، يتم إصدار كود الربط (8 رموز) وإرساله لبوت التيليجرام
            if (!this.sock.authState.creds.registered && !this.pairingSent) {
                this.pairingSent = true;
                setTimeout(async () => {
                    try {
                        const code = await this.sock.requestPairingCode(this.pairingPhone);
                        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
                        console.log(`🔑 WhatsApp Pairing Code: ${formattedCode}`);

                        if (this.onNotifyAdmin) {
                            await this.onNotifyAdmin(
`📲 *كود ربط الواتساب التلقائي بالسيرفر*
━━━━━━━━━━━━━━━━━━━━
لتفعيل إرسال كود الـ 7 أرقام (OTP) تلقائياً من رقمك (\`${this.pairingPhone}\`):
1️⃣ افتح واتساب في هاتفك ← *الأجهزة المرتبطة*.
2️⃣ اضغط *ربط جهاز* ← ثم بالأسفل اختر *الربط برقم الهاتف بدلاً من ذلك*.
3️⃣ أدخل هذا الكود الفوري:
\`${formattedCode}\`
━━━━━━━━━━━━━━━━━━━━`
                            );
                        }
                    } catch (err) {
                        console.error("خطأ في طلب كود الربط:", err.message);
                    }
                }, 4000);
            }

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    this.isConnected = true;
                    console.log("✅ تم اتصال واتساب بالسيرفر بنجاح وجاهز لإرسال الـ OTP!");
                    if (this.onNotifyAdmin) {
                        await this.onNotifyAdmin("✅ *تم ربط واتساب بالسيرفر بنجاح! سيتم الآن إرسال كود الـ 7 أرقام للمشتركين تلقائياً.*");
                    }
                } else if (connection === "close") {
                    this.isConnected = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        setTimeout(() => this.initialize(), 5000);
                    } else {
                        // في حال تسجيل الخروج من الهاتف، يتم مسح الجلسة القديمة لإتاحة ربط جديد
                        try {
                            fs.rmSync(this.authFolder, { recursive: true, force: true });
                        } catch (e) {}
                        this.pairingSent = false;
                    }
                }
            });
        } catch (err) {
            console.error("خطأ في تهيئة واتساب:", err.message);
        }
    }

    // إرسال كود التحقق المكون من 7 أرقام إلى واتساب المشترك
    async sendOtpMessage(targetEgyptianPhone, otpCode, purpose) {
        if (!this.isConnected || !this.sock) return false;

        try {
            let cleanPhone = String(targetEgyptianPhone).replace(/\D/g, "");
            if (cleanPhone.startsWith("01")) {
                cleanPhone = "2" + cleanPhone;
            }
            const jid = `${cleanPhone}@s.whatsapp.net`;
            const purposeTitle = purpose === "register" ? "تأكيد تسجيل الحساب الجديد" : "استعادة كلمة المرور";

            const text =
`🌐 *منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
🔐 كود التحقق الخاص بك (${purposeTitle}) هو:

*${otpCode}*

⚠️ الكود مكون من 7 أرقام وصالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`;

            await this.sock.sendMessage(jid, { text });
            return true;
        } catch (err) {
            console.error("فشل إرسال رسالة واتساب المباشرة:", err.message);
            return false;
        }
    }
}

module.exports = WhatsAppOtpSender;
