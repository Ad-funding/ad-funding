// telegramBot.js - إدارة بوت التيليجرام مع دعم مسح القائمة عن بُعد بالأزرار والأوامر

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
        console.log("✅ بوت التيليجرام متصل ويستمع لأوامر التسوية والمسح عن بُعد...");
        this.registerBotCommands();
        this.pollUpdates();
    }

    // تسجيل قائمة الأوامر السريعة في زر (Menu) داخل تطبيق تيليجرام
    async registerBotCommands() {
        try {
            await fetch(`${this.apiUrl}/setMyCommands`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    commands: [
                        { command: "menu", description: "📊 فتح لوحة التحكم وعرض الرصيد" },
                        { command: "clear", description: "🗑️ مسح قائمة السحوبات بالكامل عن بُعد" }
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

                        // 1. معالجة ضغطات الأزرار التفاعلية
                        if (update.callback_query) {
                            await this.handleButtonClick(update.callback_query);
                        }

                        // 2. معالجة الأوامر النصية المرسلة للبوت (/clear أو مسح أو تحكم)
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

    // معالجة الأوامر الكتابية من مدير البوت فقط
    async handleTextCommand(message) {
        const chatId = String(message.chat.id);
        if (chatId !== this.adminChatId) return; // حماية: يستجيب لحسابك فقط

        const text = message.text.trim();

        // أمر المسح المباشر
        if (text === "/clear" || text === "مسح" || text === "مسح القائمة") {
            const result = await this.onDecisionCallback("ALL", "clear_all");
            await this.sendPlainMessage(
                `✅ *تم مسح قائمة السحوبات وتصفير المبالغ المعلقة عن بُعد بنجاح!*\n` +
                `💰 *الرصيد المتاح الآن في الموقع:* \`$${result?.newBalance || "0.00"}\``
            );
            return;
        }

        // أمر فتح لوحة التحكم السريعة
        if (text === "/start" || text === "/menu" || text === "تحكم" || text === "الرصيد") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم عن بُعد - منصة عوائد الإعلانات*
━━━━━━━━━━━━━━━━━━━━
💰 *رصيد ViaBTC الخام:* \`$${status?.rawBalance || "0.00"}\`
⏳ *إجمالي المبالغ المعلقة:* \`$${status?.pendingDeduction || "0.00"}\`
💵 *الرصيد المتاح بالموقع الآن:* \`$${status?.availableBalance || "0.00"}\`
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *عدد العمليات في القائمة:* \`${status?.historyCount || 0}\` عملية
━━━━━━━━━━━━━━━━━━━━
👇 *اختر الإجراء المطلوب تنفيذه فوراً:*`;

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: "🗑️ مسح قائمة السحوبات بالكامل", callback_data: "clear_all:panel" }
                    ],
                    [
                        { text: "🔄 تحديث بيانات اللوحة", callback_data: "status:refresh" }
                    ]
                ]
            };

            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.adminChatId,
                    text: panelText,
                    parse_mode: "Markdown",
                    reply_markup: keyboard
                })
            });
        }
    }

    async sendPlainMessage(text) {
        try {
            await fetch(`${this.apiUrl}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: this.adminChatId,
                    text: text,
                    parse_mode: "Markdown"
                })
            });
        } catch (e) {}
    }

    // إرسال إشعار طلب السحب مع أزرار (التسوية / الرفض / مسح القائمة بالكامل)
    async sendWithdrawNotification(record, totalPending) {
        if (!this.token || this.token.includes("ضع_توكن")) return;

        const rawDestination = String(record.destination || "").trim();
        const cleanCopyableNumber = rawDestination.replace(/\s+/g, "");
        const dev = record.deviceInfo || {};

        const text = 
`🔔 *طلب سحب / بيع مكافآت جديد (تحويل مصري)*
━━━━━━━━━━━━━━━━━━━━
🆔 *رقم العملية:* \`${record.id}\`
👤 *الاسم / المعرف:* ${record.userName}
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
📱 *بيانات الجهاز والشبكة (Telemetry):*
🔖 *معرف الجهاز (Device ID):* \`${dev.deviceId || "غير متاح"}\`
📲 *نوع وطراز الجهاز:* ${dev.deviceModel || "غير معروف"}
⚙️ *المعالج (CPU):* ${dev.cpu || "غير معروف"}
🧠 *الذاكرة (RAM):* ${dev.ram || "غير معروف"}
🔋 *حالة البطارية:* ${dev.battery || "غير متاح"}
🌐 *الـ IP الخارجي:* \`${dev.ip || "غير معروف"}\`
📡 *مزود الشبكة (ISP):* ${dev.isp || "غير معروف"}
📍 *الموقع عبر الـ IP:* ${dev.location || "غير معروف"}
━━━━━━━━━━━━━━━━━━━━
📊 *إجمالي المبالغ المعلقة:* $${totalPending.toFixed(2)}
⏰ *التوقيت:* ${record.date}
━━━━━━━━━━━━━━━━━━━━
👇 *اختر إجراء التسوية لتحديث الموقع فوراً:*`;

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ تمت التسوية والدفع بنجاح", callback_data: `approve:${record.id}` }
                ],
                [
                    { text: "❌ فشلت العملية (إعادة المبلغ للرصيد)", callback_data: `reject:${record.id}` }
                ],
                [
                    { text: "🗑️ مسح قائمة السحوبات بالكامل", callback_data: `clear_all:${record.id}` }
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
        const [action, txId] = data.split(":");
        const message = callbackQuery.message;

        if (!action) return;

        // 1. إذا ضغط المدير على زر "مسح قائمة السحوبات بالكامل"
        if (action === "clear_all") {
            const result = await this.onDecisionCallback("ALL", "clear_all");
            await this.answerCallback(
                callbackQuery.id,
                `✅ تم مسح قائمة السحوبات بالكامل من الموقع! الرصيد المتاح الآن: $${result?.newBalance || "0.00"}`
            );
            await this.sendPlainMessage(
                `🗑️ *تم مسح قائمة السحوبات بالكامل عن بُعد!*\n` +
                `💰 *الرصيد المتاح الآن في الموقع:* \`$${result?.newBalance || "0.00"}\``
            );
            return;
        }

        // 2. إذا ضغط المدير على زر "تحديث بيانات اللوحة"
        if (action === "status" && txId === "refresh") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم عن بُعد - منصة عوائد الإعلانات*
━━━━━━━━━━━━━━━━━━━━
💰 *رصيد ViaBTC الخام:* \`$${status?.rawBalance || "0.00"}\`
⏳ *إجمالي المبالغ المعلقة:* \`$${status?.pendingDeduction || "0.00"}\`
💵 *الرصيد المتاح بالموقع الآن:* \`$${status?.availableBalance || "0.00"}\`
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *عدد العمليات في القائمة:* \`${status?.historyCount || 0}\` عملية
⏰ *آخر تحديث:* ${new Date().toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo" })}
━━━━━━━━━━━━━━━━━━━━
👇 *اختر الإجراء المطلوب تنفيذه فوراً:*`;

            await fetch(`${this.apiUrl}/editMessageText`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: message.chat.id,
                    message_id: message.message_id,
                    text: panelText,
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🗑️ مسح قائمة السحوبات بالكامل", callback_data: "clear_all:panel" }],
                            [{ text: "🔄 تحديث بيانات اللوحة", callback_data: "status:refresh" }]
                        ]
                    }
                })
            });
            await this.answerCallback(callbackQuery.id, "✅ تم تحديث بيانات اللوحة بنجاح");
            return;
        }

        // 3. معالجة قبول أو رفض عملية سحب معينة
        const updatedRecord = await this.onDecisionCallback(txId, action);

        if (!updatedRecord) {
            await this.answerCallback(callbackQuery.id, "⚠️ هذه العملية غير موجودة أو تم مسح القائمة.");
            return;
        }

        const statusLine = action === "approve"
            ? "✅ *الحالة النهائية: تمت التسوية والدفع بنجاح*"
            : "❌ *الحالة النهائية: فشلت العملية (تم إرجاع المبلغ لرصيد الموقع)*";

        const updatedText = `${message.text.split("👇")[0].trim()}\n\n${statusLine}`;

        // الإبقاء على زر مسح القائمة متاحاً أسفل الرسالة حتى بعد التسوية
        await fetch(`${this.apiUrl}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: message.chat.id,
                message_id: message.message_id,
                text: updatedText,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑️ مسح قائمة السحوبات بالكامل", callback_data: "clear_all:after_decision" }]
                    ]
                }
            })
        });

        const alertMsg = action === "approve"
            ? "تم اعتماد الدفع بالجنيه المصري وتحديث الموقع!"
            : "تم إلغاء العملية وإرجاع المبلغ إلى رصيد الموقع!";

        await this.answerCallback(callbackQuery.id, alertMsg);
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
