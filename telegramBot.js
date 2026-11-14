// telegramBot.js - إرسال إشعار السحب مع النسخ بضغطة واحدة وتفاصيل الجهاز والشبكة

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
        console.log("✅ بوت التيليجرام متصل ويستمع لأوامر التسوية...");
        this.pollUpdates();
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
                    }
                }
            } catch (err) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    async sendWithdrawNotification(record, totalPending) {
        if (!this.token || this.token.includes("ضع_توكن")) return;

        // تجهيز الرقم للنسخ الفوري بضغطة واحدة (إزالة المسافات من رقم الفيزا لتسهيل اللصق في تطبيقات التحويل)
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
        const data = callbackQuery.data || "";
        const [action, txId] = data.split(":");
        const message = callbackQuery.message;

        if (!action || !txId) return;

        const updatedRecord = await this.onDecisionCallback(txId, action);

        if (!updatedRecord) {
            await this.answerCallback(callbackQuery.id, "⚠️ هذه العملية غير موجودة أو تم حذفها من القائمة.");
            return;
        }

        const statusLine = action === "approve"
            ? "✅ *الحالة النهائية: تمت التسوية والدفع بنجاح*"
            : "❌ *الحالة النهائية: فشلت العملية (تم إرجاع المبلغ لرصيد الموقع)*";

        const updatedText = `${message.text.split("👇")[0].trim()}\n\n${statusLine}`;

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
