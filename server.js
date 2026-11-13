const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// قراءة البيانات القادمة من النماذج (Forms) أو الجهاَن (JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// السماح بقراءة الملفات الثابتة من مجلد public (مثل HTML و CSS)
app.use(express.static(path.join(__dirname, 'public')));

// دالة إرسال تنبيه إلى تيليجرام
async function sendTelegramAlert(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message })
        });
    } catch (error) {
        console.error('Telegram Error:', error);
    }
}

// مسار تجريبي لتسجيل الدخول وإرسال تنبيه لتيليجرام
app.post('/api/login', async (req, res) => {
    const { username } = req.body;
    await sendTelegramAlert(`🚨 محاولة تسجيل دخول جديدة للمستخدم: ${username}`);
    res.json({ success: true, message: 'تم تسجيل الدخول بنجاح وإرسال التنبيه' });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
