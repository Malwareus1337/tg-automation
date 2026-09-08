// API Base URL
const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, 'ws');

// State Management
let accounts = [];
let taskInterval = null;
let ws = null;

// DOM Elements
const sidebarItems = document.querySelectorAll('.menu-item');
const tabContents = document.querySelectorAll('.tab-content');
const consoleLogs = document.getElementById('console-logs-output');
const btnClearConsole = document.getElementById('btn-clear-console');

// Sidebar task status
const taskStatusDot = document.getElementById('task-status-dot');
const taskStatusText = document.getElementById('task-status-text');

// Init
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initConsole();
    initWS();
    
    // Initial data load
    loadStats();
    loadAccounts();
    loadSettings();
    loadScrapedMembers();
    
    // Polling task status
    pollTaskStatus();
    taskInterval = setInterval(pollTaskStatus, 3000);
    
    // Bind Event Listeners
    bindEvents();
});

// Toast Notification Helper
function showToast(message, type = 'info') {
    const container = document.getElementById('ui-toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-circle-xmark';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 50);
    
    // Remove after 3.5s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Navigation Handler
function initNavigation() {
    sidebarItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = item.dataset.tab;
            
            sidebarItems.forEach(s => s.classList.remove('active'));
            tabContents.forEach(t => t.classList.remove('active'));
            
            item.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');
        });
    });
}

// WS Connection for Logs
function initWS() {
    if (ws) {
        try { ws.close(); } catch(e) {}
    }
    
    ws = new WebSocket(`${WS_BASE}/ws/logs`);
    
    ws.onmessage = (event) => {
        appendLog(event.data);
    };
    
    ws.onclose = () => {
        // Attempt reconnect after 5 seconds
        setTimeout(initWS, 5000);
    };
    
    ws.onerror = (err) => {
        console.error("WS connection error:", err);
    };
}

// Console Functions
function initConsole() {
    btnClearConsole.addEventListener('click', () => {
        consoleLogs.innerHTML = `<div class="log-line text-muted">[Sistem] Konsol temizlendi.</div>`;
    });
}

function appendLog(message) {
    const line = document.createElement('div');
    line.className = 'log-line';
    
    if (message.includes('Hata') || message.includes('başarısız') || message.includes('failed')) {
        line.classList.add('text-red');
    } else if (message.includes('Başarılı') || message.includes('success') || message.includes('tamamlandı')) {
        line.classList.add('text-green');
    } else if (message.includes('bekleniyor') || message.includes('beklemeye')) {
        line.classList.add('text-yellow');
    }
    
    line.textContent = message;
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Load Settings
async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const settings = await res.json();
        
        if (settings.min_delay) {
            document.getElementById('setting-min-delay').value = settings.min_delay;
            document.getElementById('add-min-delay').value = settings.min_delay;
            document.getElementById('msg-min-delay').value = settings.min_delay;
        }
        if (settings.max_delay) {
            document.getElementById('setting-max-delay').value = settings.max_delay;
            document.getElementById('add-max-delay').value = settings.max_delay;
            document.getElementById('msg-max-delay').value = settings.max_delay;
        }
        if (settings.daily_limit_per_account) {
            document.getElementById('setting-daily-limit').value = settings.daily_limit_per_account;
            document.getElementById('add-daily-limit').value = settings.daily_limit_per_account;
            document.getElementById('msg-daily-limit').value = settings.daily_limit_per_account;
        }
    } catch (e) {
        console.error("Settings could not be loaded:", e);
    }
}

// Load Statistics
async function loadStats() {
    try {
        const accountsRes = await fetch(`${API_BASE}/api/accounts`);
        const accountsList = await accountsRes.json();
        const activeCount = accountsList.filter(a => a.status === 'active').length;
        document.getElementById('stat-active-accounts').textContent = activeCount;
        
        const membersRes = await fetch(`${API_BASE}/api/scraped-members`);
        const membersList = await membersRes.json();
        document.getElementById('stat-scraped-members').textContent = membersList.length;
        
        // Members count for scraper tab
        document.getElementById('db-total-members').textContent = membersList.length;
        document.getElementById('db-pending-members').textContent = membersList.filter(m => m.status === 'pending').length;
    } catch(e) {
        console.error("Stats could not be loaded:", e);
    }
}

