const axios = require('axios');

const API_URL = process.env.SMMGUO_API_URL || 'https://smmguo.com/api/v2';
const API_KEY = process.env.SMMGUO_API_KEY || '';

// simple in-memory cache: key -> { ts, ttl, value }
const cache = new Map();

function setCache(key, value, ttl = 600) { // ttl seconds (default 10 min)
  cache.set(key, { ts: Date.now(), ttl: ttl * 1000, value });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) { cache.delete(key); return null; }
  return entry.value;
}

async function apiPost(body) {
  const res = await axios.post(API_URL, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return res.data;
}

async function fetchAllRemoteServices() {
  const cached = getCache('all_services');
  if (cached) return cached;
  try {
    const body = { key: API_KEY, action: 'services' };
    const resp = await apiPost(body);
    // resp may be array or object with 'data'
    const arr = Array.isArray(resp) ? resp : (Array.isArray(resp.data) ? resp.data : []);
    setCache('all_services', arr, 600);
    return arr;
  } catch (err) {
    return [];
  }
}

async function getPlatforms() {
  const cached = getCache('platforms');
  if (cached) return cached;

  try {
    const all = await fetchAllRemoteServices();
    // derive platforms by 'category' or by parsing 'name'
    const platformsMap = new Map();
    all.forEach(s => {
      const platform = s.category || s.service_type || s.name && (s.name.split(/\s|\//)[0]) || 'Other';
      if (!platformsMap.has(platform)) platformsMap.set(platform, { id: platform, name: platform });
    });
    const platforms = Array.from(platformsMap.values());
    if (!platforms.length) throw new Error('no platforms');
    setCache('platforms', platforms, 600);
    return platforms;
  } catch (err) {
    const platforms = [
      { id: 'Instagram', name: 'Instagram' },
      { id: 'Twitter', name: 'Twitter / X' },
      { id: 'YouTube', name: 'YouTube' },
      { id: 'TikTok', name: 'TikTok' },
      { id: 'Telegram', name: 'Telegram' }
    ];
    setCache('platforms', platforms, 60);
    return platforms;
  }
}

async function getCategories(platformId) {
  const key = `categories:${platformId}`;
  const cached = getCache(key);
  if (cached) return cached;
  const all = await fetchAllRemoteServices();
  // Filter services by platformId presence in category/service fields
  const categoriesSet = new Map();
  all.forEach(s => {
    // determine platform key
    const platform = s.category || s.service_type || (s.name && s.name.split(/\s|\//)[0]) || 'Other';
    if (String(platform).toLowerCase().includes(String(platformId).toLowerCase())) {
      const cat = s.category2 || s.subcategory || s.category || 'General';
      if (!categoriesSet.has(cat)) categoriesSet.set(cat, { id: cat, name: cat });
    }
  });
  const categories = Array.from(categoriesSet.values());
  setCache(key, categories, 600);
  return categories.length ? categories : [{ id: 'general', name: 'General' }];
}

async function getServices(categoryId, platformId) {
  const key = `services:${platformId || 'all'}:${categoryId}`;
  const cached = getCache(key);
  if (cached) return cached;
  const all = await fetchAllRemoteServices();
  const services = all.filter(s => {
    const cat = s.category2 || s.subcategory || s.category || 'General';
    const platform = s.category || s.service_type || (s.name && s.name.split(/\s|\//)[0]) || '';
    const catMatch = String(cat).toLowerCase().includes(String(categoryId).toLowerCase()) || String(cat) === categoryId;
    const platformMatch = !platformId || String(platform).toLowerCase().includes(String(platformId).toLowerCase()) || String(platform) === platformId;
    return catMatch && platformMatch;
  }).map(s => ({ id: s.service || s.id || s.name, name: s.name || s.service || ('Service ' + (s.service || s.id)), price: s.price || null, raw: s }));

  // Provide a sensible default sample service if none are found (useful for dev/tests without remote API)
  if (!services.length) {
    const sample = [{ id: 'sample-1', name: 'Sample Service', price: 1.0, raw: { service: 'sample-1', name: 'Sample Service' } }];
    setCache(key, sample, 60);
    return sample;
  }

  setCache(key, services, 600);
  return services;
}

async function fetchAllServicesForPlatform(platformId) {
  const all = await fetchAllRemoteServices();
  return all.filter(s => {
    const platform = s.category || s.service_type || (s.name && s.name.split(/\s|\//)[0]) || '';
    return String(platform).toLowerCase().includes(String(platformId).toLowerCase()) || String(platform) === platformId;
  }).map(s => ({ id: s.service || s.id || s.name, name: s.name || s.service || ('Service ' + (s.service || s.id)), price: s.price || null, raw: s }));
}

// create order: uses the SMM provider 'add' action
async function createOrder(params) {
  // expected params: { service, link, quantity, runs?, interval?, buyer_name?, buyer_phone?, buyer_email? }
  const body = {
    key: API_KEY,
    action: 'add',
    service: params.service,
    link: params.link,
    quantity: params.quantity,
  };
  // optional fields
  if (params.runs) body.runs = params.runs;
  if (params.interval) body.interval = params.interval;
  if (params.buyer_name) body.buyer_name = params.buyer_name;
  if (params.buyer_phone) body.buyer_phone = params.buyer_phone;
  if (params.buyer_email) body.buyer_email = params.buyer_email;

  try {
    const resp = await apiPost(body);
    // return raw provider response
    return resp;
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function getServiceById(id) {
  if (!id) return null;
  const all = await fetchAllRemoteServices();
  const match = all.find(s => String(s.service || s.id || s.name) === String(id));
  if (!match) return null;
  return match;
}

module.exports = {
  getPlatforms,
  getCategories,
  getServices,
  fetchAllServicesForPlatform,
  createOrder,
  getServiceById
};
