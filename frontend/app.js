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
}
