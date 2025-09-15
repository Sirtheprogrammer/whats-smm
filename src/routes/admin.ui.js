const express = require('express');
const router = express.Router();
const smm = require('../services/smmguo');

// Simple admin UI for browsing remote platforms and importing
router.get('/smm/import', async (req, res) => {
  const platforms = await smm.getPlatforms();
  res.send(`<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Import SMM Services</title>
        <style>
          body { font-family: Arial, sans-serif; max-width:900px; margin:20px auto; padding:20px }
          button { padding:6px 10px; margin:4px }
          #categories ul, #services ul { list-style:none; padding:0 }
        </style>
      </head>
      <body>
        <h1>Import SMM Services</h1>

        <div>
          <label for="platform">Platform:</label>
          <select id="platform" name="platform">
            ${platforms.map(p => ('<option value="' + p.id + '">' + p.name + '</option>')).join('')}
          </select>
          <button type="button" id="loadCategoriesBtn">Load Categories</button>
          <button type="button" id="importAllBtn">Import All For Platform</button>
        </div>

        <h3>Categories</h3>
        <div id="categories">(no categories loaded)</div>

        <h3>Services</h3>
        <div id="services">(no services loaded)</div>

        <div style="margin-top:12px">
          <button id="importSelectedBtn" disabled>Import Selected Services</button>
        </div>

        <h3>Result</h3>
        <pre id="result" style="background:#f6f8fa;padding:10px;border-radius:6px;max-height:240px;overflow:auto">Ready</pre>

        <script>
          // safe fetch helper
          async function jsonFetch(url, opts) {
            try {
              var res = await fetch(url, opts);
              var t = await res.json().catch(function(){return null});
              return { ok: res.ok, data: t };
            } catch (e) { return { ok:false, error: e.message } }
          }

          // expose to window
          window.loadCategories = async function() {
            document.getElementById('categories').textContent = 'Loading...';
            var platform = document.getElementById('platform').value;
            var r = await jsonFetch('/admin/smm/platforms/' + encodeURIComponent(platform) + '/categories');
            if (!r.ok) { document.getElementById('categories').textContent = 'Failed to load categories'; return; }
            var cats = (r.data && r.data.categories) || [];
            var container = document.getElementById('categories');
            container.innerHTML = '';
            if (!cats.length) { container.textContent = 'No categories'; return; }
            var ul = document.createElement('ul');
            cats.forEach(function(c){
              var li = document.createElement('li');
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.textContent = c.name || c.id;
              btn.addEventListener('click', function(){ window.loadServices(c.id); });
              li.appendChild(btn);
              ul.appendChild(li);
            });
            container.appendChild(ul);
          };

          window.loadServices = async function(categoryId) {
            document.getElementById('services').textContent = 'Loading...';
            var platform = document.getElementById('platform').value;
            var r = await jsonFetch('/admin/smm/platforms/' + encodeURIComponent(platform) + '/categories/' + encodeURIComponent(categoryId) + '/services');
            if (!r.ok) { document.getElementById('services').textContent = 'Failed to load services'; return; }
            var sv = (r.data && r.data.services) || [];
            var container = document.getElementById('services');
            container.innerHTML = '';
            if (!sv.length) { container.textContent = 'No services'; return; }
            var ul = document.createElement('ul');
            sv.forEach(function(s){
              var li = document.createElement('li');
              var cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.value = s.id || s.service || s.name;
              cb.dataset.name = s.name || '';
              var label = document.createElement('label');
              label.style.marginLeft = '6px';
              label.textContent = (s.id || '') + ' - ' + (s.name || '') + (s.price ? (' - ' + s.price) : '');
              li.appendChild(cb);
              li.appendChild(label);
              ul.appendChild(li);
            });
            container.appendChild(ul);
            // enable import selected button
            document.getElementById('importSelectedBtn').disabled = false;
          };

          window.importSelected = async function() {
            var checks = Array.from(document.querySelectorAll('#services input[type=checkbox]:checked'));
            if (!checks.length) { alert('select services'); return; }
            var platform = document.getElementById('platform').value;
            var payload = checks.map(function(c){ return { id: c.value, name: c.dataset.name }; });
            document.getElementById('result').textContent = 'Importing...';
            var r = await jsonFetch('/admin/smm/import', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ platform: platform, services: payload }) });
            document.getElementById('result').textContent = JSON.stringify(r.data || r.error, null, 2);
            // refresh categories/services state
            window.fetchResult = r;
          };

          // import all services for platform
          window.importAllForPlatform = async function() {
            if (!confirm('Import ALL remote services for selected platform? This may take time.')) return;
            var platform = document.getElementById('platform').value;
            document.getElementById('result').textContent = 'Importing all services for platform...';
            var r = await jsonFetch('/admin/smm/import', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ platform: platform }) });
            document.getElementById('result').textContent = JSON.stringify(r.data || r.error, null, 2);
          };

          // wire buttons
          document.getElementById('loadCategoriesBtn').addEventListener('click', function(){ window.loadCategories(); });
          document.getElementById('importSelectedBtn').addEventListener('click', function(){ window.importSelected(); });
          document.getElementById('importAllBtn').addEventListener('click', function(){ window.importAllForPlatform(); });
        </script>
      </body>
    </html>`);
});

module.exports = router;
