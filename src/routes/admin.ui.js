const express = require('express');
const router = express.Router();
const smm = require('../services/smmguo');

// Simple admin UI for browsing remote platforms and importing
router.get('/smm/import', async (req, res) => {
  const platforms = await smm.getPlatforms();
  res.send(`
    <html>
      <head><title>Import SMM Services</title></head>
      <body>
        <h1>Import SMM Services</h1>
        <div>
          <label for="platform">Platform:</label>
          <select id="platform" name="platform">
            ${platforms.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
          <button type="button" onclick="loadCategories()">Load Categories</button>
        </div>
        <div id="categories"></div>
        <div id="services"></div>
        <div>
          <button onclick="importSelected()">Import Selected Services</button>
        </div>
        <div id="result"></div>
        <script>
          async function jsonFetch(url, opts) {
            try { const res = await fetch(url, opts); const t = await res.json().catch(()=>null); return { ok: res.ok, data: t }; } catch (e) { return { ok:false, error: e.message } }
          }

          async function loadCategories() {
            const platform = document.getElementById('platform').value;
            const r = await jsonFetch('/admin/smm/platforms');
            // now call server side wrappers
            const catsR = await jsonFetch('/admin/smm/platforms/' + encodeURIComponent(platform) + '/categories');
            if (!catsR.ok) return document.getElementById('categories').innerText = 'Failed to load categories';
            const cats = catsR.data.categories || [];
            document.getElementById('categories').innerHTML = '<ul>' + cats.map(c => `<li><button onclick="loadServices(\'${c.id}\')">${c.name}</button></li>`).join('') + '</ul>';
          }

          async function loadServices(catId) {
            const platform = document.getElementById('platform').value;
            const r = await jsonFetch('/admin/smm/platforms/' + encodeURIComponent(platform) + '/categories/' + encodeURIComponent(catId) + '/services');
            if (!r.ok) return document.getElementById('services').innerText = 'Failed to load services';
            const sv = r.data.services || [];
            document.getElementById('services').innerHTML = '<ul>' + sv.map(s=>`<li><input type="checkbox" value="${s.id}" data-name="${s.name}"/> ${s.id} - ${s.name} ${s.price?(' - '+s.price):''}</li>`).join('') + '</ul>';
          }

          async function importSelected() {
            const checks = Array.from(document.querySelectorAll('#services input[type=checkbox]:checked'));
            if (!checks.length) return alert('select services');
            const platform = document.getElementById('platform').value;
            const payload = checks.map(c => ({ id: c.value, name: c.dataset.name }));
            const r = await jsonFetch('/admin/smm/import', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ platform: platform, services: payload }) });
            document.getElementById('result').innerText = JSON.stringify(r.data||r.error, null, 2);
          }
        </script>
      </body>
    </html>
  `);
});

module.exports = router;
