(function () {
  "use strict";
  /* Menü verisi bu sitenin GitHub deposundaki menu.json dosyasında, ürün görselleri img/ klasöründedir.
     Kaydet: değişiklikler (menu.json + yeni/silinen görseller) GitHub API ile tek bir commit olarak yayınlanır.
     Giriş anahtarı varsayılan olarak sadece bu sekmede tutulur; "beni hatırla" seçilirse bu tarayıcıda saklanır. */
  var KEY = "simit-menu-yonetim";
  var IMG = /^img\/[a-z0-9-]+\.jpg$/, MAX_IN = 25 * 1024 * 1024, FULL = 1200, THUMB = 240;
  var root = document.getElementById("root");

  /* Başka bir sitenin içine çerçeve olarak gömülürse (clickjacking) panel açılmaz */
  if (window.top !== window.self) { root.textContent = "Bu sayfa güvenlik nedeniyle başka bir sitenin içinde açılamaz."; return; }

  var cfg = load();
  var state = null, head = null, branch = null, dirty = false, busy = false, armed = null;
  var pending = {};   /* yol → { full: base64, thumb: base64 } — henüz yüklenmemiş görseller */
  var previews = {};  /* yol → blob: URL — yüklenene/yayına çıkana kadar önizleme */

  function load() {
    var c = {};
    try { c = JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "{}"); } catch (e) {}
    if (c.token && c.remember === undefined) c.remember = true; /* eski sürümde anahtar her zaman hatırlanıyordu */
    var host = location.hostname, m = host.match(/^([^.]+)\.github\.io$/i);
    if (!c.owner && m) c.owner = m[1];
    if (!c.repo && m) { var seg = location.pathname.split("/").filter(Boolean)[0]; c.repo = seg && !/\.html$/.test(seg) ? seg : host; }
    return c;
  }
  function saveCfg() {
    try {
      var s = JSON.stringify(cfg);
      if (cfg.remember) { localStorage.setItem(KEY, s); sessionStorage.removeItem(KEY); }
      else { sessionStorage.setItem(KEY, s); localStorage.setItem(KEY, JSON.stringify({ owner: cfg.owner, repo: cfg.repo })); }
    } catch (e) {}
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function rnd() { var a = new Uint8Array(5); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ("0" + x.toString(36)).slice(-2); }).join(""); }
  function thumbOf(p) { return p.replace(/\.jpg$/, "-k.jpg"); }
  function b64dec(b) { var bin = atob(b.replace(/\n/g, "")), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }

  function gh(method, path, body) {
    return fetch("https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) + path, {
      method: method,
      headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  function must(j, ok) { if ((ok || [200, 201]).indexOf(j._status) < 0) { var e = new Error("gh"); e.status = j._status; throw e; } return j; }
  function errText(st) {
    if (st === 401) return "Giriş anahtarı geçersiz ya da süresi dolmuş. Yeni bir anahtar oluşturup tekrar girin.";
    if (st === 403) return "Bu anahtarın menüyü değiştirme izni yok. Anahtarı oluştururken “Contents: Read and write” iznini verin.";
    if (st === 404) return "Depo ya da menu.json bulunamadı. Kullanıcı adı ve depo adını kontrol edin.";
    if (st === 409 || st === 422) return "Menü başka bir yerden değiştirilmiş. Sayfayı yenileyip değişikliklerinizi tekrar yapın.";
    if (!st) return "GitHub'a ulaşılamadı. Değişiklikleriniz duruyor; bağlantıyı kontrol edip tekrar kaydedin.";
    return "GitHub'a ulaşılamadı (kod " + st + "). İnternet bağlantısını kontrol edip tekrar deneyin.";
  }

  /* ---------- giriş ---------- */
  function renderLogin(msg) {
    root.innerHTML =
      '<div class="wrap login"><h1 class="login-title">Menü yönetimi</h1>' +
      '<div class="help">Menüyü düzenlemek için GitHub giriş anahtarınızı girin. Müşteriler bu sayfayı kullanamaz.' +
      '<ol><li>github.com → Settings → Developer settings → Fine-grained tokens → <b>Generate new token</b></li>' +
      '<li>Repository access: <b>Only select repositories</b> → sadece menünün deposunu seçin</li>' +
      '<li>Permissions → Repository → <b>Contents: Read and write</b> (başka izin vermeyin)</li>' +
      '<li>Expiration: en fazla <b>1 yıl</b> seçip oluşturun, çıkan anahtarı aşağıya yapıştırın</li></ol>' +
      'Anahtarı kimseyle paylaşmayın. Kaybolursa ya da şüphelenirseniz GitHub’dan silip yenisini oluşturun.</div>' +
      '<div class="f"><label for="owner">GitHub kullanıcı adı</label><input id="owner" autocomplete="username" value="' + esc(cfg.owner || "") + '"></div>' +
      '<div class="f"><label for="repo">Depo adı</label><input id="repo" value="' + esc(cfg.repo || "") + '"></div>' +
      '<div class="f"><label for="token">Giriş anahtarı (token)</label><input id="token" type="password" autocomplete="off" spellcheck="false" value=""></div>' +
      '<label class="chk"><input type="checkbox" id="remember"' + (cfg.remember ? " checked" : "") + '> Bu cihazda beni hatırla (sadece kendi telefonunuz / bilgisayarınızda)</label>' +
      '<div class="tools"><button class="btn primary" id="go" type="button">Giriş yap</button><a class="btn" href="./">Menüye dön</a></div>' +
      '<div class="status' + (msg ? " err" : "") + '" id="status" role="status">' + esc(msg || "") + "</div></div>";
    function go() {
      cfg.owner = document.getElementById("owner").value.trim();
      cfg.repo = document.getElementById("repo").value.trim();
      cfg.token = document.getElementById("token").value.trim() || cfg.token || "";
      cfg.remember = document.getElementById("remember").checked;
      if (!cfg.owner || !cfg.repo || !cfg.token) { renderLogin("Üç alanı da doldurun."); return; }
      if (!/^[A-Za-z0-9-]{1,39}$/.test(cfg.owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(cfg.repo)) { renderLogin("Kullanıcı adı ya da depo adı geçersiz."); return; }
      if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(cfg.token)) { cfg.token = ""; renderLogin("Giriş anahtarı hatalı görünüyor. github_pat_ ile başlayan anahtarın tamamını yapıştırın."); return; }
      saveCfg(); start();
    }
    document.getElementById("go").onclick = go;
    document.getElementById("token").addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }

  function logout(msg) {
    cfg.token = ""; cfg.remember = false;
    try { sessionStorage.removeItem(KEY); localStorage.setItem(KEY, JSON.stringify({ owner: cfg.owner, repo: cfg.repo })); } catch (e) {}
    state = null; renderLogin(msg || "");
  }

  function start() {
    root.innerHTML = '<div class="wrap login"><p class="loading">Menü yükleniyor…</p></div>';
    gh("GET", "").then(function (r) {
      must(r);
      if (r.permissions && !r.permissions.push) { var e = new Error("gh"); e.status = 403; throw e; }
      branch = r.default_branch;
      return gh("GET", "/git/ref/heads/" + encodeURI(branch));
    }).then(function (ref) {
      head = must(ref).object.sha;
      return gh("GET", "/contents/menu.json?ref=" + head);
    }).then(function (j) {
      state = JSON.parse(b64dec(must(j).content)); dirty = false; armed = null; render();
    }).catch(function (e) {
      if (e.status === 401) { logout(errText(401)); return; }
      renderLogin(errText(e.status));
    });
  }

  /* ---------- görsel işleme: tarayıcıda küçültülür, JPEG'e çevrilir (konum vb. EXIF bilgisi silinir) ---------- */
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { res({ im: im, url: u }); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); };
      im.src = u;
    });
  }
  function toJpeg(im, w, h, sx, sy, sw, sh, q) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"); x.fillStyle = "#24211C"; x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = "high"; x.drawImage(im, sx, sy, sw, sh, 0, 0, w, h);
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, "image/jpeg", q); });
  }
  function blobB64(b) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(",")[1]); }; r.onerror = rej; r.readAsDataURL(b); });
  }
  function processImage(file) {
    if (!file) return Promise.reject(new Error("none"));
    if (file.type && !/^image\/(jpeg|png|webp|heic|heif|gif|avif)$/i.test(file.type)) return Promise.reject(new Error("type"));
    if (file.size > MAX_IN) return Promise.reject(new Error("size"));
    return loadImage(file).then(function (o) {
      var im = o.im, W = im.naturalWidth, H = im.naturalHeight;
      URL.revokeObjectURL(o.url);
      if (!W || !H) throw new Error("decode");
      var s = Math.min(1, FULL / Math.max(W, H)), side = Math.min(W, H);
      return Promise.all([
        toJpeg(im, Math.round(W * s), Math.round(H * s), 0, 0, W, H, 0.82),
        toJpeg(im, THUMB, THUMB, (W - side) / 2, (H - side) / 2, side, side, 0.8)
      ]);
    }).then(function (b) {
      return Promise.all([blobB64(b[0]), blobB64(b[1])]).then(function (x) { return { full: x[0], thumb: x[1], preview: URL.createObjectURL(b[1]) }; });
    });
  }

  /* ---------- düzenleyici ---------- */
  var DIRTY = "Kaydedilmemiş değişiklik var. Müşteriler eski menüyü görüyor.";
  function touch() { dirty = true; setStatus(DIRTY, ""); var b = document.getElementById("save"); if (b) b.disabled = busy; }
  function setStatus(t, cls) { var el = document.getElementById("status"); if (el) { el.textContent = t; el.className = "status" + (cls ? " " + cls : ""); } }
  function validImg(p) { return typeof p === "string" && IMG.test(p); }

  function imgCell(it) {
    var p = validImg(it.img) ? it.img : "", src = p ? (previews[p] || "./" + thumbOf(p)) : "";
    return '<div class="aimg">' + (p ? '<img src="' + esc(src) + '" alt="" width="56" height="56">' : '<span class="noimg" aria-hidden="true">Görsel yok</span>') +
      '<div class="tools"><label class="btn small file">' + (p ? "Değiştir" : "+ Görsel") + '<input type="file" accept="image/*" data-k="img" aria-label="' + esc(it.name || "Ürün") + ' görseli seç"></label>' +
      (p ? '<button class="btn small danger" type="button" data-a="imgdel">Görseli kaldır</button>' : "") + "</div></div>";
  }

  function render() {
    var gopts = function (sel) { return state.groups.map(function (g) { return "<option" + (g === sel ? " selected" : "") + ">" + esc(g) + "</option>"; }).join(""); };
    var h = '<div class="abar"><div class="wrap"><h1>Menü yönetimi</h1>' +
      '<a class="btn" href="./" target="_blank" rel="noopener noreferrer">Menüyü gör</a>' +
      '<button class="btn primary" id="save" type="button"' + (dirty && !busy ? "" : " disabled") + ">Kaydet ve yayınla</button>" +
      '<button class="btn small" id="logout" type="button">Çıkış</button>' +
      '<div class="status" id="status" role="status"></div></div></div><div class="wrap">';
    h += '<div class="help">Fiyatı sadece sayı olarak yazın (ör. 25 veya 37,50); boş bırakılan fiyat menüde görünmez. “Satışta” kutusunu kaldırınca ürün menüden gizlenir ama silinmez. Ürün görseli için telefondan fotoğraf seçebilirsiniz; görsel otomatik küçültülür. <b>Kaydet ve yayınla</b>’ya bastıktan sonra menü 1–2 dakika içinde güncellenir.</div>';
    state.cats.forEach(function (c, ci) {
      var del = armed === "c" + c.id, cid = esc(c.id);
      h += '<section class="acat" data-c="' + cid + '"><div class="acat-head">' +
        '<div class="f"><label for="cn-' + cid + '">Kategori</label><input id="cn-' + cid + '" data-k="cname" value="' + esc(c.name) + '"></div>' +
        '<div class="f"><label for="cg-' + cid + '">Bölüm</label><select id="cg-' + cid + '" data-k="cgroup">' + gopts(c.group) + "</select></div>" +
        '<div class="tools"><button class="btn small" type="button" data-a="cup"' + (ci === 0 ? " disabled" : "") + ' aria-label="Kategoriyi yukarı taşı">↑</button>' +
        '<button class="btn small" type="button" data-a="cdown"' + (ci === state.cats.length - 1 ? " disabled" : "") + ' aria-label="Kategoriyi aşağı taşı">↓</button>' +
        '<button class="btn small danger' + (del ? " armed" : "") + '" type="button" data-a="cdel">' + (del ? "Emin misiniz? Sil" : "Kategoriyi sil") + "</button></div></div><div class=\"aitems\">";
      c.items.forEach(function (it, ii) {
        var idel = armed === "i" + it.id, iid = esc(it.id);
        h += '<div class="aitem' + (it.on ? "" : " off") + '" data-i="' + iid + '">' +
          '<div class="f"><label for="in-' + iid + '">Ürün adı</label><input id="in-' + iid + '" data-k="name" value="' + esc(it.name) + '"></div>' +
          '<div class="f ds-f"><label for="id-' + iid + '">Açıklama (isteğe bağlı)</label><input id="id-' + iid + '" data-k="desc" value="' + esc(it.desc) + '"></div>' +
          '<div class="f"><label for="ip-' + iid + '">Fiyat ₺</label><input id="ip-' + iid + '" data-k="price" inputmode="decimal" placeholder="—" value="' + esc(it.price) + '"></div>' +
          '<div class="tools"><label class="chk"><input type="checkbox" id="io-' + iid + '" data-k="on"' + (it.on ? " checked" : "") + "> Satışta</label>" +
          '<button class="btn small" type="button" data-a="iup"' + (ii === 0 ? " disabled" : "") + ' aria-label="Yukarı">↑</button>' +
          '<button class="btn small" type="button" data-a="idown"' + (ii === c.items.length - 1 ? " disabled" : "") + ' aria-label="Aşağı">↓</button>' +
          '<button class="btn small danger' + (idel ? " armed" : "") + '" type="button" data-a="idel">' + (idel ? "Emin misiniz?" : "Sil") + "</button></div>" +
          imgCell(it) + "</div>";
      });
      h += '</div><div><button class="btn small" type="button" data-a="iadd">+ Ürün ekle</button></div></section>';
    });
    h += '<div class="tools gap"><button class="btn" type="button" id="cadd">+ Kategori ekle</button></div>';
    var inf = state.info || (state.info = {});
    h += '<section class="acat"><div class="f"><label for="inf-phone">Sipariş telefonu</label><input id="inf-phone" data-k="phone" inputmode="tel" value="' + esc(inf.phone) + '"></div>' +
      '<div class="f"><label for="inf-address">Adres</label><input id="inf-address" data-k="address" value="' + esc(inf.address) + '"></div>' +
      '<div class="f"><label for="inf-instagram">Instagram kullanıcı adı</label><input id="inf-instagram" data-k="instagram" value="' + esc(inf.instagram) + '"></div></section></div>';
    root.innerHTML = h;
    if (dirty) setStatus(DIRTY, "");
  }

  function findCat(el) { var s = el.closest("[data-c]"); return s ? state.cats.find(function (c) { return c.id === s.dataset.c; }) : null; }
  function findItem(c, el) { var r = el.closest("[data-i]"); return r && c ? c.items.find(function (i) { return i.id === r.dataset.i; }) : null; }
  function move(a, i, d) { var j = i + d; if (j < 0 || j >= a.length) return; var t = a[i]; a[i] = a[j]; a[j] = t; }

  root.addEventListener("input", function (e) {
    if (!state) return; var el = e.target, k = el.dataset.k; if (!k || k === "img") return;
    if (k === "phone" || k === "address" || k === "instagram") { state.info[k] = k === "instagram" ? el.value.replace(/^@/, "").trim() : el.value; touch(); return; }
    var c = findCat(el); if (!c) return;
    if (k === "cname") { c.name = el.value; touch(); return; }
    if (k === "cgroup") { c.group = el.value; touch(); return; }
    var it = findItem(c, el); if (!it) return;
    if (k === "on") { it.on = el.checked; el.closest(".aitem").classList.toggle("off", !it.on); } else it[k] = el.value;
    touch();
  });
  root.addEventListener("change", function (e) {
    if (!state) return; var el = e.target;
    if (el.dataset.k === "cgroup") { var cg = findCat(el); if (cg) { cg.group = el.value; touch(); } return; }
    if (el.dataset.k !== "img") return;
    var c = findCat(el), it = findItem(c, el), file = el.files && el.files[0]; if (!it || !file) return;
    setStatus("Görsel hazırlanıyor…", "");
    processImage(file).then(function (r) {
      var p = "img/" + String(it.id).toLowerCase().replace(/[^a-z0-9]/g, "") + "-" + rnd() + ".jpg";
      pending[p] = { full: r.full, thumb: r.thumb }; previews[p] = r.preview;
      it.img = p; armed = null; touch(); render();
      setStatus("Görsel eklendi. Yayınlamak için “Kaydet ve yayınla”ya basın.", "");
    }).catch(function (err) {
      setStatus(err.message === "size" ? "Görsel çok büyük (en fazla 25 MB)." : "Bu dosya görsel olarak açılamadı. JPEG ya da PNG fotoğraf seçin.", "err");
      el.value = "";
    });
  });
  root.addEventListener("click", function (e) {
    if (!state) return; var t = e.target.closest("button"); if (!t) return;
    if (t.id === "save") { save(); return; }
    if (t.id === "logout") { if (dirty && !confirm("Kaydedilmemiş değişiklikler silinecek. Çıkılsın mı?")) return; dirty = false; logout(""); return; }
    if (t.id === "cadd") { state.cats.push({ id: uid("c"), group: state.groups[0], name: "Yeni kategori", desc: "", items: [{ id: uid("i"), name: "Yeni ürün", desc: "", price: "", on: true }] }); armed = null; touch(); render(); var l = root.querySelectorAll(".acat[data-c]"); l[l.length - 1].scrollIntoView({ block: "center" }); return; }
    var a = t.dataset.a; if (!a) return; var c = findCat(t); if (!c) return; var ci = state.cats.indexOf(c);
    if (a === "cup") move(state.cats, ci, -1);
    else if (a === "cdown") move(state.cats, ci, 1);
    else if (a === "cdel") { if (armed !== "c" + c.id) { armed = "c" + c.id; render(); return; } state.cats.splice(ci, 1); }
    else if (a === "iadd") { var n = { id: uid("i"), name: "", desc: "", price: "", on: true }; c.items.push(n); armed = null; touch(); render(); var inp = document.getElementById("in-" + n.id); if (inp) inp.focus(); return; }
    else { var it = findItem(c, t); if (!it) return; var ii = c.items.indexOf(it);
      if (a === "iup") move(c.items, ii, -1); else if (a === "idown") move(c.items, ii, 1);
      else if (a === "imgdel") delete it.img;
      else if (a === "idel") { if (armed !== "i" + it.id) { armed = "i" + it.id; render(); return; } c.items.splice(ii, 1); } }
    armed = null; touch(); render();
  });

  function clean() {
    var d = JSON.parse(JSON.stringify(state));
    d.cats.forEach(function (c) {
      c.name = String(c.name || "").trim() || "Kategori";
      c.items = c.items.filter(function (i) { return String(i.name || "").trim(); });
      c.items.forEach(function (i) {
        i.name = String(i.name).trim(); i.desc = String(i.desc || "").trim(); i.price = String(i.price || "").trim(); i.on = !!i.on;
        if (!validImg(i.img)) delete i.img;
      });
    });
    d.guncelleme = new Date().toISOString();
    return d;
  }

  function save() {
    if (busy) return; busy = true;
    var b = document.getElementById("save"); if (b) b.disabled = true;
    setStatus("Kaydediliyor…", "");
    var d = clean(), used = {}, tree = [], uploads = [];
    d.cats.forEach(function (c) { c.items.forEach(function (i) { if (i.img) { used[i.img] = 1; used[thumbOf(i.img)] = 1; } }); });
    tree.push({ path: "menu.json", mode: "100644", type: "blob", content: JSON.stringify(d, null, 1) });
    Object.keys(pending).forEach(function (p) {
      if (!used[p]) return;
      uploads.push([p, pending[p].full], [thumbOf(p), pending[p].thumb]);
    });
    var n = 0;
    Promise.all(uploads.map(function (u) {
      return gh("POST", "/git/blobs", { content: u[1], encoding: "base64" }).then(function (j) {
        must(j); tree.push({ path: u[0], mode: "100644", type: "blob", sha: j.sha });
        if (uploads.length) setStatus("Görseller yükleniyor… (" + (++n) + "/" + uploads.length + ")", "");
      });
    })).then(function () {
      /* Artık hiçbir ürünün kullanmadığı eski görselleri sil */
      return gh("GET", "/contents/img?ref=" + head).then(function (j) {
        if (j._status === 404) return; must(j);
        (Array.isArray(j) ? j : []).forEach(function (f) {
          if (f.type === "file" && /^img\//.test(f.path) && !used[f.path]) tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
        });
      });
    }).then(function () {
      return gh("GET", "/git/commits/" + head);
    }).then(function (cm) {
      return gh("POST", "/git/trees", { base_tree: must(cm).tree.sha, tree: tree });
    }).then(function (t) {
      return gh("POST", "/git/commits", { message: "Menü güncellendi", tree: must(t).sha, parents: [head] });
    }).then(function (cm) {
      var sha = must(cm).sha;
      return gh("PATCH", "/git/refs/heads/" + encodeURI(branch), { sha: sha, force: false }).then(function (r) { must(r); return sha; });
    }).then(function (sha) {
      busy = false; head = sha; pending = {}; state = d; dirty = false; armed = null; render();
      setStatus("Kaydedildi. Menü 1–2 dakika içinde güncellenecek.", "ok");
    }).catch(function (e) {
      busy = false;
      setStatus(errText(e.status), "err");
      var bb = document.getElementById("save"); if (bb) bb.disabled = false;
    });
  }

  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  if (cfg.owner && cfg.repo && cfg.token) start(); else renderLogin("");
})();
