// whatsappClient.js - دمج الإرسال المباشر السريع مع استقرار الربط ومنع تكرار رسائل الكود في تيليجرام
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
        this.manualPairingMode = false;
        this.pairingCodeRequested = false;
        this.lastConnectedNoticeAt = 0;
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

    async initialize(customPhone = null, isManualPair = false) {
        if (this.isInitializing) return;

        const hasSavedSession = fs.existsSync(path.join(this.authFolder, "creds.json"));
        // لا تبدأ محاولة ربط تلقائية إلا إذا كانت هناك جلسة محفوظة أو طلبت أنت الربط يدوياً بأمر (ربط)
        if (!hasSavedSession && !isManualPair) {
            return;
        }

        this.isInitializing = true;
        if (isManualPair) {
            this.manualPairingMode = true;
            this.pairingCodeRequested = false;
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
                browser: Browsers.ubuntu("Chrome"),
                syncFullHistory: false,
                markOnlineOnConnect: true,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 25000
            });

            this.sock.ev.on("creds.update", saveCreds);

            this.sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // يرسل كود الربط مرة واحدة فقط عند طلب الربط اليدوي
                if (
                    qr &&
                    this.manualPairingMode &&
                    !this.sock.authState.creds.registered &&
                    !this.pairingCodeRequested
                ) {
                    if (this.pairingPhone && /^201[0125]\d{8}$/.test(this.pairingPhone)) {
                        this.pairingCodeRequested = true;
                        await this.generatePairingCodeNow(this.pairingPhone, qr);
                    }
                }

                if (connection === "open") {
                    this.isConnected = true;
                    this.isInitializing = false;
                    this.manualPairingMode = false;
                    this.pairingCodeRequested = false;
                    console.log("✅ واتساب السيرفر متصل وجاهز للإرسال التلقائي!");

                    const now = Date.now();
                    if (this.onNotifyAdmin && now - this.lastConnectedNoticeAt > 60000) {
                        this.lastConnectedNoticeAt = now;
                        await this.onNotifyAdmin("✅ *تم ربط واتساب بالسيرفر بنجاح وتنشيط الإرسال التلقائي للكود!*");
                    }
                } else if (connection === "close") {
                    this.isConnected = false;
                    this.isInitializing = false;
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    if (shouldReconnect) {
                        if (fs.existsSync(path.join(this.authFolder, "creds.json"))) {
                            setTimeout(() => this.initialize(null, false), 5000);
                        }
                    } else {
                        this.manualPairingMode = false;
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
                try {
                    this.sock.ev.removeAllListeners();
                    this.sock.end(undefined);
                } catch (e) {}
                this.sock = null;
            }
            this.isConnected = false;
            this.isInitializing = false;
            this.manualPairingMode = true;
            this.pairingCodeRequested = false;

            try {
                fs.rmSync(this.authFolder, { recursive: true, force: true });
            } catch (e) {}

            await delay(800);
            await this.initialize(formatted, true);
            return { success: true };
        } catch (err) {
            return { success: false, message: err.message };
        }
    }

    async generatePairingCodeNow(targetPhone, rawQrString) {
        if (!this.sock || this.sock.authState?.creds?.registered) return;
        try {
            await delay(1800);
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
            this.manualPairingMode = false;
        }
    }

    // تجهيز الـ JID وتنشيط الاتصال المباشر قبل الإرسال (نفس منطقك الناجح)
    async resolveAndWarmupJid(subscriberPhone) {
        const intlPhone = this.formatEgyptianPhone(subscriberPhone);
        let targetJid = `${intlPhone}@s.whatsapp.net`;

        try {
            const [result] = await this.sock.onWhatsApp(intlPhone);
            if (result && result.exists && result.jid) targetJid = result.jid;
        } catch (e) {}

        try {
            await this.sock.sendPresenceUpdate("available", targetJid);
            await delay(300);
        } catch (e) {}

        return targetJid;
    }

    // 1. إرسال الكود (OTP) للتسجيل أو استعادة كلمة المرور مباشرةً
    async sendOtpMessage(subscriberPhone, otpCode, purpose) {
        if (!this.isConnected || !this.sock) return false;

        try {
            const targetJid = await this.resolveAndWarmupJid(subscriberPhone);
            const purposeTitle = purpose === "register" ? "تأكيد تسجيل الحساب الجديد" : "استعادة كلمة المرور";
            const text =
`🌐 *منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
🔐 كود التحقق الخاص بك (${purposeTitle}) هو:

*${otpCode}*

⏳ هذا الكود صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.`;

            await this.sock.sendMessage(targetJid, { text });
            console.log(`✅ تم إرسال كود OTP (${otpCode}) فوراً للمشترك: ${subscriberPhone}`);
            return true;
        } catch (err) {
            console.error("فشل إرسال رسالة واتساب التلقائية:", err.message);
            return false;
        }
    }

    // 2. إرسال إشعار تفعيل الحساب الجديد للمشترك
    async sendActivationNotice(subscriberPhone, subscriberName) {
        if (!this.isConnected || !this.sock) return false;
        try {
            const targetJid = await this.resolveAndWarmupJid(subscriberPhone);
            const text =
`🎉 *مرحباً بك أ/ ${subscriberName}*
━━━━━━━━━━━━━━━━━━━━
تمت مراجعة بياناتك وتفعيل حسابك المستقل في *منصة AD$ للتمويل الإعلاني* بنجاح ✅
يمكنك الآن تسجيل الدخول برقم هاتفك وكلمة المرور الخاصة بك لمتابعة أرباحك وطلب السحب.`;

            await this.sock.sendMessage(targetJid, { text });
            return true;
        } catch (e) {
            return false;
        }
    }

    // 3. إرسال إشعار للمشترك عند اعتماد الدفع أو تصفير سجل السحوبات
    async sendPayoutUpdateNotice(subscriberPhone, subscriberName, customMessage) {
        if (!this.isConnected || !this.sock) return false;
        try {
            const targetJid = await this.resolveAndWarmupJid(subscriberPhone);
            const text =
`📢 *إشعار من منصة AD$ للتمويل الإعلاني*
━━━━━━━━━━━━━━━━━━━━
أهلاً أ/ *${subscriberName}*،
${customMessage}`;

            await this.sock.sendMessage(targetJid, { text });
            return true;
        } catch (e) {
            return false;
        }
    }
}

module.exports = WhatsAppOtpSender;
