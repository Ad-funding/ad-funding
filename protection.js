/* ==========================================================================
   نظام حماية منصة التمويل الإعلاني الشامل (حماية الكود بدون إيقاف الموقع)
   ========================================================================== */

(function () {
    'use strict';

    // 1. الأزرار والاختصارات المحظورة (عربي + إنجليزي)
    const blockedCtrlKeys = [
        'u', 's', 'p', 'a', 'c', 'x', 'i', 'j', 'h', 'd', 'r',
        'ع', 'س', 'ح', 'ش', 'ؤ', 'ء', 'ه', 'ت', 'أ', 'ا', 'ي', 'ق'
    ];

    const blockedCtrlShiftKeys = [
        'i', 'j', 'c', 'k', 'm',
        'ه', 'ت', 'ؤ', 'ن', 'ة'
    ];

    // السماح بالكتابة الطبيعية داخل حقول الإدخال والقوائم فقط
    function isInputField(target) {
        if (!target) return false;
        const tag = target.tagName ? target.tagName.toLowerCase() : '';
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
    }

    // 2. إشعار الحماية المخصص
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

    // 3. مسح الحافظة عند الخروج من الصفحة
    window.addEventListener('blur', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('').catch(function () {});
        }
    });

    // 4. منع اختصارات لوحة المفاتيح (F12, Ctrl+U, Ctrl+Shift+I, PrintScreen)
    window.addEventListener('keydown', function (event) {
        const key = event.key ? event.key.toLowerCase() : '';
        const isCtrl = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (key === 'f12' || key === 'printscreen' || event.keyCode === 123 || event.keyCode === 44) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
            return false;
        }

        if (isCtrl && isShift && blockedCtrlShiftKeys.includes(key)) {
            event.preventDefault();
            event.stopPropagation();
            showCustomNotification('أدوات فحص العناصر معطلة لحماية المنصة.');
            return false;
        }

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

    // 5. منع الزر الأيمن للماوس خارج حقول الكتابة
    window.addEventListener('contextmenu', function (event) {
        if (isInputField(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        showCustomNotification('محتوى التمويل محمي بموجب حقوق الطبع والنشر.');
        return false;
    }, true);

    // 6. منع تحديد النصوص أو نسخها أو سحبها خارج الحقول
    ['selectstart', 'copy', 'cut', 'dragstart'].forEach(function (evt) {
        window.addEventListener(evt, function (e) {
            if (!isInputField(e.target)) {
                e.preventDefault();
            }
        }, true);
    });

    // 7. كشف فتح أدوات المطورين (DevTools) على أجهزة الكمبيوتر
    function checkDevToolsState() {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) return;

        const threshold = 170;
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
    }, 1500);

    // 8. تثبيت واسترجاع شريط الحقوق تلقائياً إذا حُذف (بدون إغلاق الصفحة)
    const TARGET_URL = 'https://ad-funding.onrender.com';
    const AUTHOR_NAME = 'شركاء منتدابون';
    const STORE_NAME = 'التمويل الأعلاني';

    function keepRightsFooterAlive() {
        if (!document.body) return;
        let footer = document.querySelector('.copyleft-area');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'copyleft-area';
            document.body.appendChild(footer);
        }

        footer.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-top: 18px;
            padding: 10px 16px;
            text-align: center;
            font-size: 12.5px !important;
            color: #94a3b8;
            font-family: 'Cairo', sans-serif;
            z-index: 10;
            user-select: none;
        `;

        const expectedHtml = `جميع الحقوق محفوظة © منصة <a href="${TARGET_URL}" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: none; font-weight: 700;">${STORE_NAME}</a> — بإدارة ${AUTHOR_NAME}`;
        if (!footer.innerHTML.includes(STORE_NAME) || !footer.innerHTML.includes(AUTHOR_NAME)) {
            footer.innerHTML = expectedHtml;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', keepRightsFooterAlive);
    } else {
        keepRightsFooterAlive();
    }

    setInterval(keepRightsFooterAlive, 2000);
})();