// Load Accounts List
async function loadAccounts() {
    try {
        const res = await fetch(`${API_BASE}/api/accounts`);
        accounts = await res.json();
        cachedAccounts = accounts;
        updateMessengerAccountSelects();
        
        const tbody = document.getElementById('accounts-list-body');
        const scrapeSelect = document.getElementById('scrape-account');
        const adderCheckboxes = document.getElementById('adder-accounts-checkboxes');
        const msgCheckboxes = document.getElementById('msg-accounts-checkboxes');
        const autopostContainer = document.getElementById('autopost-accounts-container');
        
        tbody.innerHTML = '';
        scrapeSelect.innerHTML = '';
        adderCheckboxes.innerHTML = '';
        msgCheckboxes.innerHTML = '';
        if (autopostContainer) autopostContainer.innerHTML = '';
        
        if (accounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Eklenmiş hesap bulunmuyor.</td></tr>`;
            adderCheckboxes.innerHTML = `<p class="text-muted">Lütfen önce hesap ekleyin.</p>`;
            msgCheckboxes.innerHTML = `<p class="text-muted">Lütfen önce hesap ekleyin.</p>`;
            if (autopostContainer) autopostContainer.innerHTML = `<p class="text-muted">Lütfen önce hesap ekleyin.</p>`;
            return;
        }
        
        accounts.forEach(acc => {
            // Table row
            const tr = document.createElement('tr');
            let statusBadge = '';
            if (acc.status === 'active') statusBadge = `<span class="text-green"><i class="fa-solid fa-circle-check"></i> Aktif</span>`;
            else if (acc.status === 'need_login') statusBadge = `<span class="text-yellow"><i class="fa-solid fa-circle-exclamation"></i> Giriş Gerekli</span>`;
            else if (acc.status === 'flood_wait') statusBadge = `<span class="text-yellow"><i class="fa-solid fa-clock"></i> Flood Beklemede</span>`;
            else statusBadge = `<span class="text-red"><i class="fa-solid fa-ban"></i> Engelli</span>`;
            
            const floodWaitMin = acc.flood_until > Date.now() / 1000 
                ? Math.ceil((acc.flood_until - Date.now() / 1000) / 60) + ' dk' 
                : '-';
                
            tr.innerHTML = `
                <td>${acc.phone}</td>
                <td>${acc.api_id}</td>
                <td>${statusBadge}</td>
                <td>${floodWaitMin}</td>
                <td>
                    <button class="btn btn-outline btn-info btn-sm" onclick="showAccountChats('${acc.phone}')" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;" title="Katıldığı Grupları ve Linkleri Listele">
                        <i class="fa-solid fa-list-check"></i> Gruplar
                    </button>
                    <button class="btn btn-outline btn-primary btn-sm" onclick="checkAccount('${acc.phone}')" style="padding: 4px 8px; font-size: 12px; margin-right: 4px;" title="Hesabı Yeniden Kontrol Et">
                        <i class="fa-solid fa-rotate"></i> Kontrol Et
                    </button>
                    <button class="btn btn-outline btn-danger btn-sm" onclick="deleteAccount('${acc.phone}')" style="padding: 4px 8px; font-size: 12px;">
                        <i class="fa-solid fa-trash"></i> Sil
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
            
            // Scrape Dropdown
            if (acc.status === 'active') {
                const opt = document.createElement('option');
                opt.value = acc.phone;
                opt.textContent = acc.phone;
                scrapeSelect.appendChild(opt);
            }
            
            // Checkboxes for Adder & Messages
            const label = document.createElement('label');
            label.className = 'account-checkbox-item';
            label.innerHTML = `
                <input type="checkbox" name="use-accounts" value="${acc.phone}" ${acc.status === 'active' ? 'checked' : 'disabled'}>
                <span>${acc.phone} (${acc.status === 'active' ? 'Aktif' : 'Pasif'})</span>
            `;
            adderCheckboxes.appendChild(label.cloneNode(true));
            msgCheckboxes.appendChild(label);

            // Autopost Custom Card per account
            if (autopostContainer) {
                const card = document.createElement('div');
                card.className = 'autopost-account-card';
                card.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; margin-bottom: 12px;';
                card.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <label style="display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer;">
                            <input type="checkbox" class="autopost-acc-checkbox" value="${acc.phone}" ${acc.status !== 'need_login' ? 'checked' : 'disabled'}>
                            <span>📱 ${acc.phone} (${acc.status === 'active' ? 'Aktif' : acc.status})</span>
                        </label>
                        <span class="text-muted" style="font-size: 12px;">Numaraya Özel Ayarlar</span>
                    </div>
                    <div style="margin-top: 6px;">
                        <label style="font-size: 12px; color: var(--text-muted, #aaa); display: block; margin-bottom: 3px;">Özel Mesaj (Boşsa genel mesaj kullanılır):</label>
                        <textarea class="autopost-acc-msg" data-phone="${acc.phone}" rows="2" placeholder="${acc.phone} için özel mesaj içeriği..." style="width: 100%; border-radius: 6px; padding: 8px; font-size: 13px; margin-bottom: 6px; box-sizing: border-box;"></textarea>
                        
                        <label style="font-size: 12px; color: var(--text-muted, #aaa); display: block; margin-bottom: 3px;">Özel Hedef Kanallar/Gruplar (Boşsa soldaki genel hedefler kullanılır):</label>
                        <textarea class="autopost-acc-targets" data-phone="${acc.phone}" rows="2" placeholder="Her satıra bir adet @grup veya https://t.me/... linki" style="width: 100%; border-radius: 6px; padding: 8px; font-size: 13px; margin-bottom: 6px; box-sizing: border-box;"></textarea>
                        
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="font-size: 12px; color: var(--text-muted, #aaa);">Özel Görsel:</label>
                            <input type="file" class="autopost-acc-img" data-phone="${acc.phone}" accept="image/*" style="font-size: 12px;">
                        </div>
                    </div>
                `;
                autopostContainer.appendChild(card);
            }
        });
    } catch(e) {
        console.error("Accounts load error:", e);
    }
}

// Check Single Account Status
async function checkAccount(phone) {
    showToast(`${phone} durumu kontrol ediliyor...`, "info");
    try {
        const res = await fetch(`${API_BASE}/api/accounts/${phone}/check`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            if (data.status === 'active') {
                showToast(data.message || "Hesap aktif ve çalışır durumda!", "success");
            } else {
                showToast(data.message || "Hesaba giriş yapılamadı.", "warning");
            }
            loadAccounts();
            loadStats();
        } else {
            showToast(data.detail || "Kontrol sırasında hata oluştu.", "error");
        }
    } catch(e) {
        showToast("Ağ hatası oluştu.", "error");
    }
}

// Check All Accounts Status
async function checkAllAccounts() {
    showToast("Tüm hesaplar kontrol ediliyor...", "info");
    try {
        const res = await fetch(`${API_BASE}/api/accounts/check-all`, { method: 'POST' });
        if (res.ok) {
            const results = await res.json();
            const activeCount = results.filter(r => r.status === 'active').length;
            showToast(`Kontrol tamamlandı: ${activeCount}/${results.length} hesap aktif!`, "success");
            loadAccounts();
            loadStats();
        } else {
            showToast("Toplu kontrol başarısız oldu.", "error");
        }
    } catch(e) {
        showToast("Ağ hatası oluştu.", "error");
    }
}

// Delete Account
async function deleteAccount(phone) {
    if (!confirm(`${phone} numaralı hesabı kaldırmak istediğinize emin misiniz?`)) return;
    try {
        const res = await fetch(`${API_BASE}/api/accounts/${phone}`, { method: 'DELETE' });
        if (res.ok) {
            showToast("Hesap kaldırıldı.", "success");
            loadAccounts();
            loadStats();
        } else {
            showToast("Hesap silinemedi.", "error");
        }
    } catch(e) {
        showToast("Bir ağ hatası oluştu.", "error");
    }
}

// Load Scraped Members
async function loadScrapedMembers() {
    try {
        const res = await fetch(`${API_BASE}/api/scraped-members?limit=100`);
        const list = await res.json();
        const tbody = document.getElementById('scraped-members-body');
        
        tbody.innerHTML = '';
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Kayıtlı üye yok.</td></tr>`;
            return;
        }
        
        list.forEach(m => {
            const tr = document.createElement('tr');
            let statusText = '';
            if (m.status === 'pending') statusText = `<span class="text-yellow">Beklemede</span>`;
            else if (m.status === 'added') statusText = `<span class="text-green">Eklendi</span>`;
            else if (m.status.startsWith('failed')) statusText = `<span class="text-red">Engelli/Gizli</span>`;
            else statusText = `<span class="text-muted">${m.status}</span>`;
            
            tr.innerHTML = `
                <td>${m.user_id}</td>
                <td>${m.username ? '@'+m.username : '-'}</td>
                <td>${m.first_name || ''} ${m.last_name || ''}</td>
                <td>${m.last_active}</td>
                <td>${statusText}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) {
        console.error("Scraped members could not be loaded:", e);
    }
}

// Poll Active Tasks
async function pollTaskStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/tasks/status`);
        const status = await res.json();
        const tasks = status.tasks || {};
        
        if (status.running) {
            taskStatusDot.className = "status-indicator running";
            taskStatusText.textContent = "İşlem Yapılıyor...";
            document.getElementById('stat-system-status').textContent = "Çalışıyor";
            document.getElementById('stat-system-status').className = "stat-value text-yellow";
        } else {
            taskStatusDot.className = "status-indicator";
            taskStatusText.textContent = "Boşta";
            document.getElementById('stat-system-status').textContent = "Hazır";
            document.getElementById('stat-system-status').className = "stat-value text-green";
        }

        // Toggle Start/Stop buttons independently for each task
        const toggleTaskBtn = (taskKey, startBtnId, stopBtnId) => {
            const isRunning = !!tasks[taskKey];
            const startBtn = document.getElementById(startBtnId);
            const stopBtn = document.getElementById(stopBtnId);
            if (startBtn && stopBtn) {
                if (isRunning) {
                    startBtn.classList.add('hidden');
                    stopBtn.classList.remove('hidden');
                } else {
                    startBtn.classList.remove('hidden');
                    stopBtn.classList.add('hidden');
                }
            }
        };

        toggleTaskBtn('scrape', 'btn-start-scrape', 'btn-stop-scrape');
        toggleTaskBtn('add', 'btn-start-add', 'btn-stop-add');
        toggleTaskBtn('send', 'btn-start-send', 'btn-stop-send');
        toggleTaskBtn('autopost', 'btn-start-autopost', 'btn-stop-autopost');
    } catch(e) {
        console.error("Task status poll error:", e);
    }
}

// Event bindings
function bindEvents() {
    // 1. Settings Save
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        const min_delay = document.getElementById('setting-min-delay').value;
        const max_delay = document.getElementById('setting-max-delay').value;
        const limit = document.getElementById('setting-daily-limit').value;
        
        try {
            await fetch(`${API_BASE}/api/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'min_delay', value: min_delay })
            });
            await fetch(`${API_BASE}/api/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'max_delay', value: max_delay })
            });
            await fetch(`${API_BASE}/api/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'daily_limit_per_account', value: limit })
            });
            
            // Sync current inputs
            document.getElementById('add-min-delay').value = min_delay;
            document.getElementById('add-max-delay').value = max_delay;
            document.getElementById('add-daily-limit').value = limit;
            
            document.getElementById('msg-min-delay').value = min_delay;
            document.getElementById('msg-max-delay').value = max_delay;
            document.getElementById('msg-daily-limit').value = limit;
            
            showToast("Ayarlar başarıyla kaydedildi.", "success");
        } catch(e) {
            showToast("Ayarlar kaydedilirken hata oluştu.", "error");
        }
    });

    // 2. Login Step 1: Start Login
    document.getElementById('btn-start-login').addEventListener('click', async () => {
        const phone = document.getElementById('acc-phone').value.trim();
        const api_id = document.getElementById('acc-api-id').value;
        const api_hash = document.getElementById('acc-api-hash').value.trim();
        
        if (!phone || !api_id || !api_hash) {
            showToast("Tüm alanları doldurmanız gerekmektedir.", "error");
            return;
        }
        
        appendLog(`[Giriş] ${phone} için giriş kodu talep ediliyor...`);
        showToast("Doğrulama kodu talep ediliyor, bekleyin...");
        
        try {
            const res = await fetch(`${API_BASE}/api/accounts/login/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, api_id, api_hash })
            });
            
            const data = await res.json();
            if (res.ok) {
                appendLog(`[Giriş] Kod başarıyla ${phone} numaralı Telegram hesabına gönderildi.`);
                showToast("Doğrulama kodu gönderildi.", "success");
                
                // Switch steps
                document.getElementById('login-step-1').classList.add('hidden');
                document.getElementById('login-step-2').classList.remove('hidden');
            } else {
                appendLog(`[Hata] Giriş başlatılamadı: ${data.detail}`);
                showToast(`Hata: ${data.detail}`, "error");
            }
        } catch(e) {
            showToast("Bağlantı hatası.", "error");
        }
    });

    // 3. Login Step 2: Complete Login
    document.getElementById('btn-complete-login').addEventListener('click', async () => {
        const phone = document.getElementById('acc-phone').value.trim();
        const code = document.getElementById('acc-code').value.trim();
        const password = document.getElementById('acc-2fa').value.trim();
        
        if (!code) {
            showToast("Doğrulama kodunu girmelisiniz.", "error");
            return;
        }
        
        appendLog(`[Giriş] Kod onaylanıyor...`);
        
        try {
            const res = await fetch(`${API_BASE}/api/accounts/login/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, code, password: password || null })
            });
            
            const data = await res.json();
            if (res.ok) {
                if (data.status === '2fa_required') {
                    appendLog(`[Giriş] İki Aşamalı Doğrulama şifresi gerekli. Lütfen şifrenizi girin.`);
                    showToast("2FA Şifresi gerekli.", "info");
                } else {
                    appendLog(`[Giriş] Başarılı! Hesap bağlandı: ${data.username}`);
                    showToast(`Giriş Başarılı: ${data.username}`, "success");
                    
                    // Reset Form
                    document.getElementById('acc-phone').value = '';
                    document.getElementById('acc-api-id').value = '';
                    document.getElementById('acc-api-hash').value = '';
                    document.getElementById('acc-code').value = '';
                    document.getElementById('acc-2fa').value = '';
                    
                    document.getElementById('login-step-2').classList.add('hidden');
                    document.getElementById('login-step-1').classList.remove('hidden');
                    
                    loadAccounts();
                    loadStats();
                }
            } else {
                appendLog(`[Hata] Giriş başarısız: ${data.detail}`);
                showToast(`Hata: ${data.detail}`, "error");
            }
        } catch(e) {
            showToast("Bağlantı hatası.", "error");
        }
    });

    // Check All Accounts Button
    const btnCheckAll = document.getElementById('btn-check-all-accounts');
    if (btnCheckAll) {
        btnCheckAll.addEventListener('click', checkAllAccounts);
    }

    // 4. Scraper DB Management
    document.getElementById('btn-refresh-members').addEventListener('click', () => {
        loadScrapedMembers();
        loadStats();
        showToast("Veritabanı yenilendi.");
    });
    
    document.getElementById('btn-clear-members').addEventListener('click', async () => {
        if (!confirm("Tüm çekilen üyeler veritabanından silinecektir. Emin misiniz?")) return;
        try {
            const res = await fetch(`${API_BASE}/api/scraped-members/clear`, { method: 'POST' });
            if (res.ok) {
                showToast("Üyeler temizlendi.", "success");
                loadScrapedMembers();
                loadStats();
            }
        } catch(e) {
            showToast("Temizleme hatası.", "error");
        }
    });

    // 5. Tasks - Scraper Start
    document.getElementById('btn-start-scrape').addEventListener('click', async () => {
        const target = document.getElementById('scrape-target').value.trim();
        const account = document.getElementById('scrape-account').value;
        const filterVal = parseInt(document.getElementById('scrape-filter').value);
        const hidden_member_fallback = document.getElementById('scrape-hidden-fallback').checked;
        
        if (!target) {
            showToast("Lütfen hedef grubu girin.", "error");
            return;
        }
        if (!account) {
            showToast("İşlem yapacak bir aktif hesap seçin.", "error");
            return;
        }
        
        try {
            const res = await fetch(`${API_BASE}/api/tasks/scrape`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    account_phone: account,
                    group_link: target,
                    filter_days: filterVal === 9999 ? null : filterVal,
                    hidden_member_fallback
                })
            });
            
            if (res.ok) {
                showToast("Üye çekme işlemi başlatıldı.", "success");
                pollTaskStatus();
            } else {
                const data = await res.json();
                showToast(data.detail, "error");
            }
        } catch(e) {
            showToast("İşlem başlatılamadı.", "error");
        }
    });

    // 6. Tasks - Adder Start
    document.getElementById('btn-start-add').addEventListener('click', async () => {
        const target = document.getElementById('add-target').value.trim();
        const min_delay = parseInt(document.getElementById('add-min-delay').value);
        const max_delay = parseInt(document.getElementById('add-max-delay').value);
        const daily_limit = parseInt(document.getElementById('add-daily-limit').value);
        
        // Collect checked accounts
        const checkboxes = document.querySelectorAll('#adder-accounts-checkboxes input[name="use-accounts"]:checked');
        const phones = Array.from(checkboxes).map(c => c.value);
        
        if (!target) {
            showToast("Hedef grubunuzu yazmalısınız.", "error");
            return;
        }
        if (phones.length === 0) {
            showToast("Lütfen kullanılacak en az bir hesap seçin.", "error");
            return;
        }
        
        try {
            const res = await fetch(`${API_BASE}/api/tasks/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_group_link: target,
                    phones_to_use: phones,
                    min_delay,
                    max_delay,
                    daily_limit_per_acc: daily_limit
                })
            });
            
            if (res.ok) {
                showToast("Ekleme otomasyonu başlatıldı.", "success");
                pollTaskStatus();
            } else {
                const data = await res.json();
                showToast(data.detail, "error");
            }
        } catch(e) {
            showToast("İşlem başlatılamadı.", "error");
        }
    });

    // 7. Tasks - Messaging Load Targets & Start
    document.getElementById('btn-load-pending-msg').addEventListener('click', async () => {
        try {
            const res = await fetch(`${API_BASE}/api/scraped-members?status=pending`);
            const list = await res.json();
            
            if (list.length === 0) {
                showToast("Gönderilecek beklemede üye bulunamadı.", "info");
                return;
            }
            
            const targetsText = list.map(m => m.username ? `@${m.username}` : m.user_id).join('\n');
            document.getElementById('msg-targets').value = targetsText;
            showToast(`${list.length} hedef yüklendi.`, "success");
        } catch(e) {
            showToast("Hedefler yüklenemedi.", "error");
        }
    });
    
    document.getElementById('btn-start-send').addEventListener('click', async () => {
        const targetsVal = document.getElementById('msg-targets').value.trim();
        const text = document.getElementById('msg-text').value.trim();
        const min_delay = parseInt(document.getElementById('msg-min-delay').value);
        const max_delay = parseInt(document.getElementById('msg-max-delay').value);
        const daily_limit = parseInt(document.getElementById('msg-daily-limit').value);
        
        const checkboxes = document.querySelectorAll('#msg-accounts-checkboxes input[name="use-accounts"]:checked');
        const phones = Array.from(checkboxes).map(c => c.value);
        
        if (!targetsVal) {
            showToast("Lütfen mesaj hedeflerini belirtin.", "error");
            return;
        }
        if (!text) {
            showToast("Lütfen mesaj içeriğini yazın.", "error");
            return;
        }
        if (phones.length === 0) {
            showToast("Lütfen en az bir gönderici hesap seçin.", "error");
            return;
        }
        
        const targets = targetsVal.split('\n').map(t => t.trim()).filter(t => t.length > 0);
        
        try {
            const res = await fetch(`${API_BASE}/api/tasks/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targets,
                    message_text: text,
                    phones_to_use: phones,
                    min_delay,
                    max_delay,
                    daily_limit_per_acc: daily_limit
                })
            });
            
            if (res.ok) {
                showToast("Toplu mesaj gönderimi başlatıldı.", "success");
                pollTaskStatus();
            } else {
                const data = await res.json();
                showToast(data.detail, "error");
            }
        } catch(e) {
            showToast("İşlem başlatılamadı.", "error");
        }
    });

    // 8. Auto Post Start
    if (document.getElementById('btn-start-autopost')) {
        document.getElementById('autopost-all-joined').addEventListener('change', (e) => {
            const container = document.getElementById('autopost-targets-container');
            if (e.target.checked) {
                container.style.display = 'none';
            } else {
                container.style.display = 'block';
            }
        });

        document.getElementById('btn-start-autopost').addEventListener('click', async () => {
            const generalText = document.getElementById('autopost-text').value.trim();
            const minInterval = parseInt(document.getElementById('autopost-min-interval')?.value || '20');
            const maxInterval = parseInt(document.getElementById('autopost-max-interval')?.value || '40');
            const minDelay = parseInt(document.getElementById('autopost-min-delay')?.value || '10');
            const maxDelay = parseInt(document.getElementById('autopost-max-delay')?.value || '30');

            const allJoined = document.getElementById('autopost-all-joined').checked;
            const targetsVal = document.getElementById('autopost-targets').value.trim();
            const generalImageInput = document.getElementById('autopost-image');
            
            const checkboxes = document.querySelectorAll('.autopost-acc-checkbox:checked');
            const phones = Array.from(checkboxes).map(c => c.value);
            
            if (phones.length === 0) {
                showToast("Lütfen en az bir aktif hesap seçin.", "error");
                return;
            }
            if (isNaN(minInterval) || minInterval < 1 || isNaN(maxInterval) || maxInterval < 1) {
                showToast("Lütfen geçerli bir dakika aralığı girin.", "error");
                return;
            }
            const targets = allJoined ? [] : targetsVal.split('\n').map(t => t.trim()).filter(t => t.length > 0);
            
            try {
                // 1. Collect per-account messages, targets and upload per-account images
                const account_messages = {};
                const account_images = {};
                const account_targets = {};

                for (const phone of phones) {
                    const msgEl = document.querySelector(`.autopost-acc-msg[data-phone="${phone}"]`);
                    if (msgEl && msgEl.value.trim()) {
                        account_messages[phone] = msgEl.value.trim();
                    }
                    
                    const targetsEl = document.querySelector(`.autopost-acc-targets[data-phone="${phone}"]`);
                    if (targetsEl && targetsEl.value.trim()) {
                        account_targets[phone] = targetsEl.value.trim().split('\n').map(t => t.trim()).filter(t => t.length > 0);
                    }
                    
                    const imgEl = document.querySelector(`.autopost-acc-img[data-phone="${phone}"]`);
                    if (imgEl && imgEl.files.length > 0) {
                        showToast(`${phone} için özel görsel yükleniyor...`, "info");
                        const formData = new FormData();
                        formData.append("file", imgEl.files[0]);
                        const uploadRes = await fetch(`${API_BASE}/api/upload`, {
                            method: 'POST',
                            body: formData
                        });
                        if (uploadRes.ok) {
                            const uploadData = await uploadRes.json();
                            account_images[phone] = uploadData.file_path;
                        }
                    }
                }

                // Validate targets: general targets OR per-account targets OR allJoined
                if (!allJoined && targets.length === 0 && Object.keys(account_targets).length === 0) {
                    showToast("Lütfen hedef grupları girin, hesaplara özel hedef liste tanımlayın veya 'Sadece Katıldığım Gruplara Gönder' seçeneğini seçin.", "error");
                    return;
                }

                // 2. Upload general image if provided
                let general_image_path = null;
                if (generalImageInput && generalImageInput.files.length > 0) {
                    showToast("Genel görsel yükleniyor...", "info");
                    const formData = new FormData();
                    formData.append("file", generalImageInput.files[0]);
                    const uploadRes = await fetch(`${API_BASE}/api/upload`, {
                        method: 'POST',
                        body: formData
                    });
                    if (uploadRes.ok) {
                        const uploadData = await uploadRes.json();
                        general_image_path = uploadData.file_path;
                    }
                }

                // Validate that at least general message/image or specific messages exist
                if (!generalText && !general_image_path && Object.keys(account_messages).length === 0 && Object.keys(account_images).length === 0) {
                    showToast("Lütfen genel bir mesaj yazın veya hesaplara özel mesaj tanımlayın.", "error");
                    return;
                }

                const res = await fetch(`${API_BASE}/api/tasks/autopost`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phones_to_use: phones,
                        targets,
                        message_text: generalText,
                        interval_minutes: minInterval,
                        min_interval_minutes: minInterval,
                        max_interval_minutes: maxInterval,
                        min_delay: minDelay,
                        max_delay: maxDelay,
                        send_to_all_joined: allJoined,
                        image_path: general_image_path,
                        account_messages: account_messages,
                        account_images: account_images,
                        account_targets: account_targets
                    })
                });
                
                if (res.ok) {
                    showToast("Otomatik paylaşım görevi başlatıldı.", "success");
                    pollTaskStatus();
                } else {
                    const data = await res.json();
                    showToast(data.detail, "error");
                }
            } catch(e) {
                showToast("İşlem başlatılamadı.", "error");
            }
        });
    }

    // 9. Stops - Independent Task cancellation binding
    const stopButtonMap = {
        'btn-stop-scrape': 'scrape',
        'btn-stop-add': 'add',
        'btn-stop-send': 'send',
        'btn-stop-autopost': 'autopost'
    };

    Object.entries(stopButtonMap).forEach(([btnId, taskType]) => {
        const el = document.getElementById(btnId);
        if (el) {
            el.addEventListener('click', async () => {
                try {
                    const res = await fetch(`${API_BASE}/api/tasks/stop?task_type=${taskType}`, { method: 'POST' });
                    if (res.ok) {
                        showToast(`İptal talebi gönderildi (${taskType})...`);
                        pollTaskStatus();
                    }
                } catch(e) {
                    showToast("Durdurma işlemi başarısız.", "error");
                }
            });
        }
    });
    // 10. Messenger Handlers
    const messengerSelect = document.getElementById('messenger-account-select');
    if (messengerSelect) {
        messengerSelect.addEventListener('change', (e) => {
            const phone = e.target.value;
            if (phone) {
                loadMessengerDialogs(phone);
            }
        });
    }

    const btnRefreshDialogs = document.getElementById('btn-refresh-dialogs');
    if (btnRefreshDialogs) {
        btnRefreshDialogs.addEventListener('click', () => {
            if (activeMessengerPhone) {
                loadMessengerDialogs(activeMessengerPhone);
                showToast("Sohbetler yenileniyor...", "info");
            } else {
                showToast("Lütfen önce bir hesap seçin.", "warning");
            }
        });
    }

    const searchInput = document.getElementById('messenger-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            if (!q) {
                renderDialogs(currentDialogs);
            } else {
                const filtered = currentDialogs.filter(d => 
                    d.name.toLowerCase().includes(q) || 
                    (d.username && d.username.toLowerCase().includes(q)) ||
                    (d.last_message && d.last_message.toLowerCase().includes(q))
                );
                renderDialogs(filtered);
            }
        });
    }

    const msgInput = document.getElementById('messenger-message-input');
    const sendBtn = document.getElementById('btn-send-chat-msg');
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessengerMessage);
    }
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessengerMessage();
            }
        });
    }

    // View Toggles (Telegram Web iFrames vs Single vs Split)
    const btnTgWeb = document.getElementById('btn-view-tgweb');
    const btnSingle = document.getElementById('btn-view-single');
    const btnSplit = document.getElementById('btn-view-split');
    const tgwebContainer = document.getElementById('messenger-tgweb-container');
    const singleContainer = document.getElementById('messenger-single-container');
    const splitContainer = document.getElementById('messenger-split-container');

    function setActiveView(view) {
        [btnTgWeb, btnSingle, btnSplit].forEach(b => b?.classList.remove('active'));
        if (tgwebContainer) tgwebContainer.style.display = 'none';
        if (singleContainer) singleContainer.style.display = 'none';
        if (splitContainer) splitContainer.style.display = 'none';

        if (view === 'tgweb') {
            btnTgWeb?.classList.add('active');
            if (tgwebContainer) tgwebContainer.style.display = 'block';
            if (document.querySelectorAll('.tgweb-card').length === 0) {
                setupTgWebFrames();
            }
        } else if (view === 'single') {
            btnSingle?.classList.add('active');
            if (singleContainer) singleContainer.style.display = 'block';
        } else if (view === 'split') {
            btnSplit?.classList.add('active');
            if (splitContainer) splitContainer.style.display = 'block';
            if (splitWindows.length === 0) {
                setupSplitView();
            }
        }
    }

    if (btnTgWeb) btnTgWeb.addEventListener('click', () => setActiveView('tgweb'));
    if (btnSingle) btnSingle.addEventListener('click', () => setActiveView('single'));
    if (btnSplit) btnSplit.addEventListener('click', () => setActiveView('split'));

    const btnAddTgWebFrame = document.getElementById('btn-add-tgweb-frame');
    if (btnAddTgWebFrame) {
        btnAddTgWebFrame.addEventListener('click', () => {
            addTgWebFrame();
        });
    }

    document.querySelectorAll('.tgweb-col-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tgweb-col-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const cols = btn.dataset.cols;
            const grid = document.getElementById('tgweb-frames-grid');
            if (grid) {
                grid.classList.remove('cols-2', 'cols-3', 'cols-4');
                grid.classList.add(`cols-${cols}`);
            }
        });
    });

    // Auto-init Telegram Web frames on start
    setupTgWebFrames();

    const btnAddSplitCol = document.getElementById('btn-add-split-col');
    if (btnAddSplitCol) {
        btnAddSplitCol.addEventListener('click', () => {
            addSplitWindow();
        });
    }

    const btnRefreshAllSplits = document.getElementById('btn-refresh-all-splits');
    if (btnRefreshAllSplits) {
        btnRefreshAllSplits.addEventListener('click', () => {
            splitWindows.forEach(w => {
                if (w.phone) loadSplitDialogs(w);
            });
            showToast("Tüm açık pencereler yenilendi.", "info");
        });
    }

    // Modal Events for Account Chats & Links
    const modalCloseBtn = document.getElementById('btn-close-chats-modal');
    const modalCloseAction = document.getElementById('btn-modal-close-action');
    const copyAllLinksBtn = document.getElementById('btn-copy-all-links');
    const modalOverlay = document.getElementById('modal-account-chats');
    const btnShowAllChats = document.getElementById('btn-show-all-chats');

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', () => modalOverlay.classList.remove('active'));
    if (modalCloseAction) modalCloseAction.addEventListener('click', () => modalOverlay.classList.remove('active'));
    if (modalOverlay) {
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) modalOverlay.classList.remove('active');
        });
    }

    if (btnShowAllChats) {
        btnShowAllChats.addEventListener('click', () => {
            showAccountChats();
        });
    }

    if (copyAllLinksBtn) {
        copyAllLinksBtn.addEventListener('click', () => {
            if (currentModalLinks.length > 0) {
                const uniqueLinks = [...new Set(currentModalLinks)];
                navigator.clipboard.writeText(uniqueLinks.join('\n'));
                showToast(`${uniqueLinks.length} adet link panoya kopyalandı!`, "success");
            } else {
                showToast("Kopyalanacak link bulunamadı.", "warning");
            }
        });
    }
}

// ==========================================
// Messenger Logic (Telegram Web In-Panel)
// ==========================================

let activeMessengerPhone = null;
let activeMessengerChatId = null;
let activeMessengerChatName = '';
let currentDialogs = [];

function updateMessengerAccountSelects() {
    const sel = document.getElementById('messenger-account-select');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Hesap Seçiniz...</option>';
    
    cachedAccounts.forEach(acc => {
        if (acc.status === 'active') {
            const opt = document.createElement('option');
            opt.value = acc.phone;
            opt.textContent = `📱 ${acc.phone}`;
            sel.appendChild(opt);
        }
    });
    
    if (currentVal && cachedAccounts.some(a => a.phone === currentVal && a.status === 'active')) {
        sel.value = currentVal;
    } else if (cachedAccounts.some(a => a.status === 'active')) {
        const firstActive = cachedAccounts.find(a => a.status === 'active');
        sel.value = firstActive.phone;
        activeMessengerPhone = firstActive.phone;
        loadMessengerDialogs(firstActive.phone);
    }
}

async function loadMessengerDialogs(phone) {
    if (!phone) return;
    activeMessengerPhone = phone;
    const listEl = document.getElementById('messenger-dialogs-list');
    if (!listEl) return;
    
    listEl.innerHTML = `
        <div class="messenger-empty-state">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 28px; margin-bottom: 8px;"></i>
            <p>Sohbetler ve kanallar yükleniyor...</p>
        </div>
    `;
    
    try {
        const res = await fetch(`${API_BASE}/api/messenger/dialogs?phone=${encodeURIComponent(phone)}&limit=50`);
        if (!res.ok) {
            const err = await res.json();
            listEl.innerHTML = `<div class="messenger-empty-state text-danger"><i class="fa-solid fa-triangle-exclamation"></i><p>${err.detail || 'Sohbetler alınamadı.'}</p></div>`;
            return;
        }
        
        currentDialogs = await res.json();
        renderDialogs(currentDialogs);
    } catch(e) {
        listEl.innerHTML = `<div class="messenger-empty-state text-danger"><i class="fa-solid fa-wifi"></i><p>Bağlantı hatası.</p></div>`;
    }
}

function renderDialogs(dialogs) {
    const listEl = document.getElementById('messenger-dialogs-list');
    if (!listEl) return;
    
    if (dialogs.length === 0) {
        listEl.innerHTML = `<div class="messenger-empty-state"><i class="fa-regular fa-folder-open"></i><p>Sohbet bulunamadı.</p></div>`;
        return;
    }
    
    listEl.innerHTML = '';
    dialogs.forEach(d => {
        const item = document.createElement('div');
        item.className = `messenger-dialog-item ${activeMessengerChatId == d.id ? 'active' : ''}`;
        item.dataset.chatId = d.id;
        
        let avatarIcon = '<i class="fa-solid fa-user"></i>';
        if (d.type === 'channel') avatarIcon = '<i class="fa-solid fa-bullhorn"></i>';
        else if (d.type === 'group') avatarIcon = '<i class="fa-solid fa-users"></i>';
        
        const unreadBadge = d.unread_count > 0 ? `<div class="dialog-unread">${d.unread_count}</div>` : '';
        
        item.innerHTML = `
            <div class="dialog-avatar">${avatarIcon}</div>
            <div class="dialog-body">
                <div class="dialog-top-row">
                    <div class="dialog-name" title="${d.name}">${d.name}</div>
                    <div class="dialog-date">${d.date}</div>
                </div>
                <div class="dialog-bottom-row">
                    <div class="dialog-snippet" title="${d.last_message || ''}">${d.last_message || '<i>Mesaj yok</i>'}</div>
                    ${unreadBadge}
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.messenger-dialog-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            loadMessengerMessages(activeMessengerPhone, d.id, d.name, d.type, d.username);
        });
        
        listEl.appendChild(item);
    });
}

