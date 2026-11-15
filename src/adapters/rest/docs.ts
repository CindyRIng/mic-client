/**
 * Self-contained API docs page (docs/03 §2.3, ADR-0008).
 *
 * No external CDN, fonts, or scripts: the page fetches `/openapi.json` (same
 * origin) and renders endpoint documentation plus a browser "Try it" panel.
 * Works offline and does not touch the upstream unless the user clicks Try it.
 */
export function renderDocsHtml(openapiUrl = '/openapi.json'): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MIC Client · REST API Docs</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230f766e'/%3E%3Ctext x='32' y='43' font-size='30' text-anchor='middle' fill='white' font-family='monospace'%3EM%3C/text%3E%3C/svg%3E">
<style>
  :root {
    --bg: #f6f8fb; --card: #ffffff; --ink: #0f172a; --muted: #5b6b82; --line: #dbe3ee;
    --accent: #0f766e; --accent-2: #0d9488; --code: #0b1220; --code-ink: #dbeafe;
    --get: #065f46; --post: #7c2d12; --warn: #b45309; --ok: #047857; --err: #b91c1c;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--ink);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header.hero {
    background: linear-gradient(135deg, #062f2b 0%, #0f766e 55%, #0e7490 100%);
    color: #f0fdfa; padding: 26px 30px 22px;
  }
  header.hero h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .2px; }
  header.hero .sub { color: #b9f3ea; font-size: 13px; }
  header.hero .banner-links { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
  header.hero .banner-links a {
    color: #ecfeff; border: 1px solid rgba(236,254,255,.35); background: rgba(255,255,255,.08);
    padding: 4px 10px; border-radius: 999px; font-size: 12px;
  }
  header.hero .banner-links a:hover { background: rgba(255,255,255,.16); text-decoration: none; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 22px 40px; }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
    margin: 18px 0 10px; padding: 12px 14px; background: var(--card);
    border: 1px solid var(--line); border-radius: 12px;
  }
  .toolbar input[type=search] {
    flex: 1 1 260px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px;
    font-size: 14px; outline: none; background: #fff;
  }
  .toolbar input[type=search]:focus { border-color: var(--accent-2); box-shadow: 0 0 0 3px rgba(13,148,136,.15); }
  .toolbar .base { color: var(--muted); font-size: 12px; }
  .toolbar .base b { color: var(--ink); }
  .stats { color: var(--muted); font-size: 12px; padding: 4px 2px 12px; }
  section.tag { margin: 22px 0 8px; }
  section.tag > h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 10px; }
  details.op {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    margin: 0 0 10px; overflow: hidden;
  }
  details.op[open] { box-shadow: 0 6px 20px rgba(15,23,42,.06); }
  details.op > summary {
    cursor: pointer; list-style: none; padding: 12px 14px; display: flex; gap: 10px;
    align-items: baseline; flex-wrap: wrap; user-select: none;
  }
  details.op > summary::-webkit-details-marker { display: none; }
  details.op > summary .path { font-weight: 600; font-size: 14px; }
  details.op > summary .summary { color: var(--muted); font-size: 13px; }
  .method {
    display: inline-block; min-width: 52px; text-align: center; padding: 2px 8px; border-radius: 6px;
    color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .06em; font-family: ui-monospace, monospace;
  }
  .method.get { background: var(--get); }
  .method.post { background: var(--post); }
  .op-body { border-top: 1px solid var(--line); padding: 6px 16px 18px; }
  .op-body p.desc { color: #334155; white-space: pre-wrap; }
  h3.small { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 16px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; background: #fafcff; }
  td .mono { font-size: 12.5px; }
  .type { color: #7c3aed; font-family: ui-monospace, monospace; font-size: 12px; }
  .req { color: var(--err); font-weight: 600; font-size: 12px; }
  .opt { color: var(--muted); font-size: 12px; }
  .schema-name { color: var(--accent); font-family: ui-monospace, monospace; font-size: 12.5px; }
  pre.block {
    background: var(--code); color: var(--code-ink); border-radius: 10px; padding: 12px 14px;
    overflow: auto; font-size: 12.5px; line-height: 1.5; margin: 6px 0 0; max-height: 320px;
  }
  .try { margin-top: 10px; border: 1px dashed #b6c2d4; border-radius: 10px; padding: 10px 12px; background: #fbfdff; }
  .try .row { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 6px 0; align-items: center; }
  .try label { font-size: 12.5px; color: #334155; display: flex; gap: 6px; align-items: center; }
  .try input[type=text], .try textarea {
    border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; font-size: 13px; min-width: 160px;
    font-family: ui-monospace, monospace;
  }
  .try textarea { width: 100%; min-height: 74px; }
  .try button {
    cursor: pointer; border: 0; border-radius: 8px; padding: 7px 14px; font-size: 13px;
    color: #fff; background: var(--accent); font-weight: 600;
  }
  .try button:hover { background: var(--accent-2); }
  .try button:disabled { opacity: .6; cursor: wait; }
  .result { margin-top: 8px; }
  .status { font-family: ui-monospace, monospace; font-size: 12.5px; font-weight: 700; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }
  .hint { color: var(--muted); font-size: 12px; }
  footer.foot {
    margin-top: 34px; padding-top: 14px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px 18px;
  }
  .hidden { display: none !important; }
</style>
</head>
<body>
<header class="hero">
  <h1>MIC Client · REST API Docs</h1>
  <div class="sub">Made-in-China local client · loopback-only · unified envelope <code>{ok,data,meta}</code> / <code>{ok,error,meta}</code></div>
  <div class="banner-links">
    <a href="${openapiUrl}">OpenAPI JSON</a>
    <a href="https://github.com/CindyRIng/mic-client/blob/main/docs/03-rest-api.md" target="_blank" rel="noreferrer">docs/03 REST 契约</a>
    <a href="/health">/health</a>
    <a href="https://github.com/CindyRIng/mic-client" target="_blank" rel="noreferrer">GitHub</a>
  </div>
</header>
<div class="wrap">
  <div class="toolbar">
    <input id="filter" type="search" placeholder="过滤端点（例如 search / company / 中文说明）…">
    <div class="base">Base URL <b id="base">…</b></div>
    <div class="stats" id="count"></div>
  </div>
  <main id="app"><p class="hint">Loading ${openapiUrl} …</p></main>
  <footer class="foot">
    <span>ADR-0008：自描述文档端点（辅助，非业务 API 契约）。</span>
    <span>只读、无鉴权、不访问上游；仅监听回环地址。</span>
    <span>Try it 会真实请求本机服务（搜索/详情可能触发上游请求与缓存写入）。</span>
  </footer>
</div>
<script>
(function () {
  'use strict';
  var SPEC_URL = ${JSON.stringify(openapiUrl)};
  var app = document.getElementById('app');
  var filter = document.getElementById('filter');
  var baseEl = document.getElementById('base');
  var countEl = document.getElementById('count');
  var spec = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function typeOf(schema) {
    if (!schema) return 'any';
    if (schema.$ref) return schema.$ref.split('/').pop();
    if (schema.oneOf) return schema.oneOf.map(typeOf).join(' | ');
    var t = schema.type;
    if (Array.isArray(t)) return t.join(' | ');
    if (t === 'array') return 'array<' + typeOf(schema.items) + '>';
    if (schema.enum) return (t || 'enum') + ' · ' + schema.enum.slice(0, 6).join(' | ') + (schema.enum.length > 6 ? ' …' : '');
    return t || 'any';
  }
  function exampleOf(schema, schemas, depth) {
    depth = depth || 0;
    if (!schema || depth > 5) return null;
    if (schema.$ref) {
      var name = schema.$ref.split('/').pop();
      return exampleOf(schemas[name], schemas, depth + 1);
    }
    if (schema.oneOf && schema.oneOf.length) return exampleOf(schema.oneOf[0], schemas, depth + 1);
    if (schema.const !== undefined) return schema.const;
    if (schema.enum && schema.enum.length) return schema.enum[0];
    if (schema.default !== undefined) return schema.default;
    var type = schema.type;
    if (Array.isArray(type)) type = type.filter(function (x) { return x !== 'null'; })[0];
    if (type === 'object' || schema.properties) {
      var out = {};
      var props = schema.properties || {};
      for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k)) out[k] = exampleOf(props[k], schemas, depth + 1);
      }
      return out;
    }
    if (type === 'array') return [exampleOf(schema.items, schemas, depth + 1)];
    if (type === 'integer' || type === 'number') return 0;
    if (type === 'boolean') return true;
    if (type === 'string') return schema.examples && schema.examples[0] ? schema.examples[0] : '';
    return null;
  }
  function paramRow(p) {
    return '<tr><td class="mono">' + esc(p.name) + '</td><td>' + esc(p['in']) + '</td>' +
      '<td class="type">' + esc(typeOf(p.schema)) + '</td>' +
      '<td>' + (p.required ? '<span class="req">必填</span>' : '<span class="opt">可选</span>') + '</td>' +
      '<td>' + esc(p.description || '') + '</td></tr>';
  }
  function renderOp(path, method, op) {
    var id = method + '_' + path.replace(/[^a-zA-Z0-9]+/g, '_');
    var params = op.parameters || [];
    var body = op.requestBody;
    var html = '';
    html += '<details class="op" data-search="' + esc((method + ' ' + path + ' ' + (op.summary || '') + ' ' + (op.description || '')).toLowerCase()) + '">';
    html += '<summary><span class="method ' + esc(method) + '">' + esc(method.toUpperCase()) + '</span>' +
      '<span class="path mono">' + esc(path) + '</span>' +
      '<span class="summary">' + esc(op.summary || '') + '</span></summary>';
    html += '<div class="op-body">';
    if (op.description) html += '<p class="desc">' + esc(op.description) + '</p>';
    if (params.length) {
      html += '<h3 class="small">Parameters</h3><table><thead><tr><th>名称</th><th>位置</th><th>类型</th><th>必填</th><th>说明</th></tr></thead><tbody>';
      params.forEach(function (p) { html += paramRow(p); });
      html += '</tbody></table>';
    }
    if (body) {
      var bodySchema = body.content && body.content['application/json'] ? body.content['application/json'].schema : body;
      html += '<h3 class="small">Request body</h3>';
      html += '<div class="hint">' + esc(typeOf(bodySchema)) + (body.required ? ' · required' : '') + '</div>';
      html += '<pre class="block">' + esc(JSON.stringify(exampleOf(bodySchema, spec.components.schemas), null, 2)) + '</pre>';
    }
    var responses = op.responses || {};
    html += '<h3 class="small">Responses</h3><table><thead><tr><th>状态</th><th>说明</th><th>Schema</th></tr></thead><tbody>';
    Object.keys(responses).forEach(function (code) {
      var r = responses[code] || {};
      var schema = r.content && r.content['application/json'] ? r.content['application/json'].schema : null;
      html += '<tr><td class="mono">' + esc(code) + '</td><td>' + esc(r.description || '') + '</td>' +
        '<td class="schema-name">' + esc(schema ? typeOf(schema) : '-') + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="try" data-id="' + esc(id) + '">';
    html += '<div class="hint">Try it（相对当前页面发起真实请求；搜索/详情可能访问上游）</div>';
    params.forEach(function (p) {
      var inputType = p.schema && (p.schema.type === 'boolean' || p.schema.enum) ? 'text' : 'text';
      html += '<div class="row"><label>' + esc(p.name) + (p.required ? ' *' : '') +
        ' <input type="' + inputType + '" data-param="' + esc(p.name) + '" placeholder="' + esc(typeOf(p.schema)) + '"></label></div>';
    });
    if (body) {
      html += '<div class="row"><textarea data-body placeholder="JSON body">' +
        esc(JSON.stringify(exampleOf(body.content['application/json'].schema, spec.components.schemas), null, 2)) + '</textarea></div>';
    }
    html += '<div class="row"><button type="button" data-run="' + esc(id) + '">发送请求</button>' +
      '<span class="hint" data-url="' + esc(id) + '"></span></div>';
    html += '<div class="result" data-result="' + esc(id) + '"></div>';
    html += '</div>';
    html += '</div></details>';
    return html;
  }
  function render() {
    var tags = (spec.tags || []).map(function (t) { return t.name; });
    var known = {}; tags.forEach(function (t) { known[t] = true; });
    var groups = {};
    Object.keys(spec.paths).forEach(function (path) {
      var item = spec.paths[path];
      Object.keys(item).forEach(function (method) {
        var op = item[method];
        var tag = (op.tags && op.tags[0]) || 'Other';
        if (!known[tag]) { known[tag] = true; tags.push(tag); }
        if (!groups[tag]) groups[tag] = [];
        groups[tag].push({ path: path, method: method, op: op });
      });
    });
    var html = '';
    tags.forEach(function (tag) {
      var list = groups[tag];
      if (!list || !list.length) return;
      html += '<section class="tag" data-tag="' + esc(tag) + '"><h2>' + esc(tag) + '</h2>';
      list.forEach(function (x) { html += renderOp(x.path, x.method, x.op); });
      html += '</section>';
    });
    app.innerHTML = html;
    countEl.textContent = Object.keys(spec.paths).length + ' endpoints · ' + Object.keys(spec.components.schemas).length + ' schemas';
    var baseText = spec.servers && spec.servers[0] ? spec.servers[0].url : location.origin;
    // Requests are issued relative to this page; show the live origin and keep the
    // documented default in the tooltip (server may run on a non-default port).
    baseEl.textContent = location.origin;
    baseEl.title = 'OpenAPI servers[0]: ' + baseText;
    wire();
  }
  function wire() {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      var ops = app.querySelectorAll('details.op');
      var shown = 0;
      for (var i = 0; i < ops.length; i++) {
        var el = ops[i];
        var hit = !q || (el.getAttribute('data-search') || '').indexOf(q) >= 0;
        el.classList.toggle('hidden', !hit);
        if (hit) shown++;
      }
      var sections = app.querySelectorAll('section.tag');
      for (var j = 0; j < sections.length; j++) {
        var visible = sections[j].querySelectorAll('details.op:not(.hidden)').length > 0;
        sections[j].classList.toggle('hidden', !visible);
      }
      countEl.textContent = shown + ' / ' + ops.length + ' endpoints shown';
    });
    var runs = app.querySelectorAll('button[data-run]');
    for (var r = 0; r < runs.length; r++) {
      runs[r].addEventListener('click', function (ev) {
        var btn = ev.currentTarget;
        doRun(btn.getAttribute('data-run'), btn);
      });
    }
  }
  function doRun(id, btn) {
    var box = app.querySelector('.try[data-id="' + id + '"]');
    if (!box) return;
    var op = findOp(id);
    if (!op) return;
    var path = op.path;
    var inputs = box.querySelectorAll('[data-param]');
    var query = [];
    for (var i = 0; i < inputs.length; i++) {
      var name = inputs[i].getAttribute('data-param');
      var val = inputs[i].value.trim();
      if (!val) continue;
      var p = (op.op.parameters || []).filter(function (x) { return x.name === name; })[0] || {};
      if (p['in'] === 'path') path = path.replace('{' + name + '}', encodeURIComponent(val));
      else query.push(encodeURIComponent(name) + '=' + encodeURIComponent(val));
    }
    if (path.indexOf('{') >= 0) {
      var miss = path.match(/\{([^}]+)\}/);
      showResult(id, null, null, '缺少路径参数 ' + (miss ? miss[1] : ''));
      return;
    }
    var url = path + (query.length ? '?' + query.join('&') : '');
    var method = op.method.toUpperCase();
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    var bodyEl = box.querySelector('[data-body]');
    if (bodyEl && bodyEl.value.trim()) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = bodyEl.value;
    }
    var urlEl = box.querySelector('[data-url]');
    if (urlEl) urlEl.textContent = (method + ' ' + url).slice(0, 140);
    btn.disabled = true;
    var started = performance.now();
    fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var ms = Math.round(performance.now() - started);
        var pretty = text;
        try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* keep raw */ }
        showResult(id, res.status, ms, pretty);
      });
    }).catch(function (err) {
      showResult(id, null, null, '请求失败：' + (err && err.message ? err.message : err));
    }).finally(function () { btn.disabled = false; });
  }
  function findOp(id) {
    var found = null;
    Object.keys(spec.paths).forEach(function (path) {
      var item = spec.paths[path];
      Object.keys(item).forEach(function (method) {
        if (method + '_' + path.replace(/[^a-zA-Z0-9]+/g, '_') === id) found = { path: path, method: method, op: item[method] };
      });
    });
    return found;
  }
  function showResult(id, status, ms, text) {
    var el = app.querySelector('[data-result="' + id + '"]');
    if (!el) return;
    var cls = status && status >= 200 && status < 300 ? 'ok' : 'err';
    var label = status ? ('HTTP ' + status + (ms != null ? ' · ' + ms + 'ms' : '')) : '客户端错误';
    el.innerHTML = '<div class="status ' + cls + '">' + esc(label) + '</div><pre class="block">' + esc(text) + '</pre>';
  }
  fetch(SPEC_URL, { headers: { Accept: 'application/json' } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (s) { spec = s; render(); })
    .catch(function (e) {
      app.innerHTML = '<p class="hint">无法加载 OpenAPI 文档（' + esc(e && e.message ? e.message : e) + '）。请确认服务正在运行。</p>';
    });
})();
</script>
</body>
</html>`;
}
