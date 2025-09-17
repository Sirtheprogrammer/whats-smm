const express = require('express');
const router = express.Router();
const whatsappBot = require('../bot/whatsapp');
const smm = require('../services/smmguo');
const SmmService = require('../models/smmService');
const Session = require('../models/session');
const logCollector = require('../utils/logCollector');
const Order = require('../models/order');

// Middleware to verify admin token
const verifyAdminToken = (req, res, next) => {
    const token = req.headers['x-admin-token'];
    
    if (!token || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    next();
};

// Admin panel UI route (now public — no token required)
router.get('/panel', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp SMM Bot Admin Panel</title>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <style>
                body { font-family: Arial, sans-serif; max-width: 1100px; margin: 20px auto; padding: 20px; }
                .flex { display:flex; gap:12px; align-items:center; }
                .qr-container { text-align: center; margin: 20px 0; }
                .status-container { background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .status-connected { color: green; }
                .status-disconnected { color: red; }
                .status-connecting { color: orange; }
                button { padding: 8px 12px; margin: 5px; cursor: pointer; }
                #qrCode { max-width: 300px; margin: 20px auto; }
                .message-form, .user-form { margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 5px; }
                .message-form input, .message-form textarea, .user-form input, .user-form select { width: 100%; margin: 6px 0; padding: 8px; box-sizing: border-box; }
                table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                table th, table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                table th { background: #f2f2f2; }
                .small { font-size: 0.9em; color: #666; }
                .token-row { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
                .actions { margin-top:10px; }
            </style>
        </head>
        <body>
            <h1>WhatsApp SMM Bot Admin Panel</h1>

            <div class="status-container">
                <h3>Connection Status: <span id="connectionStatus">Checking...</span></h3>
                <p>Reconnection Attempts: <span id="reconnectAttempts">0</span></p>
            </div>

            <div class="qr-container">
                <h3>Scan QR Code to Connect</h3>
                <img id="qrCode" style="display: none;" />
                <p id="qrStatus">Waiting for QR code...</p>
            </div>

            <div class="message-form">
                <h3>Send Test Message</h3>
                <input type="text" id="phoneNumber" placeholder="Phone number (with country code)" />
                <textarea id="message" placeholder="Message text"></textarea>
                <button onclick="sendMessage()">Send Message</button>
            </div>

            <div class="flex">
                <button onclick="connectBot()">Connect (generate QR)</button>
                <button onclick="logout()">Logout</button>
                <button onclick="checkStatus()">Refresh Status</button>
            </div>

            <hr />

            <h2>User Management</h2>
            <div class="token-row">
                <input id="adminToken" placeholder="Enter admin token (x-admin-token)" />
                <button onclick="saveToken()">Save Token</button>
                <button onclick="clearToken()">Clear</button>
                <span class="small">Token is stored in browser localStorage for convenience.</span>
            </div>

            <div class="user-form">
                <h3>Create / Update User</h3>
                <input id="u_phone" placeholder="Phone (e.g. 2557XXXXXXXX)" />
                <input id="u_referred_by" placeholder="Referred by (phone) - optional" />
                <select id="u_language"><option value="en">English</option><option value="sw">Kiswahili</option></select>
                <input id="u_balance" placeholder="Balance (TZS) - optional" />
                <input id="u_referralCode" placeholder="Referral Code - optional" />
                <div class="actions">
                    <button onclick="createOrUpdateUser()">Create / Update</button>
                    <button onclick="loadUsers()">Refresh List</button>
                </div>
                <div id="userMsg" class="small"></div>
            </div>

            <div>
                <h3>Active Users (sessions)</h3>
                <div id="usersTableContainer">Loading...</div>
            </div>

            <hr />

            <div>
                <h3>Developer / Debug</h3>
                <button onclick="openDebug()">Open Debug Tools</button>
            </div>

            <script>
                function getToken() {
                    return localStorage.getItem('admin_token') || document.getElementById('adminToken').value || '';
                }
                function saveToken() {
                    const t = document.getElementById('adminToken').value || '';
                    if (t) { localStorage.setItem('admin_token', t); alert('Token saved to localStorage'); }
                }
                function clearToken() { localStorage.removeItem('admin_token'); document.getElementById('adminToken').value = ''; alert('Token cleared'); }

                // load saved token into input on start
                document.addEventListener('DOMContentLoaded', () => {
                    const t = localStorage.getItem('admin_token'); if (t) document.getElementById('adminToken').value = t;
                    checkStatus(); loadUsers();
                });

                async function fetchWithToken(url, opts) {
                    opts = opts || {};
                    opts.headers = opts.headers || {};
                    const token = getToken();
                    if (token) opts.headers['x-admin-token'] = token;
                    if (!opts.headers['Content-Type'] && opts.body) opts.headers['Content-Type'] = 'application/json';
                    if (opts.body && typeof opts.body === 'object') opts.body = JSON.stringify(opts.body);
                    try {
                        const r = await fetch(url, opts);
                        const text = await r.text();
                        try { return { ok: r.ok, status: r.status, json: JSON.parse(text) }; } catch(e) { return { ok: r.ok, status: r.status, text }; }
                    } catch (e) { return { ok: false, error: e && e.message }; }
                }

                async function loadUsers() {
                    const container = document.getElementById('usersTableContainer');
                    container.innerHTML = 'Loading...';
                    const res = await fetchWithToken('/admin/users', { method: 'GET' });
                    if (!res.ok) { container.innerHTML = '<div style="color:red">Failed to load users: ' + (res.status || res.error) + '</div>'; return; }
                    const users = res.json.users || [];
                    if (!users.length) { container.innerHTML = '<div>No users found.</div>'; return; }
                    let html = '<table><thead><tr><th>Phone</th><th>Lang</th><th>Balance</th><th>Referred By</th><th>Referral Code</th><th>Actions</th></tr></thead><tbody>';
                    users.forEach(u => {
                        html += `<tr>
                            <td>${u.phone}</td>
                            <td>${u.language || 'en'}</td>
                            <td>${u.balance_tzs || 0}</td>
                            <td>${u.referred_by || ''}</td>
                            <td>${u.referralCode || ''}</td>
                            <td>
                                <button onclick="editUser('${u.phone}')">Edit</button>
                                <button onclick="setUserLanguage('${u.phone}','en')">EN</button>
                                <button onclick="setUserLanguage('${u.phone}','sw')">SW</button>
                                <button onclick="deleteUser('${u.phone}')">Delete</button>
                            </td>
                        </tr>`;
                    });
                    html += '</tbody></table>';
                    container.innerHTML = html;
                }

                async function editUser(phone) {
                    const res = await fetchWithToken('/admin/user/' + encodeURIComponent(phone), { method: 'GET' });
                    if (!res.ok) { alert('Failed to fetch user: ' + (res.status || res.error)); return; }
                    const u = res.json.user;
                    document.getElementById('u_phone').value = u.phone || '';
                    document.getElementById('u_referred_by').value = u.referred_by || '';
                    document.getElementById('u_language').value = u.language || 'en';
                    document.getElementById('u_balance').value = u.balance_tzs || '';
                    document.getElementById('u_referralCode').value = u.referralCode || '';
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }

                async function createOrUpdateUser() {
                    const phone = document.getElementById('u_phone').value.trim();
                    if (!phone) { document.getElementById('userMsg').textContent = 'Phone is required'; return; }
                    const payload = {
                        phone,
                        referred_by: document.getElementById('u_referred_by').value.trim() || undefined,
                        language: document.getElementById('u_language').value || undefined,
                        balance_tzs: document.getElementById('u_balance').value ? Number(document.getElementById('u_balance').value) : undefined,
                        referralCode: document.getElementById('u_referralCode').value.trim() || undefined
                    };
                    const res = await fetchWithToken('/admin/user', { method: 'POST', body: payload });
                    if (!res.ok) { document.getElementById('userMsg').textContent = 'Failed: ' + (res.status || res.error); return; }
                    document.getElementById('userMsg').textContent = 'User created/updated successfully';
                    loadUsers();
                }

                async function deleteUser(phone) {
                    if (!confirm('Delete user ' + phone + '? This will remove their account and session.')) return;
                    const res = await fetchWithToken('/admin/user/' + encodeURIComponent(phone), { method: 'DELETE' });
                    if (!res.ok) { alert('Failed to delete: ' + (res.status || res.error)); return; }
                    alert('User deleted');
                    loadUsers();
                }

                async function setUserLanguage(phone, lang) {
                    const res = await fetchWithToken('/admin/user/' + encodeURIComponent(phone) + '/language', { method: 'POST', body: { language: lang } });
                    if (!res.ok) { alert('Failed to set language: ' + (res.status || res.error)); return; }
                    alert('Language set to ' + lang + ' for ' + phone);
                    loadUsers();
                }

                async function openDebug() {
                    window.open('/admin/logs','_blank');
                }

                async function checkStatus() {
                    try {
                        const response = await fetch('/admin/status');
                        const data = await response.json();
                        updateStatus(data);
                    } catch (error) {
                        console.error('Error checking status:', error);
                    }
                }

                async function connectBot() {
                    try {
                        const response = await fetch('/admin/connect', { method: 'POST' });
                        const data = await response.json();
                        if (data.success) {
                            if (data.qr) {
                                document.getElementById('qrCode').src = data.qr;
                                document.getElementById('qrCode').style.display = 'block';
                                document.getElementById('qrStatus').textContent = 'Scan this QR code with WhatsApp';
                                startQRCheck();
                            } else {
                                document.getElementById('qrStatus').textContent = 'QR not generated yet';
                            }
                        } else {
                            alert('Failed to connect: ' + (data.error || 'unknown'));
                        }
                    } catch (err) {
                        alert('Error initiating connect: ' + err.message);
                    }
                }

                async function sendMessage() {
                    const phone = document.getElementById('phoneNumber').value;
                    const message = document.getElementById('message').value;

                    if (!phone || !message) {
                        alert('Please enter both phone number and message');
                        return;
                    }

                    try {
                        const response = await fetch('/admin/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ to: phone, message })
                        });

                        const result = await response.json();
                        if (result.success) {
                            alert('Message sent successfully!');
                        } else {
                            alert('Failed to send message: ' + (result.error || 'unknown'));
                        }
                    } catch (error) {
                        alert('Error sending message: ' + error.message);
                    }
                }

                async function logout() {
                    if (!confirm('Are you sure you want to logout?')) return;
                    try {
                        await fetch('/admin/logout', { method: 'POST' });
                        checkStatus();
                    } catch (error) {
                        console.error('Error during logout:', error);
                    }
                }

                let qrCheckInterval;
                function startQRCheck() { checkQR(); qrCheckInterval = setInterval(checkQR, 5000); }
                function stopQRCheck() { if (qrCheckInterval) { clearInterval(qrCheckInterval); qrCheckInterval = null; } }
                async function checkQR() {
                    try {
                        const response = await fetch('/admin/qr');
                        const data = await response.json();

                        if (data.qr) {
                            document.getElementById('qrCode').src = data.qr;
                            document.getElementById('qrCode').style.display = 'block';
                            document.getElementById('qrStatus').textContent = 'Scan this QR code with WhatsApp';
                        }
                    } catch (error) {
                        console.error('Error checking QR:', error);
                    }
                }

                function updateStatus(data) {
                    const statusEl = document.getElementById('connectionStatus');
                    const attemptsEl = document.getElementById('reconnectAttempts');

                    statusEl.textContent = data.status;
                    statusEl.className = 'status-' + (data.status || '').toLowerCase();
                    attemptsEl.textContent = data.reconnectAttempts || 0;

                    if (!data.isConnected && !qrCheckInterval) {
                        startQRCheck();
                    } else if (data.isConnected && qrCheckInterval) {
                        stopQRCheck();
                        document.getElementById('qrCode').style.display = 'none';
                        document.getElementById('qrStatus').textContent = 'Connected! ✅';
                    }
                }

            </script>
        </body>
        </html>
    `);
});

// API endpoints for the admin panel
// NOTE: endpoints are made public (verifyAdminToken not used) so curl/UI can access them without a token

router.get('/status', (req, res) => {
    const status = whatsappBot.getConnectionStatus();
    res.json(status);
});

router.get('/qr', (req, res) => {
    const qr = whatsappBot.getCurrentQR();
    res.json({ qr });
});

router.post('/logout', async (req, res) => {
    try {
        await whatsappBot.logout();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start/init WhatsApp bot (trigger QR generation)
router.post('/connect', async (req, res) => {
    try {
        await whatsappBot.init();
        const status = whatsappBot.getConnectionStatus();
        const qr = whatsappBot.getCurrentQR();
        res.json({ success: true, status, qr });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test message endpoint
router.post('/send', async (req, res) => {
    try {
        const { to, message } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ error: 'Both "to" and "message" are required' });
        }
        
        const result = await whatsappBot.sendMessage(to, message);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// list recent orders
router.get('/orders', async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 }).limit(200).lean();
        res.json({ orders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// get single order by orderId
router.get('/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await Order.findOne({ orderId }).lean();
        if (!order) return res.status(404).json({ error: 'order not found' });
        res.json({ order });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// update order status (admin)
router.post('/orders/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body || {};
        if (!status) return res.status(400).json({ error: 'status required' });
        const allowed = ['PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
        const updated = await Order.findOneAndUpdate({ orderId }, { $set: { status } }, { new: true }).lean();
        if (!updated) return res.status(404).json({ error: 'order not found' });
        res.json({ success: true, order: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// return platforms (from cache or API)
router.get('/smm/platforms', async (req, res) => {
    try {
        const platforms = await smm.getPlatforms();
        res.json({ platforms });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// admin sync endpoint: fetch and cache platforms/services
router.post('/smm/sync', async (req, res) => {
    try {
        const platforms = await smm.getPlatforms();
        // for now we just return platforms; in future admin will pick which to import
        res.json({ success: true, platforms });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// list services in local catalogue
router.get('/smm/catalog', async (req, res) => {
    try {
        const items = await SmmService.find().limit(200).lean();
        res.json({ services: items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// get single service by serviceId
router.get('/smm/catalog/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        const item = await SmmService.findOne({ serviceId }).lean();
        if (!item) return res.status(404).json({ error: 'service not found' });
        res.json({ service: item });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// update service details (name, price in TZS, category)
router.put('/smm/catalog/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        const { name, price_tzs, category } = req.body || {};
        const update = {};
        if (name) update.name = name;
        if (typeof price_tzs !== 'undefined' && price_tzs !== null) {
            const p = Number(price_tzs);
            if (Number.isFinite(p) && p >= 0) update.price = p; // store price as TZS
            else return res.status(400).json({ error: 'price_tzs must be a non-negative number' });
        }
        if (typeof category !== 'undefined') update.category = category || null;
        if (!Object.keys(update).length) return res.status(400).json({ error: 'nothing to update' });
        const updated = await SmmService.findOneAndUpdate({ serviceId }, { $set: update }, { new: true }).lean();
        if (!updated) return res.status(404).json({ error: 'service not found' });
        res.json({ success: true, service: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// rename a category across services for a platform (or globally if platform omitted)
router.post('/smm/category/rename', async (req, res) => {
    try {
        const { platform, oldName, newName } = req.body || {};
        if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
        const q = { category: oldName };
        if (platform) q.platform = platform;
        const result = await SmmService.updateMany(q, { $set: { category: newName } });
        res.json({ success: true, matchedCount: result.matchedCount || result.n || 0, modifiedCount: result.modifiedCount || result.nModified || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// get categories for a platform
router.get('/smm/platforms/:platformId/categories', async (req, res) => {
    try {
        const { platformId } = req.params;
        const categories = await smm.getCategories(platformId);
        res.json({ categories });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// get services for category under a platform
router.get('/smm/platforms/:platformId/categories/:categoryId/services', async (req, res) => {
    try {
        const { platformId, categoryId } = req.params;
        const services = await smm.getServices(categoryId, platformId);
        res.json({ services });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// import selected services into DB
router.post('/smm/import', async (req, res) => {
    try {
        let { platform, services } = req.body || {};

        // If services is a string (form post or missing content-type), try to parse it
        if (typeof services === 'string') {
            // try JSON first
            try {
                services = JSON.parse(services);
            } catch (e) {
                // fallback: comma-separated ids (e.g. services=1,2,3)
                services = services.split(',').map(s => ({ id: s.trim() })).filter(s => s.id);
            }
        }

        // If no services supplied, fetch all services for the platform from remote
        if (!services || !Array.isArray(services) || services.length === 0) {
            if (!platform) {
                console.log('Bad import payload (no platform)', { platform, services, body: req.body });
                return res.status(400).json({ error: 'platform (string) required when services not provided' });
            }
            try {
                const remote = await smm.fetchAllServicesForPlatform(platform);
                services = (Array.isArray(remote) ? remote : []).map(s => ({ id: s.id || s.service || (s.raw && (s.raw.service || s.raw.id)) || s.name, name: s.name || s.service || s.id, price: s.price || null, raw: s }));
            } catch (e) {
                console.log('Failed to fetch remote services for platform', platform, e && e.message);
                services = [];
            }
        }

        if (!platform || !services || !Array.isArray(services)) {
            console.log('Bad import payload', { platform, services, body: req.body });
            return res.status(400).json({ error: 'platform (string) and services (array) are required. If you POSTed form-encoded data, ensure services is JSON or comma-separated list.' });
        }

        const imported = [];
        for (const s of services) {
            const sid = s.id || s.serviceId || s.service || (s.raw && (s.raw.service || s.raw.id)) || null;
            if (!sid) continue;
            const existing = await SmmService.findOne({ serviceId: sid }).lean();
            if (existing) continue;
            // try to enrich price from remote
            let remote = null;
            try { remote = await smm.getServiceById(sid); } catch (e) { remote = null; }
            const priceVal = s.price || (remote && (remote.price || remote.rate)) || null;
            const doc = new SmmService({ serviceId: sid, platform: platform, category: s.category || null, name: s.name || sid, price: priceVal, raw: s });
            await doc.save();
            imported.push(doc);
        }

        res.json({ success: true, importedCount: imported.length, imported });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// fetch recent logs (used by dashboard)
router.get('/logs', async (req, res) => {
    try {
        const logs = logCollector.getRecent(200);
        res.json({ logs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// list active users (from sessions)
router.get('/users', async (req, res) => {
    try {
        const sessions = await Session.find().sort({ updatedAt: -1 }).limit(200).lean();
        const users = sessions.map(s => ({ sessionId: s.sessionId, lastSeen: s.updatedAt, data: s.data }));
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// delete service from local catalogue by serviceId
router.delete('/smm/catalog/:serviceId', async (req, res) => {
    try {
        const { serviceId } = req.params;
        if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

        // try to delete by serviceId first
        let deleted = await SmmService.findOneAndDelete({ serviceId }).lean();

        // if not found, also allow deleting by Mongo _id when serviceId looks like an object id
        if (!deleted) {
            const mongoose = require('mongoose');
            if (mongoose.Types.ObjectId.isValid(serviceId)) {
                deleted = await SmmService.findByIdAndDelete(serviceId).lean();
            }
        }

        if (!deleted) return res.status(404).json({ error: 'service not found' });
        res.json({ success: true, deleted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// debug endpoint: send a minimal interactive list to a phone (for testing client support)
router.post('/debug/send-list', async (req, res) => {
    try {
        const { to } = req.body || {};
        if (!to) return res.status(400).json({ error: 'to (phone) is required' });

        const rows = [
            { title: 'Option A', rowId: 'debug:optA', description: 'Test option A' },
            { title: 'Option B', rowId: 'debug:optB', description: 'Test option B' }
        ];
        const sections = [{ title: 'Debug List', rows }];

        const sent = await whatsappBot.sendList(to, { title: 'Test — interactive list', text: 'Select an option to test interactive messages', buttonText: 'Select', footer: 'Debug', sections });
        if (sent) return res.json({ success: true, sent: true });
        return res.status(500).json({ success: false, error: 'sendList returned false' });
    } catch (err) {
        console.error('debug send-list error', err && (err.stack || err.message));
        res.status(500).json({ error: err && (err.message || String(err)) });
    }
});

// register or update user (capture referral code if provided)
router.post('/user/register', async (req, res) => {
    try {
        const { phone, referred_by } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'phone required' });
        const User = require('../models/user');
        let user = await User.findOne({ phone }).catch(()=>null);
        if (!user) {
            user = new User({ phone, referred_by: referred_by || null });
            await user.save();
        } else if (referred_by && !user.referred_by) {
            user.referred_by = referred_by;
            await user.save();
        }
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// get user balance and referral info
router.get('/user/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const User = require('../models/user');
        const user = await User.findOne({ phone }).lean();
        if (!user) return res.status(404).json({ error: 'user not found' });
        res.json({ user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// request withdrawal (simple implementation: mark withdraw request and deduct balance)
router.post('/user/:phone/withdraw', async (req, res) => {
    try {
        const { phone } = req.params;
        const { amount } = req.body || {};
        const User = require('../models/user');
        const user = await User.findOne({ phone }).catch(()=>null);
        if (!user) return res.status(404).json({ error: 'user not found' });
        const amt = Number(amount || 0);
        if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'invalid amount' });
        if (amt > (user.balance_tzs || 0)) return res.status(400).json({ error: 'insufficient balance' });
        // enforce minimum withdrawal
        if ((user.balance_tzs || 0) < 5000) return res.status(400).json({ error: 'minimum balance for withdrawal is TZS 5000' });
        user.balance_tzs = Number((user.balance_tzs || 0) - amt);
        user.withdrawn = Number((user.withdrawn || 0) + amt);
        await user.save();
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// admin: list users
router.get('/admin/users', verifyAdminToken, async (req, res) => {
    try {
        const User = require('../models/user');
        const users = await User.find().sort({ createdAt: -1 }).lean();
        res.json({ users });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// update user (admin): change language or referralCode or balance
router.put('/admin/user/:phone', verifyAdminToken, async (req, res) => {
    try {
        const { phone } = req.params;
        const { language, referralCode, balance_tzs } = req.body || {};
        const User = require('../models/user');
        const user = await User.findOne({ phone }).catch(()=>null);
        if (!user) return res.status(404).json({ error: 'user not found' });
        const update = {};
        if (typeof language !== 'undefined' && (language === 'en' || language === 'sw')) update.language = language;
        if (typeof referralCode !== 'undefined') update.referralCode = referralCode || null;
        if (typeof balance_tzs !== 'undefined') update.balance_tzs = Number(balance_tzs) || 0;
        if (!Object.keys(update).length) return res.status(400).json({ error: 'nothing to update' });
        const updated = await User.findOneAndUpdate({ phone }, { $set: update }, { new: true }).lean();
        res.json({ success: true, user: updated });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// set language for a user (admin) quickly
router.post('/admin/user/:phone/language', verifyAdminToken, async (req, res) => {
    try {
        const { phone } = req.params;
        const { language } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'phone required' });
        if (!language || (language !== 'en' && language !== 'sw')) return res.status(400).json({ error: 'language must be en or sw' });
        const User = require('../models/user');
        const user = await User.findOne({ phone }).catch(()=>null);
        if (!user) return res.status(404).json({ error: 'user not found' });
        user.language = language;
        await user.save();
        // update session if exists
        await Session.updateOne({ sessionId: phone }, { $set: { 'data.language': language } }).catch(()=>{});
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// Admin: create or update user (protected)
router.post('/admin/user', verifyAdminToken, async (req, res) => {
    try {
        const { phone, referred_by, language, balance_tzs, referralCode } = req.body || {};
        if (!phone) return res.status(400).json({ error: 'phone required' });
        const User = require('../models/user');
        let user = await User.findOne({ phone }).catch(()=>null);
        if (!user) {
            user = new User({ phone });
        }
        // apply provided fields
        if (typeof referred_by !== 'undefined') user.referred_by = referred_by || null;
        if (typeof language !== 'undefined' && (language === 'en' || language === 'sw')) user.language = language;
        if (typeof balance_tzs !== 'undefined') user.balance_tzs = Number(balance_tzs) || 0;
        if (typeof referralCode !== 'undefined') user.referralCode = referralCode || null;
        await user.save();
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// Admin: get single user by phone (protected)
router.get('/admin/user/:phone', verifyAdminToken, async (req, res) => {
    try {
        const { phone } = req.params;
        if (!phone) return res.status(400).json({ error: 'phone required' });
        const User = require('../models/user');
        const user = await User.findOne({ phone }).lean().catch(()=>null);
        if (!user) return res.status(404).json({ error: 'user not found' });
        res.json({ success: true, user });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

// Admin: delete user by phone (protected)
router.delete('/admin/user/:phone', verifyAdminToken, async (req, res) => {
    try {
        const { phone } = req.params;
        if (!phone) return res.status(400).json({ error: 'phone required' });
        const User = require('../models/user');
        const deleted = await User.findOneAndDelete({ phone }).lean().catch(()=>null);
        // remove session if exists
        await Session.deleteOne({ sessionId: phone }).catch(()=>{});
        if (!deleted) return res.status(404).json({ error: 'user not found' });
        res.json({ success: true, deleted });
    } catch (e) { res.status(500).json({ error: e && e.message }); }
});

module.exports = router;
