/* ==========================================================================
   نظام حماية منصة التمويل الإعلاني الشامل (متوافق مع جميع الأجهزة والشاشات)
   ========================================================================== */

(function () {
    'use strict';

    // 1. التعرف الذكي على نوع الجهاز (هاتف / تابلت / كمبيوتر)
    function isTouchOrMobileDevice() {
        return (
            ('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            window.matchMedia('(pointer: coarse)').matches ||
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        );
    }

    // التحقق مما إذا كان العنصر حقل إدخال أو زر تفاعلي للسماح بالكتابة واللمس السلس
    function isInteractiveOrInput(target) {
        if (!target || !target.tagName) return false;
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option' || target.isContentEditable) {
            return true;
        }
        if (target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) {
            return true;
        }
        return false;
    }

    // 2. حقن تنسيقات CSS المتجاوبة لجميع الشاشات (الهواتف، النوتش، سطح المكتب)
    function injectResponsiveProtectionStyles() {
        if (document.getElementById('ad-protection-styles')) return;
        const style = document.createElement('style');
        style.id = 'ad-protection-styles';
        style.textContent = `
            /* منع تحديد النصوص والضغط المطول في الصفحات مع استثناء حقول الإدخال */
            body, .container, header, .balance-card, .metric-card, .history-card {
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
            }

            /* السماح الكامل بالكتابة والتحديد داخل حقول الإدخال على جميع الهواتف */
            input, textarea, select {
                -webkit-user-select: text !important;
                -moz-user-select: text !important;
                -ms-user-select: text !important;
                user-select: text !important;
                -webkit-touch-callout: default !important;
            }

            /* إشعار الحماية المتجاوب مع الهواتف والكمبيوتر */
            #hikayat-notification {
                position: fixed;
                bottom: calc(18px + env(safe-area-inset-bottom, 0px));
                right: 20px;
                background: rgba(15, 23, 42, 0.96);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #f8fafc;
                padding: 12px 18px;
                border-radius: 12px;
                font-size: clamp(12.5px, 3.2vw, 14px);
                font-weight: 700;
                font-family: 'Cairo', system-ui, -apple-system, sans-serif;
                direction: rtl;
                text-align: center;
                z-index: 2147483647;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55), 0 0 15px rgba(16, 185, 129, 0.25);
                border: 1px solid rgba(16, 185, 129, 0.65);
                transition: opacity 0.25s ease, transform 0.25s ease;
                pointer-events: none;
                max-width: min(400px, calc(100vw - 32px));
                line-height: 1.5;
            }

            @media (max-width: 600px) {
                #hikayat-notification {
                    right: 16px;
                    left: 16px;
                    margin: 0 auto;
                }
            }

            /* تنسيق شريط الحقوق المتجاوب مع جميع الشاشات */
            .copyleft-area {
                width: 100%;
                max-width: 760px;
                margin: 20px auto 8px auto;
                padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px;
                text-align: center;
                font-size: clamp(11.5px, 2.8vw, 13px);
                color: #94a3b8;
                font-family: 'Cairo', system-ui, sans-serif;
                line-height: 1.6;
                z-index: 10;
                background: rgba(15, 23, 42, 0.55);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 14px;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
            }

            .copyleft-area a {
                color: #3b82f6;
                text-decoration: none;
                font-weight: 700;
                transition: color 0.2s ease;
            }

            .copyleft-area a:hover {
                color: #10b981;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    injectResponsiveProtectionStyles();
    window.addEventListener('DOMContentLoaded', injectResponsiveProtectionStyles);

    // 3. قائمة الاختصارات المحظورة على لوحة المفاتيح
    const blockedCtrlKeys = [
        'u', 's', 'p', 'a', 'c', 'x', 'i', 'j', 'h', 'd', 'r',
        'ع', 'س', 'ح', 'ش', 'ؤ', 'ء', 'ه', 'ت', 'أ', 'ا', 'ي', 'ق'
    ];

    const blockedCtrlShiftKeys = [
        'i', 'j', 'c', 'k', 'm',
        'ه', 'ت', 'ؤ', 'ن', 'ة'
    ];

    // 4. إظهار التنبيه المتجاوب
    function showCustomNotification(msg) {
        if (!document.body) return;
        let notification = document.getElementById('hikayat-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'hikayat-notification';
            document.body.appendChild(notification);
        }
        notification.textContent = '🛡️ ' + msg;
        notification.style.display = 'block';
        notification.style.opacity = '1';
        notification.style.transform = 'translateY(0)';

        clearTimeout(window.hikayatNotifTimer);
        window.hikayatNotifTimer = setTimeout(function () {
            notification.style.opacity = '0';
            notification.style.transform = 'translateY(8px)';
            setTimeout(function () {
                if (notification) notification.style.display = 'none';
            }, 250);
        }, 2400);
    }

    // 5. منع اختصارات الفحص والنسخ على لوحة المفاتيح
    window.addEventListener('keydown', function (event) {
        const key = event.key ? event.key.toLowerCase() : '';
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        // منع F12 و PrintScreen على جميع الأجهزة
        if (key === 'f12' || key === 'printscreen' || event.keyCode === 123 || event.keyCode === 44) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
            return false;
        }

        // منع Ctrl+Shift+I / J / C
        if (isCtrl && isShift && blockedCtrlShiftKeys.includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('أدوات فحص العناصر معطلة لحماية المنصة.');
            return false;
        }

        // إذا كان المستخدم يكتب داخل حقل إدخال، نسمح له بالكتابة الطبيعية ونمنع فقط حفظ الصفحة أو عرض المصدر
        if (isInteractiveOrInput(event.target)) {
            if (isCtrl && (key === 'u' || key === 's' || key === 'p' || key === 'ع' || key === 'س' || key === 'ح')) {
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

    // 6. منع القائمة المنبثقة (الزر الأيمن على الكمبيوتر / الضغط المطول خارج الحقول على الهاتف)
    window.addEventListener('contextmenu', function (event) {
        if (isInteractiveOrInput(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
        return false;
    }, true);

    // 7. منع النسخ والقص والسحب خارج حقول الإدخال
    ['selectstart', 'copy', 'cut', 'dragstart'].forEach(function (evt) {
        window.addEventListener(evt, function (e) {
            if (!isInteractiveOrInput(e.target)) {
                e.preventDefault();
            }
        }, true);
    });

    // 8. فحص فتح أدوات المطورين (DevTools) مع استثناء الهواتف لمنع الإنذار الكاذب عند ظهور الكيبورد
    function checkDevToolsState() {
        if (isTouchOrMobileDevice()) return; // على الهواتف الكيبورد يغير innerHeight وهو أمر طبيعي

        const threshold = 175;
        const widthDiff = Math.abs(window.outerWidth - window.innerWidth) > threshold;
        const heightDiff = Math.abs(window.outerHeight - window.innerHeight) > threshold;

        if (widthDiff || heightDiff) {
            showCustomNotification('تنبيه: محاولة فتح أدوات التطوير غير مسموح بها.');
            try { console.clear(); } catch (e) {}
        }
    }

    window.addEventListener('focus', checkDevToolsState);
    window.addEventListener('resize', function () {
        if (!isTouchOrMobileDevice()) {
            checkDevToolsState();
        }
    });

    // فحص دوري خفيف لا يستهلك بطارية الهاتف ولا يعطل الكتابة
    setInterval(function () {
        if (!isTouchOrMobileDevice()) {
            const startTime = performance.now();
            (function () {}['constructor']('debugger')());
            const endTime = performance.now();
            if (endTime - startTime > 120) {
                try { console.clear(); } catch (e) {}
                showCustomNotification('تم كشف أدوات فحص الموقع.');
            }
            checkDevToolsState();
        }
    }, 1500);
})();

/* ==========================================================================
   الجزء الثاني: حماية توقيع الحقوق (.copyleft-area) وشاشة الإغلاق المتجاوبة
   ========================================================================== */

(function () {
    'use strict';

    const TARGET_URL = 'https://ad-funding.onrender.com';
    const AUTHOR_NAME = 'شركاء منتدابون';
    const STORE_NAME = 'التمويل الأعلاني';

    let isLocked = false;

    // 1. إدراج شريط الحقوق تلقائياً في المكان المناسب لجميع الشاشات
    function ensureRightsFooterExists() {
        if (!document.body || isLocked) return;
        let existing = document.querySelector('.copyleft-area');
        if (!existing) {
            const footerDiv = document.createElement('footer');
            footerDiv.className = 'copyleft-area';
            footerDiv.innerHTML = `جميع الحقوق محفوظة © منصة <a href="${TARGET_URL}" target="_blank" rel="noopener noreferrer">${STORE_NAME}</a> — بإدارة ${AUTHOR_NAME}`;

            // إذا كانت صفحة الصيانة (body يعتمد flex أفقي)، نضع التوقيع داخل الحاوية لتجنب كسر التصميم على الموبايل
            const mainContainer = document.querySelector('.container');
            if (mainContainer && window.location.pathname.includes('maintenance') || document.getElementById('emergencyModal')) {
                if (mainContainer) {
                    footerDiv.style.marginTop = '22px';
                    footerDiv.style.background = 'rgba(0, 0, 0, 0.25)';
                    mainContainer.appendChild(footerDiv);
                    return;
                }
            }

            document.body.appendChild(footerDiv);
        }
    }

    // 2. شاشة الحظر المتجاوبة مع جميع الشاشات عند التلاعب بالحقوق
    function lockPage() {
        if (isLocked) return;
        isLocked = true;

        try { window.stop(); } catch (e) {}

        document.documentElement.innerHTML = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <title>تم إيقاف تشغيل الصفحة</title>
                <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet">
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        background: radial-gradient(circle at center, #111827 0%, #070b14 100%);
                        color: #f43f5e;
                        font-family: 'Cairo', system-ui, -apple-system, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        min-height: 100dvh;
                        padding: 20px;
                        text-align: center;
                        direction: rtl;
                        overflow: hidden;
                    }
                    .lock-card {
                        background: rgba(17, 24, 39, 0.92);
                        padding: clamp(24px, 5vw, 40px) clamp(18px, 4vw, 30px);
                        border-radius: 22px;
                        border: 2px solid rgba(244, 63, 94, 0.7);
                        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(244, 63, 94, 0.25);
                        max-width: 460px;
                        width: 100%;
                    }
                    .lock-icon {
                        font-size: clamp(38px, 8vw, 52px);
                        margin-bottom: 12px;
                    }
                    h1 {
                        font-size: clamp(18px, 4.5vw, 23px);
                        margin-bottom: 12px;
                        font-weight: 800;
                        color: #ffffff;
                    }
                    p {
                        color: #94a3b8;
                        font-size: clamp(13.5px, 3.5vw, 15px);
                        line-height: 1.75;
                    }
                </style>
            </head>
            <body>
                <div class="lock-card">
                    <div class="lock-icon">🚫</div>
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
        }, 600);
    }

    // 3. التحقق الدوري من سلامة شريط الحقوق
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
            parseFloat(containerStyle.fontSize) === 0 ||
            linkStyle.display === 'none' ||
            linkStyle.visibility === 'hidden' ||
            parseFloat(linkStyle.opacity) === 0
        ) {
            return lockPage();
        }
    }

    // 4. بدء التفعيل والمراقبة
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
    setInterval(verifyRights, 1000);
})();
