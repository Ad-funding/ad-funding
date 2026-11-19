/* بداية نظام حماية التمويل الإعلاني الشامل */
(function () {
  'use strict';

  // 1. الأزرار المحظورة (عربي + إنجليزي)
  const blockedKeys = [
    'f12', 'printscreen', 'escape',
    'p', 'u', 'a', 'c', 'v', 'x', 's', 'd', 'r', 'j', 'i', 'h',
    'ح', 'ع', 'ش', 'ؤ', 'ر', 'ء', 'س', 'ي', 'ق', 'ت', 'ه', 'ا'
  ];

  function isInputField(target) {
    if (!target) return false;
    const tag = target.tagName ? target.tagName.toLowerCase() : '';
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  }

  // 2. مسح الحافظة عند مغادرة الصفحة
  window.addEventListener('blur', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('').catch(function () {});
    }
  });

  window.addEventListener('focus', function () {
    checkDevToolsState();
  });

  // 3. منع اختصارات المفاتيح
  window.addEventListener('keydown', function (event) {
    if (isInputField(event.target)) return;

    const key = event.key ? event.key.toLowerCase() : '';
    const isCtrl = event.ctrlKey || event.metaKey;

    if (key === 'f12' || key === 'printscreen') {
      event.preventDefault();
      event.stopPropagation();
      showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
      return false;
    }

    if (isCtrl && blockedKeys.includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      showCustomNotification('تم تعطيل هذا الاختصار للحماية.');
      return false;
    }
  }, true);

  // 4. منع الزر الأيمن للفأرة
  window.addEventListener('contextmenu', function (event) {
    if (isInputField(event.target)) return;
    event.preventDefault();
    showCustomNotification('محتوى التمويل الإعلاني محمي بموجب حقوق الطبع والنشر.');
  }, true);

  // 5. منع التحديد والنسخ والسحب
  ['selectstart', 'copy', 'cut', 'paste', 'dragstart'].forEach(function (evt) {
    window.addEventListener(evt, function (e) {
      if (!isInputField(e.target)) {
        e.preventDefault();
      }
    }, true);
  });

  // 6. كشف أدوات المطورين
  function checkDevToolsState() {
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;

    if (widthThreshold || heightThreshold) {
      showCustomNotification('تنبيه: محاولة فتح أدوات التطوير غير مسموح بها.');
    }
  }

  setInterval(function () {
    const startTime = performance.now();
    (function () {}["constructor"]("debugger")());
    const endTime = performance.now();
    if (endTime - startTime > 100) {
      showCustomNotification('تم كشف أدوات فحص الموقع.');
    }
    checkDevToolsState();
  }, 1000);

  // 7. إظهار التنبيه المخصص
  function showCustomNotification(msg) {
    if (!document.body) return;
    let notification = document.getElementById('hikayat-notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'hikayat-notification';
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(15, 23, 42, 0.95);
        color: #fff;
        padding: 12px 20px;
        border-radius: 10px;
        font-size: 13px;
        font-family: 'Cairo', Arial, sans-serif;
        direction: rtl;
        z-index: 9999999;
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        border: 1px solid #10b981;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(notification);
    }
    notification.textContent = msg;
    notification.style.display = 'block';
    notification.style.opacity = '1';

    clearTimeout(window.hikayatNotifTimer);
    window.hikayatNotifTimer = setTimeout(function () {
      notification.style.opacity = '0';
      setTimeout(function () { notification.style.display = 'none'; }, 300);
    }, 2500);
  }
})();

/* نظام التحقق الصارم من بقاء حقوق الملكية ورابط الشروط */
(function () {
  'use strict';

  const REQUIRED_PATH = '/terms.html';
  const REQUIRED_BRAND = 'AD$';
  const REQUIRED_TEXT = 'للتمويل الإعلاني';
  let isLocked = false;

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
        <title>تم توقيف الصفحة</title>
        <style>
          body {
            margin: 0; padding: 0;
            background-color: #070b14;
            color: #f43f5e;
            font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
            display: flex; align-items: center; justify-content: center;
            height: 100vh; text-align: center; direction: rtl;
          }
          .lock-card {
            background: #111827;
            padding: 40px 30px;
            border-radius: 16px;
            border: 2px solid #f43f5e;
            box-shadow: 0 10px 30px rgba(244, 63, 94, 0.3);
            max-width: 480px; width: 90%;
          }
          h1 { font-size: 22px; margin-bottom: 12px; }
          p { color: #cbd5e1; font-size: 15px; line-height: 1.6; margin-bottom: 0; }
        </style>
      </head>
      <body>
        <div class="lock-card">
          <h1>🚫 تم إيقاف تشغيل الصفحة</h1>
          <p>عفواً، تم اكتشاف تغيير أو حذف في حقوق الملكية الفكرية وتوقيع البرمجة الخاص بالتمويل الإعلاني.</p>
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

  function verifyRights() {
    if (isLocked || !document.body) return;

    // السماح بصفحة الشروط نفسها وصفحة الصيانة بالعمل بدون شرط وجود شريط الحقوق السفلي
    const currentPath = window.location.pathname;
    if (currentPath.includes('terms.html') || currentPath.includes('maintenance.html') || currentPath.includes('dev-panel-lock')) {
      return;
    }

    const legalElem = document.querySelector('.ad-legal-bar');

    // 1. فحص وجود الحاوية
    if (!legalElem) {
      return lockPage();
    }

    // 2. فحص النصوص الأساسية للحقوق
    const textContent = legalElem.innerText || legalElem.textContent || '';
    if (!textContent.includes(REQUIRED_BRAND) || !textContent.includes(REQUIRED_TEXT)) {
      return lockPage();
    }

    // 3. فحص وجود الرابط وصحة وجهته (/terms.html)
    const linkElem = legalElem.querySelector('a');
    if (!linkElem) {
      return lockPage();
    }

    const hrefVal = linkElem.getAttribute('href') || '';
    if (!hrefVal.includes(REQUIRED_PATH)) {
      return lockPage();
    }

    // 4. فحص عدم إخفاء العنصر عبر CSS
    const containerStyle = window.getComputedStyle(legalElem);
    const linkStyle = window.getComputedStyle(linkElem);

    if (
      containerStyle.display === 'none' ||
      containerStyle.visibility === 'hidden' ||
      parseFloat(containerStyle.opacity) === 0 ||
      parseFloat(linkStyle.fontSize) === 0 ||
      linkStyle.display === 'none' ||
      linkStyle.visibility === 'hidden' ||
      parseFloat(linkStyle.opacity) === 0
    ) {
      return lockPage();
    }
  }

  const observer = new MutationObserver(function () {
    verifyRights();
  });

  const initObserver = setInterval(function () {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
      clearInterval(initObserver);
      verifyRights();
    }
  }, 50);

  window.addEventListener('DOMContentLoaded', verifyRights);
  window.addEventListener('load', verifyRights);
  setInterval(verifyRights, 1000);
})();
