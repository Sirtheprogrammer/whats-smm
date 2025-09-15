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
            <style>
                body {
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 20px auto;
                    padding: 20px;
                }
                .qr-container {
                    text-align: center;
                    margin: 20px 0;
                }
                .status-container {
                    background: #f5f5f5;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                }
                .status-connected { color: green; }
                .status-disconnected { color: red; }
                .status-connecting { color: orange; }
                button {
                    padding: 10px 20px;
                    margin: 5px;
                    cursor: pointer;
                }
                #qrCode {
                    max-width: 300px;
                    margin: 20px auto;
                }
                .message-form {
                    margin: 20px 0;
                    padding: 15px;
                    background: #f9f9f9;
                    border-radius: 5px;
                }
                .message-form input, .message-form textarea {
                    width: 100%;
                    margin: 5px 0;
                    padding: 5px;
                }
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

            <div class="actions">
                <button onclick="connectBot()">Connect (generate QR)</button>
                <button onclick="logout()">Logout</button>
                <button onclick="checkStatus()">Refresh Status</button>
            </div>

            <script>
                let qrCheckInterval;

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

                function startQRCheck() {
                    checkQR();
                    qrCheckInterval = setInterval(checkQR, 5000);
                }

                function stopQRCheck() {
                    if (qrCheckInterval) { clearInterval(qrCheckInterval); qrCheckInterval = null; }
                }

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

                // Initial status check
                checkStatus();
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

module.exports = router;
