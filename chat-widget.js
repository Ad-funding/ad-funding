// chat-widget.js - أداة الدعم المباشر للناشرين المربوطة ببوت التيليجرام
(function () {
    const STORAGE_ID_KEY = "ad_portal_support_client_id";
    let clientId = localStorage.getItem(STORAGE_ID_KEY);
    if (!clientId) {
        clientId = "pub_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
        localStorage.setItem(STORAGE_ID_KEY, clientId);
    }

    // تحديد رابط السيرفر تلقائياً
    const API_BASE = "";

    const style = document.createElement("style");
    style.innerHTML = `
        #ad-chat-bubble {
            position: fixed;
            bottom: 22px;
            right: 22px;
            width: 58px;
            height: 58px;
            border-radius: 50%;
            background: linear-gradient(135deg, #2563eb, #10b981);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            cursor: pointer;
            box-shadow: 0 8px 25px rgba(37, 99, 235, 0.45);
            z-index: 99998;
            transition: transform 0.25s ease, box-shadow 0.25s ease;
            user-select: none;
        }
        #ad-chat-bubble:hover {
            transform: scale(1.08);
            box-shadow: 0 12px 30px rgba(16, 185, 129, 0.55);
        }
        #ad-chat-unread-badge {
            position: absolute;
            top: -3px;
            left: -3px;
            background: #f43f5e;
            color: #fff;
            font-size: 11px;
            font-weight: 800;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            border: 2px solid #070b14;
        }
        #ad-welcome-pill {
            position: fixed;
            bottom: 30px;
            right: 90px;
            background: rgba(15, 23, 42, 0.95);
            color: #f8fafc;
            border: 1px solid rgba(59, 130, 246, 0.45);
            padding: 9px 16px;
            border-radius: 20px;
            font-family: 'Cairo', Tahoma, sans-serif;
            font-size: 13px;
            font-weight: 700;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
            z-index: 99997;
            cursor: pointer;
            direction: rtl;
            opacity: 0;
            transform: translateX(15px) scale(0.9);
            transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            white-space: nowrap;
        }
        #ad-chat-box {
            position: fixed;
            bottom: 92px;
            right: 22px;
            width: 355px;
            max-width: calc(100vw - 32px);
            height: 500px;
            max-height: calc(100vh - 120px);
            background: #0f172a;
            border: 1px solid rgba(59, 130, 246, 0.35);
            border-radius: 18px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
            display: none;
            flex-direction: column;
            z-index: 99999;
            direction: rtl;
            font-family: 'Cairo', Tahoma, sans-serif;
            overflow: hidden;
        }
        #ad-chat-header {
            background: linear-gradient(135deg, #1e3a8a, #0f172a);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            color: #fff;
            padding: 13px 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .ad-header-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .ad-online-dot {
            width: 10px;
            height: 10px;
            background: #10b981;
            border-radius: 50%;
            box-shadow: 0 0 8px #10b981;
        }
        .ad-header-title {
            font-size: 14px;
            font-weight: 800;
            display: block;
        }
        .ad-header-sub {
            font-size: 11px;
            color: #93c5fd;
            display: block;
        }
        #ad-chat-close {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #fff;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            font-size: 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #ad-chat-guide-bar {
            background: rgba(245, 158, 11, 0.12);
            border-bottom: 1px solid rgba(245, 158, 11, 0.25);
            color: #fbbf24;
            padding: 7px 12px;
            font-size: 11.5px;
            text-align: center;
            font-weight: 600;
        }
        #ad-chat-messages {
            flex: 1;
            padding: 14px;
            overflow-y: auto;
            background: #070b14;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .ad-msg {
            padding: 9px 13px;
            border-radius: 12px;
            max-width: 82%;
            font-size: 13px;
            line-height: 1.55;
            word-break: break-word;
            white-space: pre-line;
        }
        .ad-msg.client {
            background: linear-gradient(135deg, #2563eb, #1d4ed8);
            color: #fff;
            align-self: flex-start;
            border-bottom-right-radius: 2px;
        }
        .ad-msg.admin {
            background: #1e293b;
            color: #f1f5f9;
            border: 1px solid rgba(255, 255, 255, 0.08);
            align-self: flex-end;
            border-bottom-left-radius: 2px;
        }
        .ad-msg img {
            max-width: 100%;
            border-radius: 8px;
            margin-top: 6px;
            border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .ad-quick-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        }
        .ad-chip {
            background: rgba(59, 130, 246, 0.15);
            border: 1px solid rgba(59, 130, 246, 0.35);
            color: #93c5fd;
            padding: 5px 10px;
            border-radius: 16px;
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .ad-chip:hover {
            background: #2563eb;
            color: #fff;
        }
        .ad-chat-closed-notice {
            background: rgba(244, 63, 94, 0.15);
            border: 1px solid rgba(244, 63, 94, 0.35);
            color: #fb7185;
            padding: 9px;
            border-radius: 8px;
            text-align: center;
            font-size: 12px;
            font-weight: 700;
        }
        #ad-chat-input-area {
            padding: 10px;
            background: #0f172a;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            gap: 7px;
            align-items: center;
        }
        #ad-chat-input {
            flex: 1;
            padding: 9px 12px;
            background: #070b14;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 10px;
            color: #fff;
            font-size: 13px;
            outline: none;
        }
        #ad-chat-input:focus {
            border-color: #3b82f6;
        }
        #ad-chat-send, #ad-chat-img-btn {
            background: #2563eb;
            color: #fff;
            border: none;
            width: 38px;
            height: 38px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        #ad-chat-img-btn {
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid rgba(16, 185, 129, 0.4);
        }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
        <div id="ad-chat-bubble" title="دعم الناشرين المباشر">
            💬
            <span id="ad-chat-unread-badge">1</span>
        </div>
        <div id="ad-welcome-pill">💬 دعم الناشرين والتمويل الإعلاني</div>
        <div id="ad-chat-box">
            <div id="ad-chat-header">
                <div class="ad-header-info">
                    <span class="ad-online-dot"></span>
                    <div>
                        <span class="ad-header-title">دعم الناشرين والتمويل الإعلاني</span>
                        <span class="ad-header-sub">متصلون الآن للرد على استفساراتكم</span>
                    </div>
                </div>
                <button id="ad-chat-close" title="تصغير">&times;</button>
            </div>
            <div id="ad-chat-guide-bar">
                💡 إرشاد: اذكر رقم هاتفك المسجل لتسريع مراجعة حسابك أو طلب السحب
            </div>
            <div id="ad-chat-messages"></div>
            <div id="ad-chat-input-area">
                <label id="ad-chat-img-btn" for="ad-chat-img-input" title="إرسال صورة">📷</label>
                <input type="file" id="ad-chat-img-input" accept="image/*" style="display:none;">
                <input type="text" id="ad-chat-input" placeholder="اكتب استفسارك هنا...">
                <button id="ad-chat-send" title="إرسال">➤</button>
            </div>
        </div>
    `;
    document.body.appendChild(wrapper);

    const bubble = document.getElementById("ad-chat-bubble");
    const welcomePill = document.getElementById("ad-welcome-pill");
    const box = document.getElementById("ad-chat-box");
    const closeBtn = document.getElementById("ad-chat-close");
    const input = document.getElementById("ad-chat-input");
    const sendBtn = document.getElementById("ad-chat-send");
    const imgInput = document.getElementById("ad-chat-img-input");
    const messagesEl = document.getElementById("ad-chat-messages");
    const unreadBadge = document.getElementById("ad-chat-unread-badge");

    let renderedCount = 0;
    let isChatClosed = false;

    function playPingSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(620, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
        } catch (e) {}
    }

    function escapeHtml(str) {
        return String(str || "").replace(/[&<>"']/g, m => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        }[m]));
    }

    function appendMessageToUI(sender, text, imageBase64) {
        const div = document.createElement("div");
        div.className = `ad-msg ${sender}`;
        let html = "";
        if (text) html += `<div>${escapeHtml(text)}</div>`;
        if (imageBase64) html += `<img src="${imageBase64}" alt="صورة مرفقة">`;
        div.innerHTML = html;
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderInitialWelcomeAndChips() {
        appendMessageToUI(
            "admin",
            "مرحباً بك في بوابة الناشرين والتمويل الإعلاني (AD$) 🌐\nيسعدنا تواصلك معنا! يمكنك اختيار أحد الاستفسارات السريعة أدناه أو كتابة رسالتك مباشرة:"
        );

        const chipsWrap = document.createElement("div");
        chipsWrap.className = "ad-quick-chips";
        const quickQuestions = [
            "🔑 طريقة تفعيل حسابي الجديد",
            "💰 متى يتم تحويل أرباح السحب؟",
            "📲 لم يصلني كود التحقق (OTP)",
            "📊 استفسار عن معدل الربح eCPM"
        ];

        quickQuestions.forEach(q => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "ad-chip";
            chip.textContent = q;
            chip.onclick = () => {
                chipsWrap.remove();
                sendSupportMessage(q, "");
            };
            chipsWrap.appendChild(chip);
        });

        messagesEl.appendChild(chipsWrap);
    }

    function lockChatBox(noticeText) {
        if (isChatClosed) return;
        isChatClosed = true;
        input.disabled = true;
        input.placeholder = "تم إغلاق هذه المحادثة";
        sendBtn.disabled = true;
        imgInput.disabled = true;

        const notice = document.createElement("div");
        notice.className = "ad-chat-closed-notice";
        notice.textContent = noticeText || "🔒 تم إغلاق المحادثة بواسطة فريق الدعم. أعد تحميل الصفحة لبدء محادثة جديدة.";
        messagesEl.appendChild(notice);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        const nextId = "pub_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
        localStorage.setItem(STORAGE_ID_KEY, nextId);
    }

    function toggleChatWindow() {
        const isOpen = box.style.display === "flex";
        box.style.display = isOpen ? "none" : "flex";
        if (!isOpen) {
            unreadBadge.style.display = "none";
            if (welcomePill) welcomePill.style.display = "none";
            messagesEl.scrollTop = messagesEl.scrollHeight;
            input.focus();
        }
    }

    bubble.onclick = toggleChatWindow;
    welcomePill.onclick = toggleChatWindow;
    closeBtn.onclick = () => { box.style.display = "none"; };

    setTimeout(() => {
        if (box.style.display !== "flex") {
            welcomePill.style.opacity = "1";
            welcomePill.style.transform = "translateX(0) scale(1)";
        }
    }, 1000);

    setTimeout(() => {
        welcomePill.style.opacity = "0";
        setTimeout(() => { if (welcomePill) welcomePill.remove(); }, 500);
    }, 45000);

    // جلب الرسائل الجديدة من السيرفر كل 3 ثوانٍ
    async function pollChatMessages() {
        try {
            const res = await fetch(`${API_BASE}/api/support/messages/${clientId}`);
            const data = await res.json();
            if (!data.success) return;

            if (data.isClosed) {
                lockChatBox(data.closeReason);
                return;
            }

            const serverMsgs = data.messages || [];
            if (serverMsgs.length > renderedCount) {
                const newItems = serverMsgs.slice(renderedCount);
                let hasAdminReply = false;

                newItems.forEach(m => {
                    appendMessageToUI(m.sender, m.text, m.image);
                    if (m.sender === "admin") hasAdminReply = true;
                });

                renderedCount = serverMsgs.length;

                if (hasAdminReply) {
                    playPingSound();
                    if (box.style.display !== "flex") {
                        unreadBadge.style.display = "flex";
                    }
                }
            }
        } catch (e) {}
    }

    async function sendSupportMessage(text, imageBase64) {
        if (isChatClosed) return;
        const cleanText = (text || "").trim();
        if (!cleanText && !imageBase64) return;

        const loggedName = document.getElementById("loggedUserName")?.textContent || "";
        const loggedPhone = document.getElementById("loggedUserPhone")?.textContent || document.getElementById("loginPhone")?.value || "";

        try {
            const res = await fetch(`${API_BASE}/api/support/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientId,
                    text: cleanText,
                    imageBase64: imageBase64 || "",
                    publisherHint: loggedName && loggedName !== "--" ? `${loggedName} ${loggedPhone}` : loggedPhone
                })
            });
            const data = await res.json();
            if (data.closed) {
                lockChatBox(data.message);
            } else if (data.success) {
                pollChatMessages();
            }
        } catch (e) {}
    }

    sendBtn.onclick = () => {
        const val = input.value.trim();
        if (!val) return;
        input.value = "";
        sendSupportMessage(val, "");
    };

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendBtn.click();
    });

    imgInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const maxW = 850;
                const scale = img.width > maxW ? maxW / img.width : 1;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                const compressed = canvas.toDataURL("image/jpeg", 0.75);
                sendSupportMessage("", compressed);
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
        imgInput.value = "";
    });

    renderInitialWelcomeAndChips();
    pollChatMessages();
    setInterval(pollChatMessages, 3000);
})();
