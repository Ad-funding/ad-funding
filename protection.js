let vmP=typeof globalThis!=='undefined'?globalThis:typeof g<!-- بداية نظام حماية التمويل الاعلاني الشامل -->
  
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

  // 2. معالجة الثغرة: عند ترك الصفحة أو التركيز على شريط العنوان
  window.addEventListener('blur', function () {
    // عند الخروج من الصفحة، مسح أي تحديد أو حافظة فوراً
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText('');
    }
  });

  window.addEventListener('focus', function () {
    // عند العودة للصفحة بعد الضغط على شريط العنوان
    checkDevToolsState();
  });

  // 3. منع اختصارات المفاتيح الصارم على مستوى window
  window.addEventListener('keydown', function (event) {
    if (isInputField(event.target)) return;

    const key = event.key ? event.key.toLowerCase() : '';
    const isCtrl = event.ctrlKey || event.metaKey;

    if (key === 'f12' || key === 'printscreen') {
      event.preventDefault();
      event.stopPropagation();
      showCustomNotification('محتوى التمويل الأعلاني محمي بموجب حقوق الطبع والنشر.');
      return false;
    }

    if (isCtrl && blockedKeys.includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      showCustomNotification('تم تعطيل هذا الاختصار للحماية.');
      return false;
    }
  }, true);

  // 4. منع الزر الأيمن للكليك
  window.addEventListener('contextmenu', function (event) {
    if (isInputField(event.target)) return;
    event.preventDefault();
    showCustomNotification('محتوى التمويل الأعلاني محمي بموجب حقوق الطبع والنشر.');
  }, true);

  // 5. منع تحديد النص، النسخ، السحب
  ['selectstart', 'copy', 'cut', 'paste', 'dragstart'].forEach(function (evt) {
    window.addEventListener(evt, function (e) {
      if (!isInputField(e.target)) {
        e.preventDefault();
      }
    }, true);
  });

  // 6. حماية متقدمة ضد فتح DevTools (عن طريق كشف الفروق في أبعاد النافذة و debugger)
  function checkDevToolsState() {
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;

    if (widthThreshold || heightThreshold) {
      showCustomNotification('تنبيه: محاولة فتح أدوات التطوير غير مسموح بها.');
    }
  }

  // تشغيل مصيدة الحماية التلقائية ضد أدوات الفحص
  setInterval(function () {
    const startTime = performance.now();
    (function () {}["constructor"]("debugger")());
    const endTime = performance.now();
    if (endTime - startTime > 100) {
      showCustomNotification('تم كشف أدوات فحص الموقع.');
    }
    checkDevToolsState();
  }, 1000);

  // 7. دالة إظهار التنبيه المخصص
  function showCustomNotification(msg) {
    let notification = document.getElementById('hikayat-notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'hikayat-notification';
      notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #000000e6;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-family: Arial, sans-serif;
        direction: rtl;
        z-index: 9999999;
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        border: 1px solid #25d366;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(notification);
    }
    notification.textContent = msg;
    notification.style.display = 'block';
    notification.style.opacity = '1';

    clearTimeout(window.hikayatNotifTimer);
    window.hikayatNotifTimer = setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => { notification.style.display = 'none'; }, 300);
    }, 2500);
  }
})();

<!-- نهاية نظام حماية التمويل الأعلاني الشامل -->
(function () {
  'use strict';

  // البيانات المطلوبة للتحقق
  const TARGET_URL = 'https://ad-funding.onrender.com';
  const AUTHOR_NAME = 'بوابة الناشرين';
  const STORE_NAME = 'التمويل الأعلاني';

  // وظيفة إغلاق الصفحة وحظر التشغيل نهائياً
  function lockPage() {
    try {
      window.stop();
    } catch (e) {}

    // استبدال محتوى المستند بالكامل بشاشة حظر غير قابلة للإلغاء
    document.documentElement.innerHTML = `
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>تم توقيف الصفحة</title>
        <style>
          body {
            margin: 0; padding: 0;
            background-color: #0d0d0d;
            color: #ff4d4d;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex; align-items: center; justify-content: center;
            height: 100vh; text-align: center; direction: rtl;
          }
          .lock-card {
            background: #1a1a1a;
            padding: 40px 30px;
            border-radius: 16px;
            border: 2px solid #ff4d4d;
            box-shadow: 0 10px 30px rgba(255, 77, 77, 0.3);
            max-width: 480px; width: 90%;
          }
          h1 { font-size: 22px; margin-bottom: 12px; }
          p { color: #ccc; font-size: 15px; line-height: 1.6; margin-bottom: 0; }
        </style>
      </head>
      <body>
        <div class="lock-card">
          <h1>🚫 تم إيقاف تشغيل الصفحة</h1>
          <p>عفواً، تم اكتشاف تغيير أو حذف في حقوق الملكية الفكرية وتوقيع البرمجة الخاص بالمتجر.</p>
        </div>
      </body>
      </html>
    `;

    document.body.style.overflow = 'hidden';

    // حلقة تكرارية لمنع محاولة استرجاع عناصر الصفحة عبر أدوات المطور (DevTools)
    setInterval(function () {
      if (document.querySelector('.copyleft-area') || !document.querySelector('.lock-card')) {
        window.location.reload();
      }
    }, 500);
  }

  // دالة فحص السلامة والتحقق من الحقوق
  function verifyRights() {
    const copyleftElem = document.querySelector('.copyleft-area');
    
    // 1. فحص وجود الحاوية الرئيسية
    if (!copyleftElem) {
      return lockPage();
    }

    // 2. فحص محتوى النصوص
    const textContent = copyleftElem.innerText || copyleftElem.textContent || '';
    if (!textContent.includes(AUTHOR_NAME) || !textContent.includes(STORE_NAME)) {
      return lockPage();
    }

    // 3. فحص عنصر الرابط والـ href
    const linkElem = copyleftElem.querySelector('a');
    if (!linkElem) {
      return lockPage();
    }

    const hrefVal = linkElem.getAttribute('href') || '';
    if (!hrefVal.includes(TARGET_URL)) {
      return lockPage();
    }

    // 4. فحص الإخفاء بواسطة CSS (Display, Visibility, Opacity, Font-size)
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

  // مراقبة الـ DOM لمنع الحذف أو التعديل اللحظي بـ DevTools (MutationObserver)
  const observer = new MutationObserver(function () {
    verifyRights();
  });

  // تفعيل المراقب بمجرد تجهيز الـ DOM
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

  // فحوصات دورية معززة عند تحميل ومغادرة الصفحة
  window.addEventListener('DOMContentLoaded', verifyRights);
  window.addEventListener('load', verifyRights);
  setInterval(verifyRights, 800);
  
})();