async function loadMessengerMessages(phone, chatId, chatName, chatType, chatUsername) {
    activeMessengerChatId = chatId;
    activeMessengerChatName = chatName;
    
    const nameEl = document.getElementById('messenger-active-chat-name');
    const badgeEl = document.getElementById('messenger-active-chat-badge');
    const extraEl = document.getElementById('messenger-active-chat-extra');
    const inputEl = document.getElementById('messenger-message-input');
    const sendBtn = document.getElementById('btn-send-chat-msg');
    
    if (nameEl) nameEl.textContent = chatName;
    if (badgeEl) {
        badgeEl.style.display = 'inline-block';
        badgeEl.textContent = chatType === 'channel' ? 'Kanal' : (chatType === 'group' ? 'Grup' : 'Kişi');
    }
    if (extraEl) {
        extraEl.textContent = chatUsername ? `@${chatUsername}` : `ID: ${chatId}`;
    }
    
    if (inputEl) {
        inputEl.disabled = false;
        inputEl.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
    
    const messagesArea = document.getElementById('messenger-messages-area');
    if (!messagesArea) return;
    
    messagesArea.innerHTML = `
        <div class="messenger-empty-state">
            <i class="fa-solid fa-spinner fa-spin" style="font-size: 28px; margin-bottom: 8px;"></i>
            <p>Mesaj geçmişi alınıyor...</p>
        </div>
    `;
    
    try {
        const res = await fetch(`${API_BASE}/api/messenger/messages?phone=${encodeURIComponent(phone)}&chat_id=${encodeURIComponent(chatId)}&limit=50`);
        if (!res.ok) {
            const err = await res.json();
            messagesArea.innerHTML = `<div class="messenger-empty-state text-danger"><p>${err.detail || 'Mesajlar yüklenemedi.'}</p></div>`;
            return;
        }
        
        const messages = await res.json();
        if (messages.length === 0) {
            messagesArea.innerHTML = `<div class="messenger-empty-state"><p>Bu sohbette henüz mesaj bulunmuyor.</p></div>`;
            return;
        }
        
        messagesArea.innerHTML = '';
        messages.forEach(m => {
            const bubble = document.createElement('div');
            bubble.className = `msg-bubble ${m.out ? 'outgoing' : 'incoming'}`;
            
            const senderHtml = (!m.out && m.sender_name) ? `<div class="msg-sender">${m.sender_name}</div>` : '';
            
            bubble.innerHTML = `
                ${senderHtml}
                <div class="msg-text">${escapeHtml(m.text)}</div>
                <div class="msg-meta">${m.date}</div>
            `;
            messagesArea.appendChild(bubble);
        });
        
        messagesArea.scrollTop = messagesArea.scrollHeight;
    } catch(e) {
        messagesArea.innerHTML = `<div class="messenger-empty-state text-danger"><p>Mesajlar alınırken ağ hatası oluştu.</p></div>`;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, "<br>");
}

async function sendMessengerMessage() {
    const inputEl = document.getElementById('messenger-message-input');
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text || !activeMessengerPhone || !activeMessengerChatId) return;
    
    inputEl.value = '';
    
    const messagesArea = document.getElementById('messenger-messages-area');
    const tempBubble = document.createElement('div');
    tempBubble.className = 'msg-bubble outgoing';
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    tempBubble.innerHTML = `
        <div class="msg-text">${escapeHtml(text)}</div>
        <div class="msg-meta">${nowTime} <i class="fa-solid fa-clock"></i></div>
    `;
    if (messagesArea) {
        messagesArea.appendChild(tempBubble);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/messenger/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: activeMessengerPhone,
                chat_id: activeMessengerChatId,
                text: text
            })
        });
        
        if (res.ok) {
            tempBubble.querySelector('.msg-meta').innerHTML = `${nowTime} <i class="fa-solid fa-check text-green"></i>`;
        } else {
            const err = await res.json();
            tempBubble.querySelector('.msg-meta').innerHTML = `<span class="text-danger">Hata: ${err.detail || 'İletilemedi'}</span>`;
        }
    } catch(e) {
        tempBubble.querySelector('.msg-meta').innerHTML = `<span class="text-danger">Ağ hatası</span>`;
    }
}

