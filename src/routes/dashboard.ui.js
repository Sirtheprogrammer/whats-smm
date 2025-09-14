const express = require('express');
const router = express.Router();

// Lightweight single-file admin dashboard
router.get('/dashboard', (req, res) => {
  res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CodeSkytz Admin Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1100px; margin: 20px auto; padding: 20px; }
    header { display:flex; justify-content:space-between; align-items:center }
    .panel { border:1px solid #eee; padding:15px; border-radius:6px; margin-bottom:12px; }
    .actions button { margin-right:8px; }
    #qr img { max-width:320px; }
    pre { background:#f6f8fa; padding:10px; border-radius:6px; overflow:auto }
    table { width:100%; border-collapse:collapse }
    th,td { border:1px solid #ddd; padding:8px }
  </style>
</head>
<body>
  <header>
    <h1>CodeSkytz — Admin Dashboard</h1>
    <div>
      <button onclick="refreshStatus()">Refresh Status</button>
      <button onclick="openImportUI()">Import UI</button>
    </div>
  </header>

  <section class="panel" id="connectionPanel">
    <h2>WhatsApp Connection</h2>
    <div class="actions">
      <button onclick="connect()">Connect (generate QR)</button>
      <button onclick="logout()">Logout</button>
      <button onclick="fetchQR()">Fetch QR</button>
    </div>
    <div id="status">Loading...</div>
    <div id="qr"></div>
  </section>

  <section class="panel" id="sendPanel">
    <h2>Send Message</h2>
    <input id="to" placeholder="Phone (e.g. 2557xxxxxxx)" style="width:300px" />
    <br/><br/>
    <textarea id="msg" rows="3" style="width:100%" placeholder="Message"></textarea>
    <br/>
    <button onclick="sendMessage()">Send</button>
    <div id="sendResult"></div>
  </section>

  <section class="panel" id="smmPanel">
    <h2>SMM Platforms (remote)</h2>
    <button onclick="syncPlatforms()">Sync Platforms</button>
    <div id="platforms"></div>
    <h3>Local Catalogue</h3>
    <button onclick="fetchCatalog()">Refresh Catalogue</button>
    <div id="catalog"></div>
  </section>

  <section class="panel" id="usersPanel">
    <h2>Users</h2>
    <button onclick="fetchUsers()">Refresh Users</button>
    <div id="users"></div>
  </section>

  <section class="panel" id="logsPanel">
    <h2>Quick Logs</h2>
    <button onclick="fetchLogs()">Refresh Logs</button>
    <pre id="logs">No logs yet.</pre>
  </section>

  <script>
    window.jsonFetch = async function(url, opts) {
      try {
        var res = await fetch(url, opts);
        var t = await res.json().catch(function(){return null;});
        return { ok: res.ok, data: t };
      } catch (e) { return { ok:false, error: e.message }; }
    };

    window.refreshStatus = async function() {
      var r = await window.jsonFetch('/admin/status');
      if (!r.ok) return document.getElementById('status').innerText = 'Error fetching status';
      var s = r.data;
      document.getElementById('status').innerHTML = 'Status: <strong>' + s.status + '</strong> - Connected: ' + s.isConnected + ' - Attempts: ' + s.reconnectAttempts;
      if (s.hasQR) window.fetchQR();
    };

    window.connect = async function() {
      var r = await window.jsonFetch('/admin/connect', { method:'POST' });
      if (r.ok && r.data) {
        document.getElementById('logs').innerText = 'Connect initiated.';
        if (r.data.qr) window.showQR(r.data.qr);
      } else {
        var errMsg = r.data && r.data.error ? r.data.error : (r.error || 'unknown');
        document.getElementById('logs').innerText = 'Connect failed: ' + errMsg;
      }
      window.refreshStatus();
    };

    window.fetchQR = async function() {
      var r = await window.jsonFetch('/admin/qr');
      if (r.ok && r.data && r.data.qr) window.showQR(r.data.qr);
      else document.getElementById('qr').innerHTML = '<em>No QR available</em>';
    };

    window.showQR = function(dataUrl) {
      document.getElementById('qr').innerHTML = '<img src="'+dataUrl+'" alt="qr"/>';
      document.getElementById('logs').innerText = 'QR updated. Scan with WhatsApp.';
    };

    window.logout = async function() {
      var r = await window.jsonFetch('/admin/logout', { method:'POST' });
      document.getElementById('logs').innerText = r.ok ? 'Logged out' : 'Logout failed';
      window.refreshStatus();
    };

    window.sendMessage = async function() {
      var to = document.getElementById('to').value;
      var msg = document.getElementById('msg').value;
      if (!to || !msg) return alert('provide to and message');
      var r = await window.jsonFetch('/admin/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ to: to, message: msg }) });
      document.getElementById('sendResult').innerText = r.ok ? 'Sent' : 'Failed: ' + JSON.stringify(r.data || r.error);
    };

    window.syncPlatforms = async function() {
      var r = await window.jsonFetch('/admin/smm/sync', { method:'POST' });
      if (r.ok) {
        var plats = r.data.platforms || [];
        var ul = document.createElement('ul');
        for (var i=0;i<plats.length;i++){
          var p = plats[i];
          var li = document.createElement('li');
          li.textContent = p.id + ' - ' + p.name + ' ';
          var btn = document.createElement('button');
          btn.textContent = 'Import';
          btn.dataset.platform = p.name || p.id;
          (function(platform){ btn.addEventListener('click', function(){ window.importPlatform(platform); }); })(btn.dataset.platform);
          li.appendChild(btn);
          ul.appendChild(li);
        }
        var container = document.getElementById('platforms');
        container.innerHTML = '';
        container.appendChild(ul);
      } else document.getElementById('platforms').innerText = 'Sync failed';
    };

    window.importPlatform = async function(name) {
      var r = await window.jsonFetch('/admin/smm/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ platform: name }) });
      document.getElementById('logs').innerText = JSON.stringify(r.data || r.error, null, 2);
      window.fetchCatalog();
    };

    window.fetchCatalog = async function() {
      var r = await window.jsonFetch('/admin/smm/catalog');
      if (!r.ok) return document.getElementById('catalog').innerText = 'Failed to load catalog';
      var items = (r.data && r.data.services) || [];
      if (!items.length) return document.getElementById('catalog').innerText = 'No services imported yet';
      var rows = '';
      for (var i=0;i<items.length;i++){
        var it = items[i];
        rows += '<tr><td>' + (it.serviceId || '') + '</td><td>' + (it.platform || '') + '</td><td>' + (it.category||'') + '</td><td>' + (it.name || '') + '</td><td>' + (it.price||'') + '</td></tr>';
      }
      document.getElementById('catalog').innerHTML = '<table><tr><th>id</th><th>platform</th><th>category</th><th>name</th><th>price</th></tr>' + rows + '</table>';
    };

    window.fetchUsers = async function() {
      var r = await window.jsonFetch('/admin/users');
      if (!r.ok) return document.getElementById('users').innerText = 'Failed to load users';
      var users = (r.data && r.data.users) || [];
      if (!users.length) return document.getElementById('users').innerText = 'No users';
      var html = '<ul>';
      for (var i=0;i<users.length;i++){
        var u = users[i]; html += '<li>' + u.sessionId + ' - last: ' + (u.lastSeen||'') + '</li>';
      }
      html += '</ul>';
      document.getElementById('users').innerHTML = html;
    };

    window.fetchLogs = async function() {
      var r = await window.jsonFetch('/admin/logs');
      if (!r.ok) return document.getElementById('logs').innerText = 'Failed to load logs';
      var logs = (r.data && r.data.logs) || [];
      document.getElementById('logs').innerText = JSON.stringify(logs, null, 2);
    };

    window.openImportUI = function() { window.location.href = '/admin/ui/smm/import'; };

    // initial load
    window.refreshStatus();
    window.fetchCatalog();
    window.fetchUsers();
    window.fetchLogs();
  </script>
</body>
</html>
  `);
});

module.exports = router;
