/* ==========================================================================
   نظام حماية منصة التمويل الإعلاني الشامل (Anti-DevTools & Integrity Lock)
   ========================================================================== */

(function () {
    'use strict';

    // 1. قائمة الاختصارات والأزرار المحظورة (عربي + إنجليزي)
    const blockedCtrlKeys = [
        'u', 's', 'p', 'a', 'c', 'x', 'i', 'j', 'h', 'd', 'r',
        'ع', 'س', 'ح', 'ش', 'ؤ', 'ء', 'ه', 'ت', 'أ', 'ا', 'ي', 'ق'
    ];

    const blockedCtrlShiftKeys = [
        'i', 'j', 'c', 'k', 'm',
        'ه', 'ت', 'ؤ', 'ن', 'ة'
    ];

    // السماح بالكتابة داخل حقول الإدخال والقوائم فقط
    function isInputField(target) {
        if (!target) return false;
        const tag = target.tagName ? target.tagName.toLowerCase() : '';
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    // 2. دالة إظهار إشعار الحماية بتصميم متناسق مع هوية المنصة
    function showCustomNotification(msg) {
        if (!document.body) return;
        let notification = document.getElementById('hikayat-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'hikayat-notification';
            notification.style.cssText = `
                position: fixed;
                bottom: 22px;
                right: 22px;
                background: rgba(15, 23, 42, 0.95);
                backdrop-filter: blur(10px);
                color: #f8fafc;
                padding: 12px 20px;
                border-radius: 12px;
                font-size: 13.5px;
                font-weight: 700;
                font-family: 'Cairo', Arial, sans-serif;
                direction: rtl;
                z-index: 2147483647;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(16, 185, 129, 0.25);
                border: 1px solid #10b981;
                transition: opacity 0.3s ease, transform 0.3s ease;
                pointer-events: none;
            `;
            document.body.appendChild(notification);
        }
        notification.textContent = '🛡️ ' + msg;
        notification.style.display = 'block';
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';

        clearTimeout(window.hikayatNotifTimer);
        window.hikayatNotifTimer = setTimeout(function () {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(10px)';
            setTimeout(function () {
                notification.style.display = 'none';
            }, 300);
        }, 2500);
    }

    // 3. مسح الحافظة عند مغادرة التبويب أو الضغط على شريط العنوان
    window.addEventListener('blur', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('').catch(function () {});
        }
    });

    window.addEventListener('focus', function () {
        checkDevToolsState();
    });

    // 4. منع اختصارات لوحة المفاتيح الخاصة بفحص الكود أو حفظ الصفحة
    window.addEventListener('keydown', function (event) {
        const key = event.key ? event.key.toLowerCase() : '';
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        // حظر F12 و PrintScreen دائماً حتى لو كان التركيز داخل حقل إدخال
        if (key === 'f12' || key === 'printscreen' || event.keyCode === 123 || event.keyCode === 44) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
            return false;
        }

        // حظر اختصارات المطورين Ctrl+Shift+I / J / C دائماً
        if (isCtrl && isShift && blockedCtrlShiftKeys.includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('أدوات فحص العناصر معطلة لحماية المنصة.');
            return false;
        }

        // السماح بالكتابة الطبيعية داخل حقول الإدخال ما عدا Ctrl+U و Ctrl+S
        if (isInputField(event.target)) {
            if (isCtrl && (key === 'u' || key === 's' || key === 'ع' || key === 'س')) {
                event.preventDefault();
                event.stopPropagation();
                showCustomNotification('تم تعطيل هذا الاختصار للحماية.');
                return false;
            }
            return;
        }

        if (isCtrl && blockedCtrlKeys.includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('تم تعطيل هذا الاختصار للحماية.');
            return false;
        }
    }, true);

    // 5. منع الزر الأيمن للماوس (Context Menu)
    window.addEventListener('contextmenu', function (event) {
        if (isInputField(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
        return false;
    }, true);

    // 6. منع تحديد النصوص، النسخ، القص، والسحب خارج الحقول
    ['selectstart', 'copy', 'cut', 'dragstart'].forEach(function (evt) {
        window.addEventListener(evt, function (e) {
            if (!isInputField(e.target)) {
                e.preventDefault();
            }
        }, true);
    });

    // 7. كشف فتح DevTools عبر أبعاد النافذة ومصيدة التوقيت
    function checkDevToolsState() {
        const threshold = 170;
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) return; // تجنب الإنذار الكاذب بسبب شريط متصفح الهاتف

        const widthThreshold = (window.outerWidth - window.innerWidth) > threshold;
        const heightThreshold = (window.outerHeight - window.innerHeight) > threshold;

        if (widthThreshold || heightThreshold) {
            showCustomNotification('تنبيه: محاولة فتح أدوات التطوير غير مسموح بها.');
            try { console.clear(); } catch (e) {}
        }
    }

    setInterval(function () {
        const startTime = performance.now();
        (function () {}['constructor']('debugger')());
        const endTime = performance.now();
        if (endTime - startTime > 120) {
            try { console.clear(); } catch (e) {}
            showCustomNotification('تم كشف أدوات فحص الموقع.');
        }
        checkDevToolsState();
    }, 1200);
})();

