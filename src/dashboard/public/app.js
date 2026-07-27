// ============================================
// Auto Notif Pengaduan — Dashboard Frontend
// ============================================

const API_BASE = '/api';
let refreshInterval = null;

// ============================================
// Auth Gate Protection (Password Only)
// ============================================

const SECRET_GATE_KEY = 'punyaumum2024';

function checkGateAuth() {
  const token = localStorage.getItem('bpn_portal_auth');
  const gate = document.getElementById('auth-gate');
  const main = document.getElementById('main-app');
  if (token === SECRET_GATE_KEY) {
    if (gate) gate.style.display = 'none';
    if (main) main.style.display = 'block';
    return true;
  } else {
    if (gate) gate.style.display = 'flex';
    if (main) main.style.display = 'none';
    return false;
  }
}

function handleGateLogin(event) {
  if (event) event.preventDefault();
  const inputEl = document.getElementById('gate-password');
  const input = (inputEl?.value || '').trim();
  const errorEl = document.getElementById('gate-error');
  if (input === SECRET_GATE_KEY) {
    localStorage.setItem('bpn_portal_auth', SECRET_GATE_KEY);
    if (errorEl) errorEl.style.display = 'none';
    const gate = document.getElementById('auth-gate');
    if (gate) gate.style.display = 'none';
    const main = document.getElementById('main-app');
    if (main) main.style.display = 'block';
    loadAllData();
    startAutoRefresh();
    showToast('🔓 Selamat datang di Dashboard Kanwil BPN Aceh!', 'success');
  } else {
    if (errorEl) errorEl.style.display = 'block';
    if (inputEl) {
      inputEl.value = '';
      inputEl.focus();
    }
  }
  return false;
}

function handleGateLogout() {
  if (!confirm('Apakah Anda yakin ingin mengunci dashboard dan keluar dari sesi Anda?')) return;
  localStorage.removeItem('bpn_portal_auth');
  if (refreshInterval) clearInterval(refreshInterval);
  const gate = document.getElementById('auth-gate');
  if (gate) gate.style.opacity = '1';
  checkGateAuth();
  showToast('🔒 Dashboard dikunci. Sesi berakhir.', 'info');
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  const isAuthenticated = checkGateAuth();
  if (isAuthenticated) {
    loadAllData();
    startAutoRefresh();
  }
});

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      // Remove active from all
      tabs.forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

      // Activate clicked tab
      tab.classList.add('active');
      const tabId = `tab-${tab.dataset.tab}`;
      document.getElementById(tabId).classList.add('active');

      // Load data for the tab
      switch (tab.dataset.tab) {
        case 'admins': loadAdmins(); break;
        case 'tickets': loadTickets(); break;
        case 'logs': loadLogs(); break;
        case 'settings': loadSettings(); break;
      }
    });
  });
}

function loadAllData() {
  loadStats();
  loadAdmins();
  checkAuthStatus();
}

function startAutoRefresh() {
  refreshInterval = setInterval(() => {
    loadStats();
    checkAuthStatus();
  }, 15000); // Refresh stats every 15 seconds
}

// ============================================
// API Helpers
// ============================================

async function apiGet(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);
  return await response.json();
}

async function apiPost(endpoint, data) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return await response.json();
}

async function apiPut(endpoint, data) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return await response.json();
}

async function apiDelete(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
  });
  return await response.json();
}

// ============================================
// Dashboard Stats
// ============================================