// ==========================================
// Multi-Window Split Screen Manager
// ==========================================

let splitWindows = [];

function setupSplitView() {
    const grid = document.getElementById('messenger-split-grid');
    if (!grid) return;
    grid.innerHTML = '';
    splitWindows = [];
    
    const activeAccounts = cachedAccounts.filter(a => a.status === 'active');
    if (activeAccounts.length === 0) {
        grid.innerHTML = `<div class="text-muted" style="padding: 24px; text-align: center;">Aktif hesap bulunamadı. Lütfen önce hesap ekleyin veya hesap durumunu kontrol edin.</div>`;
        return;
    }
    
    // Auto-open up to 3 accounts side-by-side
    const initialAccounts = activeAccounts.slice(0, 3);
    initialAccounts.forEach(acc => {
        addSplitWindow(acc.phone);
    });
}

function addSplitWindow(phone = '') {
    const grid = document.getElementById('messenger-split-grid');
    if (!grid) return;
    
    const windowId = 'split_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const winObj = { id: windowId, phone: phone, activeChatId: null, activeChatName: '' };
    splitWindows.push(winObj);
    
    const col = document.createElement('div');
    col.className = 'split-window glass-panel';
    col.id = windowId;
    
    let selectOptions = '<option value="">Hesap Seç...</option>';
    cachedAccounts.forEach(a => {
        if (a.status === 'active') {
            const isSel = (a.phone === phone) ? 'selected' : '';
            selectOptions += `<option value="${a.phone}" ${isSel}>${a.phone}</option>`;
        }
    });
    
    col.innerHTML = `
        <div class="split-window-header">
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-mobile-screen neon-text" style="font-size: 13px;"></i>
                <select class="split-acc-select" data-id="${windowId}">
                    ${selectOptions}
                </select>
            </div>
            <button class="btn btn-outline btn-sm split-btn-close" style="padding: 2px 7px; font-size: 11px;" title="Pencereyi Kapat"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="split-window-body">
            <div class="split-dialogs" id="${windowId}_dialogs">
                <div style="padding: 10px; font-size: 11px; color: var(--text-muted); text-align: center;">Yükleniyor...</div>
            </div>
            <div class="split-chat-area">
                <div style="padding: 8px 12px; border-bottom: 1px solid var(--border-color); font-size: 12px; font-weight: 600; background: rgba(0,0,0,0.2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="${windowId}_title">
                    Sohbet seçin
                </div>
                <div class="split-messages-list" id="${windowId}_messages">
                    <div style="padding: 24px 10px; text-align: center; color: var(--text-muted); font-size: 12px;">Soldan bir sohbet seçin</div>
                </div>
                <div class="split-input-bar">
                    <input type="text" placeholder="Mesaj yazın..." id="${windowId}_input" disabled>
                    <button class="btn btn-primary btn-sm" id="${windowId}_send" style="padding: 4px 10px;" disabled><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
        </div>
    `;
    
    grid.appendChild(col);
    
    col.querySelector('.split-btn-close').addEventListener('click', () => {
        col.remove();
        splitWindows = splitWindows.filter(w => w.id !== windowId);
    });
    
    const accSelect = col.querySelector('.split-acc-select');
    accSelect.addEventListener('change', (e) => {
        winObj.phone = e.target.value;
        loadSplitDialogs(winObj);
    });
    
    const inputEl = col.querySelector(`#${windowId}_input`);
    const sendBtn = col.querySelector(`#${windowId}_send`);
    const doSend = async () => {
        const txt = inputEl.value.trim();
        if (!txt || !winObj.phone || !winObj.activeChatId) return;
        inputEl.value = '';
        
        const list = col.querySelector(`#${windowId}_messages`);
        const b = document.createElement('div');
        b.className = 'msg-bubble outgoing';
        b.style.fontSize = '12px';
        b.style.padding = '6px 10px';
        b.innerHTML = `<div>${escapeHtml(txt)}</div><div class="msg-meta" style="font-size: 9.5px;">${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`;
        list.appendChild(b);
        list.scrollTop = list.scrollHeight;
        
        try {
            await fetch(`${API_BASE}/api/messenger/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: winObj.phone, chat_id: winObj.activeChatId, text: txt })
            });
        } catch(e) {}
    };
    
    sendBtn.addEventListener('click', doSend);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSend();
    });
    
    if (phone) {
        loadSplitDialogs(winObj);
    }
}

async function loadSplitDialogs(winObj) {
    const dialogsEl = document.getElementById(`${winObj.id}_dialogs`);
    if (!dialogsEl || !winObj.phone) return;
    
    dialogsEl.innerHTML = `<div style="padding: 10px; font-size: 11px; color: var(--text-muted); text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Yükleniyor...</div>`;
    
    try {
        const res = await fetch(`${API_BASE}/api/messenger/dialogs?phone=${encodeURIComponent(winObj.phone)}&limit=30`);
        if (!res.ok) {
            dialogsEl.innerHTML = `<div style="padding: 10px; font-size: 11px; color: var(--danger); text-align: center;">Alınamadı</div>`;
            return;
        }
        const dialogs = await res.json();
        dialogsEl.innerHTML = '';
        
        if (dialogs.length === 0) {
            dialogsEl.innerHTML = `<div style="padding: 10px; font-size: 11px; color: var(--text-muted); text-align: center;">Sohbet yok</div>`;
            return;
        }
        
        dialogs.forEach(d => {
            const item = document.createElement('div');
            item.className = 'split-dialog-item';
            item.innerHTML = `<div title="${d.name}" style="overflow: hidden; text-overflow: ellipsis;">${d.name}</div>`;
            item.addEventListener('click', () => {
                dialogsEl.querySelectorAll('.split-dialog-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                winObj.activeChatId = d.id;
                winObj.activeChatName = d.name;
                loadSplitMessages(winObj, d.name);
            });
            dialogsEl.appendChild(item);
        });
    } catch(e) {
        dialogsEl.innerHTML = `<div style="padding: 10px; font-size: 11px; color: var(--danger); text-align: center;">Ağ hatası</div>`;
    }
}

async function loadSplitMessages(winObj, chatName) {
    const titleEl = document.getElementById(`${winObj.id}_title`);
    const listEl = document.getElementById(`${winObj.id}_messages`);
    const inputEl = document.getElementById(`${winObj.id}_input`);
    const sendBtn = document.getElementById(`${winObj.id}_send`);
    
    if (titleEl) titleEl.textContent = chatName;
    if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
    if (sendBtn) sendBtn.disabled = false;
    
    if (listEl) {
        listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px;"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/messenger/messages?phone=${encodeURIComponent(winObj.phone)}&chat_id=${encodeURIComponent(winObj.activeChatId)}&limit=30`);
        if (!res.ok) {
            if (listEl) listEl.innerHTML = `<div style="padding: 10px; color: var(--danger); font-size: 12px;">Hata</div>`;
            return;
        }
        const messages = await res.json();
        if (listEl) {
            listEl.innerHTML = '';
            if (messages.length === 0) {
                listEl.innerHTML = `<div style="padding: 15px; color: var(--text-muted); font-size: 11.5px; text-align: center;">Mesaj yok</div>`;
                return;
            }
            messages.forEach(m => {
                const bubble = document.createElement('div');
                bubble.className = `msg-bubble ${m.out ? 'outgoing' : 'incoming'}`;
                bubble.style.fontSize = '12px';
                bubble.style.padding = '6px 10px';
                bubble.innerHTML = `
                    ${!m.out && m.sender_name ? `<div class="msg-sender" style="font-size: 10.5px;">${m.sender_name}</div>` : ''}
                    <div class="msg-text">${escapeHtml(m.text)}</div>
                    <div class="msg-meta" style="font-size: 9.5px;">${m.date}</div>
                `;
                listEl.appendChild(bubble);
            });
            listEl.scrollTop = listEl.scrollHeight;
        }
    } catch(e) {
        if (listEl) listEl.innerHTML = `<div style="padding: 10px; color: var(--danger); font-size: 12px;">Bağlantı hatası</div>`;
    }
}

// ==========================================
// Isolated Telegram Web iFrame Manager
// ==========================================

let nextTgWebIndex = 1;

function setupTgWebFrames() {
    const grid = document.getElementById('tgweb-frames-grid');
    if (!grid || grid.children.length > 0) return;

    // Open initial 3 isolated Telegram Web frames
    addTgWebFrame();
    addTgWebFrame();
    addTgWebFrame();
}

function addTgWebFrame() {
    const grid = document.getElementById('tgweb-frames-grid');
    if (!grid) return;

    const frameNum = nextTgWebIndex++;
    const cardId = `tgweb_card_${frameNum}`;
    const frameOrigin = `http://acc${frameNum}.localhost:8000`;
    let currentVersion = 'k';

    // Auto-assign account or load from localStorage
    const activeAccs = cachedAccounts.filter(a => a.status === 'active');
    let savedPhone = localStorage.getItem(`tgweb_acc_${frameNum}`) || (activeAccs[frameNum - 1]?.phone || '');

    const card = document.createElement('div');
    card.className = 'tgweb-card glass-panel';
    card.id = cardId;

    // Build account options
    let accOptions = '<option value="">-- Hesap Seç / Etiketle --</option>';
    cachedAccounts.forEach(a => {
        const isSel = (a.phone === savedPhone) ? 'selected' : '';
        accOptions += `<option value="${a.phone}" ${isSel}>${a.phone} (${a.status})</option>`;
    });

    card.innerHTML = `
        <div class="tgweb-card-header">
            <div class="tgweb-card-title">
                <span class="badge badge-primary"><i class="fa-brands fa-telegram"></i> Pencere #${frameNum}</span>
                <span class="tgweb-user-badge" id="${cardId}_badge">
                    <i class="fa-solid fa-user-check"></i> <span id="${cardId}_phone_text">${savedPhone || 'Hesap Seçilmedi'}</span>
                </span>
                <select class="tgweb-acc-select" id="${cardId}_acc_select" title="Bu pencereye ait hesabı etiketle">
                    ${accOptions}
                </select>
            </div>
            <div class="tgweb-card-actions">
                <button class="tgweb-btn-chats" id="${cardId}_btn_chats" title="Bu Hesabın Katıldığı Grupları ve Linklerini Listele">
                    <i class="fa-solid fa-list-check"></i> Gruplar
                </button>
                <select class="tgweb-version-select" title="Telegram Web Sürümü">
                    <option value="k" selected>Web K (Klasik)</option>
                    <option value="a">Web A (Yeni)</option>
                </select>
                <button class="tgweb-btn-reload" title="Pencereyi Yenile"><i class="fa-solid fa-rotate"></i></button>
                <button class="tgweb-btn-popup" title="Ayrı Pencerede Aç (Popup)"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
                <button class="tgweb-btn-close" title="Pencereyi Kapat"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <iframe src="${frameOrigin}/${currentVersion}/" allow="camera; microphone; clipboard-read; clipboard-write;" class="tgweb-iframe" id="${cardId}_iframe"></iframe>
    `;

    grid.appendChild(card);

    const iframeEl = card.querySelector(`#${cardId}_iframe`);
    const versionSelect = card.querySelector('.tgweb-version-select');
    const reloadBtn = card.querySelector('.tgweb-btn-reload');
    const popupBtn = card.querySelector('.tgweb-btn-popup');
    const closeBtn = card.querySelector('.tgweb-btn-close');
    const accSelect = card.querySelector(`#${cardId}_acc_select`);
    const phoneText = card.querySelector(`#${cardId}_phone_text`);
    const chatsBtn = card.querySelector(`#${cardId}_btn_chats`);

    // Account change listener
    accSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        savedPhone = val;
        localStorage.setItem(`tgweb_acc_${frameNum}`, val);
        if (phoneText) phoneText.textContent = val || 'Hesap Seçilmedi';
    });

    // View groups button
    chatsBtn.addEventListener('click', () => {
        if (savedPhone) {
            showAccountChats(savedPhone);
        } else {
            showAccountChats();
        }
    });

    // Switch version
    versionSelect.addEventListener('change', (e) => {
        currentVersion = e.target.value;
        iframeEl.src = `${frameOrigin}/${currentVersion}/`;
    });

    // Reload
    reloadBtn.addEventListener('click', () => {
        iframeEl.src = iframeEl.src;
    });

    // Popup in standalone window
    popupBtn.addEventListener('click', () => {
        window.open(`${frameOrigin}/${currentVersion}/`, `tgweb_${frameNum}`, 'width=1000,height=850');
    });

    // Close
    closeBtn.addEventListener('click', () => {
        card.remove();
        localStorage.removeItem(`tgweb_acc_${frameNum}`);
    });
}

// ==========================================
// Account Chats & Links Modal Viewer
// ==========================================

let currentModalLinks = [];

async function showAccountChats(phone = null) {
    const modal = document.getElementById('modal-account-chats');
    const modalTitle = document.getElementById('modal-chats-title');
    const modalBody = document.getElementById('modal-chats-body');
    const modalCount = document.getElementById('modal-chats-count');
    if (!modal || !modalBody) return;

    modal.classList.add('active');
    currentModalLinks = [];

    if (phone) {
        modalTitle.textContent = `${phone} - Katılınan Gruplar & Linkler`;
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 12px;"></i>
                <p>${phone} numarasına ait gruplar canlı olarak taranıyor...</p>
            </div>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(phone)}/chats`);
            if (!res.ok) {
                const err = await res.json();
                modalBody.innerHTML = `<div class="text-danger p-4">Gruplar alınamadı: ${err.detail || 'Hata'}</div>`;
                return;
            }
            const data = await res.json();
            const chats = data.chats || [];
            modalCount.textContent = `${chats.length} Grup / Kanal Bulundu`;

            if (chats.length === 0) {
                modalBody.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">Bu hesap henüz herhangi bir gruba veya kanala katılmamış.</div>`;
                return;
            }

            let html = `
                <table class="chats-list-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">#</th>
                            <th>Grup / Kanal Adı</th>
                            <th style="width: 90px;">Tür</th>
                            <th>Bağlantı Linki</th>
                            <th style="width: 80px; text-align: center;">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            chats.forEach((c, idx) => {
                if (c.link) currentModalLinks.push(c.link);
                const linkHtml = c.link 
                    ? `<a href="${c.link}" target="_blank" class="chat-link-btn"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${c.link}</a>`
                    : `<span class="text-muted"><i class="fa-solid fa-lock"></i> Özel Grup (Link yok)</span>`;

                html += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td><strong>${c.title}</strong></td>
                        <td><span class="badge ${c.type === 'Kanal' ? 'badge-primary' : 'badge-secondary'}">${c.type}</span></td>
                        <td>${linkHtml}</td>
                        <td style="text-align: center;">
                            ${c.link ? `<button class="btn btn-outline btn-sm" onclick="copyTextToClipboard('${c.link}')" title="Linki Kopyala" style="padding: 2px 7px; font-size: 11px;"><i class="fa-solid fa-copy"></i></button>` : '-'}
                        </td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;
            modalBody.innerHTML = html;
        } catch(e) {
            modalBody.innerHTML = `<div class="text-danger p-4">Ağ hatası oluştu.</div>`;
        }
    } else {
        modalTitle.textContent = `Tüm Numaraların Katıldığı Gruplar & Linkler`;
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; margin-bottom: 12px;"></i>
                <p>Tüm aktif hesapların grupları taranıyor...</p>
            </div>
        `;

        try {
            const res = await fetch(`${API_BASE}/api/accounts-chats/all`);
            const allData = await res.json();
            let totalChats = 0;
            let html = '';

            allData.forEach(item => {
                const chats = item.chats || [];
                totalChats += chats.length;

                html += `
                    <div style="margin-bottom: 24px; background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h4 style="color: var(--primary);"><i class="fa-solid fa-mobile-screen"></i> ${item.phone} <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">(${chats.length} Grup/Kanal)</span></h4>
                            <button class="btn btn-outline btn-sm" onclick="copyAccountLinks('${item.phone}')" style="padding: 3px 8px; font-size: 11.5px;"><i class="fa-solid fa-copy"></i> Bu Numaranın Linklerini Kopyala</button>
                        </div>
                `;

                if (chats.length === 0) {
                    html += `<p class="text-muted" style="font-size: 12.5px;">Bu hesapta grup bulunamadı veya hesap pasif.</p>`;
                } else {
                    html += `
                        <table class="chats-list-table">
                            <thead>
                                <tr>
                                    <th style="width: 35px;">#</th>
                                    <th>Grup / Kanal</th>
                                    <th style="width: 80px;">Tür</th>
                                    <th>Link</th>
                                    <th style="width: 50px;"></th>
                                </tr>
                            </thead>
                            <tbody>
                    `;
                    chats.forEach((c, idx) => {
                        if (c.link) currentModalLinks.push(c.link);
                        html += `
                            <tr>
                                <td>${idx + 1}</td>
                                <td><strong>${c.title}</strong></td>
                                <td><span class="badge ${c.type === 'Kanal' ? 'badge-primary' : 'badge-secondary'}">${c.type}</span></td>
                                <td>${c.link ? `<a href="${c.link}" target="_blank" class="chat-link-btn">${c.link}</a>` : '<span class="text-muted">Özel Grup</span>'}</td>
                                <td>${c.link ? `<button class="btn btn-outline btn-sm" onclick="copyTextToClipboard('${c.link}')" style="padding: 2px 6px; font-size: 11px;"><i class="fa-solid fa-copy"></i></button>` : ''}</td>
                            </tr>
                        `;
                    });
                    html += `</tbody></table>`;
                }

                html += `</div>`;
            });

            modalCount.textContent = `Toplam ${totalChats} Grup / Kanal`;
            modalBody.innerHTML = html;
        } catch(e) {
            modalBody.innerHTML = `<div class="text-danger p-4">Gruplar alınırken hata oluştu.</div>`;
        }
    }
}

function copyTextToClipboard(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("Link kopyalandı!", "success");
    }).catch(() => {
        showToast("Kopyalanamadı.", "error");
    });
}

function copyAccountLinks(phone) {
    fetch(`${API_BASE}/api/accounts/${encodeURIComponent(phone)}/chats`)
        .then(r => r.json())
        .then(data => {
            const links = (data.chats || []).map(c => c.link).filter(Boolean);
            if (links.length > 0) {
                navigator.clipboard.writeText(links.join('\n'));
                showToast(`${links.length} adet link kopyalandı!`, "success");
            } else {
                showToast("Kopyalanacak link bulunamadı.", "warning");
            }
        })
        .catch(() => {
            showToast("Linkler kopyalanamadı.", "error");
        });
}