/* ==========================================================================
   الجزء الثاني: حماية حقوق الملكية الفكرية وتوقيع المنصة (.copyleft-area)
   ========================================================================== */

(function () {
    'use strict';

    const TARGET_URL = 'https://ad-funding.onrender.com';
    const AUTHOR_NAME = 'بوابة الناشرين';
    const STORE_NAME = 'التمويل الإعلاني';

    let isLocked = false;

    // 1. إنشاء شريط الحقوق تلقائياً في أسفل الصفحة إذا لم يكن موجوداً في HTML
    function ensureRightsFooterExists() {
        if (!document.body || isLocked) return;
        let existing = document.querySelector('.copyleft-area');
        if (!existing) {
            const footerDiv = document.createElement('div');
            footerDiv.className = 'copyleft-area';
            footerDiv.style.cssText = `
                margin-top: 24px;
                padding: 10px 18px;
                text-align: center;
                font-size: 12.5px;
                color: #94a3b8;
                font-family: 'Cairo', sans-serif;
                z-index: 10;
                user-select: none;
            `;
            footerDiv.innerHTML = `جميع الحقوق محفوظة © منصة <a href="${TARGET_URL}" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: none; font-weight: 700;">${STORE_NAME}</a> — بإدارة ${AUTHOR_NAME}`;
            document.body.appendChild(footerDiv);
        }
    }

    // 2. دالة إغلاق الصفحة نهائياً عند التلاعب بحقوق المنصة
    function lockPage() {
        if (isLocked) return;
        isLocked = true;

        try {
            window.stop();
        } catch (e) {}

        document.documentElement.innerHTML = `
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>تم إيقاف تشغيل الصفحة</title>
                <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet">
                <style>
                    body {
                        margin: 0; padding: 0;
                        background-color: #070b14;
                        color: #f43f5e;
                        font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
                        display: flex; align-items: center; justify-content: center;
                        height: 100vh; text-align: center; direction: rtl;
                        overflow: hidden;
                    }
                    .lock-card {
                        background: #111827;
                        padding: 40px 30px;
                        border-radius: 20px;
                        border: 2px solid #f43f5e;
                        box-shadow: 0 15px 40px rgba(244, 63, 94, 0.25);
                        max-width: 480px; width: 90%;
                    }
                    h1 { font-size: 22px; margin-bottom: 12px; font-weight: 800; color: #fff; }
                    p { color: #94a3b8; font-size: 15px; line-height: 1.7; margin-bottom: 0; }
                </style>
            </head>
            <body>
                <div class="lock-card">
                    <div style="font-size: 46px; margin-bottom: 10px;">🚫</div>
                    <h1>تم إيقاف تشغيل الصفحة</h1>
                    <p>عفواً، تم اكتشاف تغيير أو حذف في حقوق الملكية الفكرية وتوقيع البرمجة الخاص بمنصة التمويل الأعلاني.</p>
                </div>
            </body>
            </html>
        `;

        setInterval(function () {
            if (!document.querySelector('.lock-card')) {
                window.location.reload();
            }
        }, 500);
    }

    // 3. دالة فحص سلامة توقيع الحقوق وعدم إخفائه
    function verifyRights() {
        if (isLocked || !document.body) return;

        const copyleftElem = document.querySelector('.copyleft-area');
        if (!copyleftElem) {
            return lockPage();
        }

        const textContent = copyleftElem.innerText || copyleftElem.textContent || '';
        if (!textContent.includes(AUTHOR_NAME) || !textContent.includes(STORE_NAME)) {
            return lockPage();
        }

        const linkElem = copyleftElem.querySelector('a');
        if (!linkElem) {
            return lockPage();
        }

        const hrefVal = linkElem.getAttribute('href') || '';
        if (!hrefVal.includes(TARGET_URL)) {
            return lockPage();
        }

        const containerStyle = window.getComputedStyle(copyleftElem);
        const linkStyle = window.getComputedStyle(linkElem);

        if (
            containerStyle.display === 'none' ||
            containerStyle.visibility === 'hidden' ||
            parseFloat(containerStyle.opacity) === 0 ||
            containerStyle.fontSize === '0px' ||
            linkStyle.display === 'none' ||
            linkStyle.visibility === 'hidden' ||
            parseFloat(linkStyle.opacity) === 0
        ) {
            return lockPage();
        }
    }

    // 4. بدء التفعيل والمراقبة المستمرة (MutationObserver)
    function startProtection() {
        ensureRightsFooterExists();
        verifyRights();

        const observer = new MutationObserver(function () {
            verifyRights();
        });

        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startProtection);
    } else {
        startProtection();
    }

    window.addEventListener('load', startProtection);
    setInterval(verifyRights, 900);
})();