async function loadStats() {
  try {
    const result = await apiGet('/stats');
    if (!result.success) return;

    const { tickets, notifications, scraper, settings } = result.data;

    // Update stat cards
    document.getElementById('stat-total-tickets').textContent = tickets.total;
    document.getElementById('stat-today-tickets').textContent = `Hari ini: ${tickets.today}`;
    document.getElementById('stat-total-notif').textContent = notifications.total;
    document.getElementById('stat-today-notif').textContent = `Hari ini: ${notifications.today}`;
    document.getElementById('stat-sent').textContent = notifications.sent;
    document.getElementById('stat-failed').textContent = notifications.failed;

    // Update scraper status
    const statusEl = document.getElementById('scraper-status');
    const statusText = document.getElementById('status-text');
    statusEl.className = `status-badge ${scraper.status || 'stopped'}`;

    const statusLabels = {
      running: 'Running',
      idle: 'Idle',
      stopped: 'Stopped',
      error: 'Error',
    };
    statusText.textContent = statusLabels[scraper.status] || scraper.status;

    // Last scrape time
    if (scraper.lastScrape && scraper.lastScrape !== '-') {
      const date = new Date(scraper.lastScrape);
      document.getElementById('last-scrape').textContent = `Terakhir: ${formatTime(date)}`;
    }

    // Update settings toggles
    document.getElementById('setting-notification').checked = settings.notificationEnabled;
    document.getElementById('setting-group').checked = settings.groupEnabled;
    document.getElementById('setting-personal').checked = settings.personalEnabled;

    // Update WA group
    if (document.activeElement.id !== 'setting-wa-group') {
      document.getElementById('setting-wa-group').value = settings.waGroupId || '';
    }
    
    // Update reminder interval
    if (document.activeElement.id !== 'setting-reminder-interval') {
      document.getElementById('setting-reminder-interval').value = settings.reminderInterval || '0';
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// ============================================
// Auth & Interactive Login Flow
// ============================================

let authPollInterval = null;

async function checkAuthStatus() {
  try {
    const res = await apiGet('/auth/status');
    if (res.success) {
      const statusText = document.getElementById('oca-status-text');
      const btnLogin = document.getElementById('btn-oca-login');
      const badgeLogged = document.getElementById('badge-oca-logged');
      
      if (res.data.status === 'LOGGED_IN') {
        statusText.textContent = 'Status: Terhubung';
        statusText.style.color = 'var(--success)';
        btnLogin.style.display = 'none';
        badgeLogged.style.display = 'inline-block';
      } else if (res.data.status === 'LOGIN_IN_PROGRESS' || res.data.status === 'NEED_OTP') {
        statusText.textContent = 'Status: Proses Login...';
        statusText.style.color = 'var(--warning)';
        btnLogin.style.display = 'inline-block';
        btnLogin.textContent = 'Lanjutkan Login';
        badgeLogged.style.display = 'none';
      } else {
        statusText.textContent = 'Status: Terputus';
        statusText.style.color = 'var(--danger)';
        btnLogin.style.display = 'inline-block';
        btnLogin.textContent = 'Login OCA';
        badgeLogged.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Failed to check auth status', e);
  }
}

function openLoginModal() {
  document.getElementById('login-modal').classList.add('active');
  document.getElementById('login-step-1').style.display = 'block';
  document.getElementById('login-step-otp').style.display = 'none';
  document.getElementById('login-loading').style.display = 'none';
  document.getElementById('btn-submit-login').style.display = 'inline-block';
  document.getElementById('btn-submit-otp').style.display = 'none';
  
  // Clear poll if exists
  if (authPollInterval) clearInterval(authPollInterval);
  checkAuthStatusForModal();
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('active');
  if (authPollInterval) clearInterval(authPollInterval);
}

function showLoginLoading(text) {
  document.getElementById('login-step-1').style.display = 'none';
  document.getElementById('login-step-otp').style.display = 'none';
  document.getElementById('login-loading').style.display = 'block';
  document.getElementById('login-loading-text').textContent = text;
  document.getElementById('btn-submit-login').style.display = 'none';
  document.getElementById('btn-submit-otp').style.display = 'none';
}

function showOtpStep() {
  document.getElementById('login-step-1').style.display = 'none';
  document.getElementById('login-loading').style.display = 'none';
  document.getElementById('login-step-otp').style.display = 'block';
  document.getElementById('btn-submit-login').style.display = 'none';
  document.getElementById('btn-submit-otp').style.display = 'inline-block';
}

async function submitOcaLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  if (!email || !password) return alert('Email dan password harus diisi');

  showLoginLoading('Membuka browser dan mengisi form...');

  try {
    const res = await apiPost('/auth/login', { email, password });
    if (!res.success) {
      alert('Gagal memulai login: ' + res.error);
      openLoginModal(); // reset view
      return;
    }
    
    // Start polling status
    pollAuthStatus();
  } catch (e) {
    alert('Terjadi kesalahan sistem');
    openLoginModal();
  }
}

async function submitOcaOtp() {
  const otp = document.getElementById('login-otp').value;
  if (!otp) return alert('Masukkan kode OTP');

  showLoginLoading('Memverifikasi OTP...');

  try {
    const res = await apiPost('/auth/otp', { otp });
    if (!res.success) {
      alert('Error OTP: ' + res.error);
      showOtpStep();
      return;
    }
    // Continue polling
    pollAuthStatus();
  } catch (e) {
    alert('Terjadi kesalahan sistem');
    showOtpStep();
  }
}

function pollAuthStatus() {
  if (authPollInterval) clearInterval(authPollInterval);
  
  authPollInterval = setInterval(checkAuthStatusForModal, 3000);
}

async function checkAuthStatusForModal() {
  try {
    const res = await apiGet('/auth/status');
    if (!res.success) return;

    const st = res.data.status;
    if (st === 'LOGGED_IN') {
      clearInterval(authPollInterval);
      alert('Login Berhasil!');
      closeLoginModal();
      checkAuthStatus(); // Update main UI
    } else if (st === 'NEED_OTP') {
      clearInterval(authPollInterval);
      showOtpStep();
    } else if (st === 'ERROR') {
      clearInterval(authPollInterval);
      alert('Gagal Login: ' + res.data.error);
      openLoginModal();
    } else if (st === 'LOGIN_IN_PROGRESS') {
      showLoginLoading('Menunggu proses dari server OCA...');
    }
  } catch (e) {
    console.error(e);
  }
}

// ============================================
// Admin Management
// ============================================

async function loadAdmins() {
  try {
    const result = await apiGet('/admins');
    if (!result.success) return;

    const tbody = document.getElementById('admin-table-body');

    if (result.data.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-icon">👥</div>
              <h3>Belum ada data admin & Kasubbag TU</h3>
              <p>Klik "+ Tambah Admin" untuk mendaftarkan petugas dan Kasubbag TU kantor pertanahan</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = result.data.map((admin, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong style="color: #38bdf8;">${escapeHtml(admin.kantor_pertanahan)}</strong></td>
        <td><strong>${escapeHtml(admin.nama || '-')}</strong></td>
        <td>${escapeHtml(admin.no_hp || '-')}</td>
        <td><span style="color: #d8b4fe; font-weight: 500;">👔 ${escapeHtml(admin.nama_ktu || 'Belum diisi')}</span></td>
        <td>${escapeHtml(admin.no_hp_ktu || '-')}</td>
        <td>
          <span class="badge ${admin.is_active ? 'badge-success' : 'badge-danger'}">
            ${admin.is_active ? 'Aktif' : 'Nonaktif'}
          </span>
        </td>
        <td>
          <div class="actions-bar">
            <button class="btn btn-ghost btn-sm btn-icon" onclick="editAdmin(${admin.id})" title="Edit">✏️</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteAdmin(${admin.id}, '${escapeHtml(admin.kantor_pertanahan)}')" title="Hapus">🗑️</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (error) {
    console.error('Failed to load admins:', error);
    showToast('Gagal memuat data admin', 'error');
  }
}

function openAdminModal(admin = null) {
  document.getElementById('admin-modal-title').textContent = admin ? 'Edit Admin & Kasubbag TU' : 'Tambah Admin & Kasubbag TU';
  document.getElementById('admin-edit-id').value = admin ? admin.id : '';
  document.getElementById('admin-nama').value = admin ? admin.nama : '';
  document.getElementById('admin-kantor').value = admin ? admin.kantor_pertanahan : '';
  document.getElementById('admin-hp').value = admin ? admin.no_hp : '';
  document.getElementById('admin-nama-ktu').value = admin ? (admin.nama_ktu || '') : '';
  document.getElementById('admin-hp-ktu').value = admin ? (admin.no_hp_ktu || '') : '';
  document.getElementById('admin-modal').classList.add('active');
}

function closeAdminModal() {
  document.getElementById('admin-modal').classList.remove('active');
}

async function saveAdmin() {
  const id = document.getElementById('admin-edit-id').value;
  const nama = document.getElementById('admin-nama').value.trim();
  const kantor_pertanahan = document.getElementById('admin-kantor').value.trim();
  const no_hp = document.getElementById('admin-hp').value.trim();
  const nama_ktu = document.getElementById('admin-nama-ktu').value.trim();
  const no_hp_ktu = document.getElementById('admin-hp-ktu').value.trim();

  if (!nama || !kantor_pertanahan || !no_hp) {
    showToast('Nama Admin, Kantor Pertanahan, dan No HP Admin wajib diisi', 'error');
    return;
  }

  try {
    let result;
    if (id) {
      result = await apiPut(`/admins/${id}`, { nama, kantor_pertanahan, no_hp, nama_ktu, no_hp_ktu, is_active: true });
    } else {
      result = await apiPost('/admins', { nama, kantor_pertanahan, no_hp, nama_ktu, no_hp_ktu });
    }

    if (result.success) {
      showToast(`Data kontak kantor pertanahan ${id ? 'diperbarui' : 'ditambahkan'}`, 'success');
      closeAdminModal();
      loadAdmins();
    } else {
      showToast(result.error || 'Gagal menyimpan', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

async function editAdmin(id) {
  try {
    const result = await apiGet(`/admins/${id}`);
    if (result.success) {
      openAdminModal(result.data);
    }
  } catch (error) {
    showToast('Gagal memuat data admin', 'error');
  }
}

async function deleteAdmin(id, nama) {
  if (!confirm(`Hapus admin "${nama}"?`)) return;

  try {
    const result = await apiDelete(`/admins/${id}`);
    if (result.success) {
      showToast('Admin dihapus', 'success');
      loadAdmins();
    } else {
      showToast(result.error || 'Gagal menghapus', 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

// ============================================
// Tickets
// ============================================

let allLoadedTickets = [];

function filterTickets() {
  const query = (document.getElementById('ticket-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('ticket-filter-status')?.value || 'ALL';
  const kantorFilter = document.getElementById('ticket-filter-kantor')?.value || 'ALL';
  const tbody = document.getElementById('ticket-table-body');
  if (!tbody) return;

  const filtered = allLoadedTickets.filter(ticket => {
    const st = (ticket.status || '').toUpperCase();
    if (statusFilter === 'OPEN' && st !== 'OPEN') return false;
    if (statusFilter === 'CLOSED' && st !== 'CLOSED' && st !== 'RESOLVED') return false;
    if (kantorFilter !== 'ALL' && ticket.kantor_pertanahan !== kantorFilter) return false;

    if (!query) return true;
    const matchId = (ticket.ticket_id || '').toLowerCase().includes(query);
    const matchCust = (ticket.customer || '').toLowerCase().includes(query);
    const matchKantor = (ticket.kantor_pertanahan || '').toLowerCase().includes(query);
    return matchId || matchCust || matchKantor;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <h3>Tidak ada tiket yang cocok</h3>
            <p>Cobalah kata kunci pencarian atau filter kantor / status yang lain</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((ticket) => `
    <tr>
      <td><strong>${escapeHtml(ticket.ticket_id)}</strong></td>
      <td>${escapeHtml(ticket.customer || '-')}</td>
      <td>${escapeHtml(ticket.kantor_pertanahan || '-')}</td>
      <td><span class="badge ${ticket.status === 'Open' ? 'badge-warning' : ticket.status === 'Closed' || ticket.status === 'Resolved' ? 'badge-success' : 'badge-info'}">${ticket.status}</span></td>
      <td>${escapeHtml(ticket.priority || '-')}</td>
      <td>${ticket.notified_group ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-danger">✕</span>'}</td>
      <td>${ticket.notified_admin ? '<span class="badge badge-success">✓</span>' : '<span class="badge badge-danger">✕</span>'}</td>
      <td class="timestamp">${formatDateTime(ticket.notified_at)}</td>
      <td>
        <button class="btn btn-warning btn-sm" style="font-size: 11px; padding: 6px 10px; background: #f59e0b; color: #000; font-weight: bold; border-radius: 6px; white-space: nowrap;" onclick="resendReminder('${ticket.ticket_id}', this)">📨 Kirim Ulang</button>
      </td>
    </tr>
  `).join('');
}

async function resendReminder(ticketId, btn) {
  if (!confirm(`Kirim ulang peringatan ke Admin untuk Tiket #${ticketId} sekarang?`)) return;
  const oldText = btn.innerHTML;
  try {
    btn.disabled = true;
    btn.innerHTML = '⏳ Mengirim...';
    showToast('Menembakkan pesan peringatan...', 'info');
    const result = await apiPost(`/tickets/${ticketId}/resend`, {});
    if (result && result.success) {
      showToast(result.message || 'Penyampaian peringatan berhasil dikirim!', 'success');
    } else {
      showToast('Gagal: ' + ((result && result.error) ? result.error : 'Terjadi kesalahan'), 'error');
    }
  } catch (err) {
    showToast('Gagal mengirim peringatan', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
}

async function loadTickets() {
  try {
    const result = await apiGet('/tickets?limit=500');
    if (!result.success) return;
    allLoadedTickets = result.data || [];
    
    // Populate kantor filter dropdown
    const kantorSelect = document.getElementById('ticket-filter-kantor');
    if (kantorSelect) {
      const currentVal = kantorSelect.value;
      const kantors = [...new Set(allLoadedTickets.map(t => t.kantor_pertanahan).filter(Boolean))].sort();
      kantorSelect.innerHTML = `<option value="ALL">🏢 Semua Kantor Pertanahan (${kantors.length})</option>` + 
        kantors.map(k => `<option value="${escapeHtml(k)}" ${k === currentVal ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
    }

    filterTickets();
  } catch (error) {
    console.error('Failed to load tickets:', error);
    showToast('Gagal memuat data tiket', 'error');
  }
}

async function refreshLiveTickets(btn) {
  const originalText = btn ? btn.innerHTML : '⚡ Ambil Data & Update Status Terbaru';
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Mengambil & mengupdate dari OCA...';
    }
    showToast('Memindai OCA untuk tiket terbaru & perubahan status...', 'info');
    const result = await apiPost('/tickets/refresh-live', {});
    if (result && result.success) {
      showToast(result.message || 'Data tiket berhasil diperbarui!', 'success');
      await loadTickets();
    } else {
      showToast('Gagal memperbarui: ' + ((result && result.error) ? result.error : 'Sistem sedang dipanggil, coba beberapa detik lagi'), 'error');
    }
  } catch (error) {
    console.error('Failed live refresh:', error);
    showToast('Gagal memperbarui data dari OCA', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// ============================================
// Notification Logs
// ============================================

let allLoadedLogs = [];
let currentLogTab = 'personal';

function switchLogTab(tab, btn) {
  currentLogTab = tab;
  document.getElementById('btn-log-personal').className = tab === 'personal' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('btn-log-personal').style.fontWeight = tab === 'personal' ? 'bold' : 'normal';
  document.getElementById('btn-log-group').className = tab === 'group' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('btn-log-group').style.fontWeight = tab === 'group' ? 'bold' : 'normal';
  renderLogs();
}

function renderLogs() {
  const tbody = document.getElementById('log-table-body');
  if (!tbody) return;

  const filtered = allLoadedLogs.filter(log => {
    if (currentLogTab === 'group') {
      return log.target_type === 'group';
    } else {
      return log.target_type !== 'group';
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state">
            <div class="empty-icon">📨</div>
            <h3>Belum ada log ${currentLogTab === 'group' ? 'Pesan Group' : 'Pesan Japri Personal'}</h3>
            <p>Log akan muncul setelah notifikasi terkirim ke target tersebut</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((log) => `
    <tr>
      <td><strong>${escapeHtml(log.ticket_id)}</strong></td>
      <td><span class="badge ${log.target_type === 'group' ? 'badge-info' : 'badge-warning'}">${log.target_type}</span></td>
      <td>${escapeHtml(log.target_name || log.target_number || '-')}</td>
      <td><span class="badge ${log.status === 'sent' ? 'badge-success' : 'badge-danger'}">${log.status}</span></td>
      <td class="timestamp">${formatDateTime(log.sent_at)}</td>
    </tr>
  `).join('');
}

async function loadLogs() {
  try {
    const result = await apiGet('/logs?limit=200');
    if (!result.success) return;
    allLoadedLogs = result.data || [];
    renderLogs();
  } catch (error) {
    console.error('Failed to load logs:', error);
    showToast('Gagal memuat log notifikasi', 'error');
  }
}

// ============================================
// Initialization & Templates
// ============================================

let cachedTemplates = {};

async function loadTemplates() {
  try {
    const result = await apiGet('/templates');
    const container = document.getElementById('templates-container');
    const loading = document.getElementById('templates-loading');
    if (!container) return;

    if (loading) loading.style.display = 'none';
    if (!result.success) {
      container.innerHTML = '<div class="empty-state"><p>Gagal memuat template notifikasi</p></div>';
      return;
    }

    cachedTemplates = result.data || {};
    container.innerHTML = Object.entries(cachedTemplates).map(([key, item]) => `
      <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
          <div>
            <h3 style="font-size: 1.05rem; color: var(--primary-light, #38bdf8); margin-bottom: 4px;">${escapeHtml(item.title)}</h3>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin: 0;">${escapeHtml(item.description)}</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="resetTemplate('${key}')" style="font-size: 12px; padding: 6px 12px;">↩️ Reset ke Default</button>
        </div>
        <div style="margin-bottom: 12px; font-size: 0.8rem; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; color: #cbd5e1;">
          <strong>💡 Variabel Tersedia (Akan diganti otomatis oleh sistem):</strong> <span style="font-family: monospace; color: #facc15;">${escapeHtml(item.placeholders)}</span>
        </div>
        <textarea id="tpl-${key}" class="form-input template-input" data-key="${key}" rows="8" style="width: 100%; font-family: 'Courier New', monospace; font-size: 13.5px; line-height: 1.5; padding: 12px; border-radius: 8px; background: #0f172a; color: #f8fafc; border: 1px solid rgba(255,255,255,0.2);">${escapeHtml(item.text)}</textarea>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
}

function resetTemplate(key) {
  if (!confirm(`Kembalikan teks bahasa pada template "${cachedTemplates[key]?.title}" ke teks default pabrik?`)) return;
  const el = document.getElementById(`tpl-${key}`);
  if (el && cachedTemplates[key]) {
    el.value = cachedTemplates[key].defaultText;
    showToast('Teks dikembalikan ke default. Klik Simpan untuk memperbarui ke sistem!', 'info');
  }
}

async function saveAllTemplates() {
  const inputs = document.querySelectorAll('.template-input');
  const data = {};
  inputs.forEach(input => {
    const key = input.getAttribute('data-key');
    data[key] = input.value;
  });

  try {
    showToast('Menyimpan perubahan bahasa...', 'info');
    const result = await apiPost('/templates', data);
    if (result.success) {
      showToast(result.message || 'Semua template bahasa berhasil disimpan!', 'success');
      loadTemplates();
    } else {
      showToast('Gagal menyimpan: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Terjadi kesalahan saat menyimpan template', 'error');
  }
}

async function initDashboard() {
  await loadStats();
  await loadAdmins();
  await loadTickets();
  await loadLogs();
  await loadTemplates();
  await checkAuthStatus();

  // Polling every 10 seconds for stats and auth
  setInterval(() => {
    loadStats();
    checkAuthStatus();
  }, 10000);
}

async function updateSetting(key, value) {
  try {
    const result = await apiPost('/settings', { key, value: value ? '1' : '0' });
    if (!result.success) {
      alert(`Gagal menyimpan pengaturan: ${result.error}`);
    }
  } catch (error) {
    console.error('Error saving setting:', error);
  }
}

async function loadSettings() {
  try {
    const res = await apiGet('/settings');
    if (res.success && res.data) {
      const elWa = document.getElementById('setting-wa-group');
      if (elWa) elWa.value = res.data.wa_group_id || '';
      
      const elRem = document.getElementById('setting-reminder-interval');
      if (elRem) elRem.value = res.data.reminder_interval_minutes !== undefined && res.data.reminder_interval_minutes !== '' ? res.data.reminder_interval_minutes : '5';

      const elNoti = document.getElementById('setting-notification');
      if (elNoti) elNoti.checked = res.data.notification_enabled !== '0';

      const elGroup = document.getElementById('setting-group');
      if (elGroup) elGroup.checked = res.data.group_notification_enabled !== '0';

      const elPers = document.getElementById('setting-personal');
      if (elPers) elPers.checked = res.data.personal_notification_enabled !== '0';
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function pingKanwil() {
  try {
    const result = await apiPost('/test-kanwil', {});
    if (result.success) {
      alert('✅ Ping ke Admin Kanwil Berhasil Dikirim!');
    } else {
      alert(`❌ Gagal ping Kanwil: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Error: ${error.message}`);
  }
}

async function pingGroup() {
  try {
    const result = await apiPost('/test-group', {});
    if (result.success) {
      alert('✅ Ping ke Group WhatsApp Berhasil Dikirim!');
    } else {
      alert(`❌ Gagal ping Group: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Error: ${error.message}`);
  }
}

async function forceCheckNow() {
  try {
    const result = await apiPost('/force-check', {});
    if (result.success) {
      alert('⚡ Pengecekan tiket baru dan pengiriman reminder sedang dieksekusi detik ini!');
    } else {
      alert(`❌ Gagal mengeksekusi: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Error: ${error.message}`);
  }
}

async function saveWaGroup() {
  const waGroup = document.getElementById('setting-wa-group').value;
  try {
    const result = await apiPost('/settings', { key: 'wa_group_id', value: waGroup });
    if (result.success) {
      alert('ID/Nama Group berhasil disimpan!');
    } else {
      alert(`Gagal menyimpan: ${result.error}`);
    }
  } catch (error) {
    console.error('Error saving wa group:', error);
  }
}

async function saveReminderInterval() {
  const interval = document.getElementById('setting-reminder-interval').value;
  try {
    const result = await apiPost('/settings', { key: 'reminder_interval_minutes', value: interval });
    if (result.success) {
      alert('Interval reminder berhasil disimpan!');
    } else {
      alert(`Gagal menyimpan: ${result.error}`);
    }
  } catch (error) {
    console.error('Error saving reminder interval:', error);
  }
}

// ============================================
// Test Notification
// ============================================

function openTestModal() {
  document.getElementById('test-modal').classList.add('active');
}

function closeTestModal() {
  document.getElementById('test-modal').classList.remove('active');
}

function toggleTestTarget() {
  const type = document.getElementById('test-type').value;
  document.getElementById('test-target-group').style.display = type === 'group' ? 'block' : 'none';
  document.getElementById('test-target-personal').style.display = type === 'personal' ? 'block' : 'none';
}

async function sendTestNotification() {
  const type = document.getElementById('test-type').value;
  let target = '';

  if (type === 'group') {
    target = document.getElementById('test-group-name').value.trim();
  } else {
    target = document.getElementById('test-phone').value.trim();
    if (!target) {
      showToast('Masukkan nomor HP tujuan', 'error');
      return;
    }
  }

  const btn = document.getElementById('test-send-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> Mengirim...';

  try {
    const result = await apiPost('/test-notification', { type, target });
    if (result.success) {
      showToast('Test notifikasi berhasil dikirim! ✅', 'success');
      closeTestModal();
      loadLogs();
    } else {
      showToast('Gagal kirim: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🚀 Kirim Test';
  }
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${escapeHtml(message)}`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================
// Utility Functions
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(date) {
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
  }
});
