(function () {
  "use strict";
  var IMG = /^img\/[a-z0-9-]+\.jpg$/;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return s.toLowerCase().replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function price(p) { p = String(p || "").trim(); if (!p) return ""; return /^[\d.,]+$/.test(p) ? p.replace(".", ",") + " ₺" : p; }
  function thumb(p) { return p.replace(/\.jpg$/, "-k.jpg"); }
  function phone(p) { return String(p || "").replace(/[^\d+]/g, ""); }

  var menu = document.getElementById("menu"), lb = document.getElementById("lb");

  function render(d) {
    var groups = d.groups.filter(function (g) { return d.cats.some(function (c) { return c.group === g && c.items.some(function (i) { return i.on; }); }); });
    document.getElementById("chips").innerHTML = groups.map(function (g) { return '<a class="chip" href="#' + esc(slug(g)) + '">' + esc(g) + "</a>"; }).join("");
    var h = "";
    groups.forEach(function (g) {
      h += '<section class="group" id="' + esc(slug(g)) + '"><h2>' + esc(g) + "</h2>";
      d.cats.filter(function (c) { return c.group === g; }).forEach(function (c) {
        var its = c.items.filter(function (i) { return i.on; }); if (!its.length) return;
        h += '<div class="cat"><h3>' + esc(c.name) + "</h3>" + (c.desc ? '<p class="cdesc">' + esc(c.desc) + "</p>" : "") + '<ul class="items">';
        its.forEach(function (i) {
          var pr = price(i.price), img = typeof i.img === "string" && IMG.test(i.img) ? i.img : "";
          var txt = '<div class="row"><span class="nm">' + esc(i.name) + "</span>" + (pr ? '<span class="dots"></span><span class="pr">' + esc(pr) + "</span>" : "") + "</div>" + (i.desc ? '<p class="ds">' + esc(i.desc) + "</p>" : "");
          if (img) h += '<li class="item has-img"><button class="ph" type="button" data-full="' + esc(img) + '" data-name="' + esc(i.name) + '" aria-label="' + esc(i.name) + ' fotoğrafını büyüt"><img src="' + esc(thumb(img)) + '" alt="" width="64" height="64" loading="lazy" decoding="async"></button><div class="txt">' + txt + "</div></li>";
          else h += '<li class="item">' + txt + "</li>";
        });
        h += "</ul></div>";
      });
      h += "</section>";
    });
    menu.innerHTML = h;
    var inf = d.info || {}, f = "<div><strong>Simit Köşkü Fırın · Cafe</strong></div>";
    if (inf.address) f += "<div>" + esc(inf.address) + "</div>";
    if (inf.phone && phone(inf.phone)) f += '<div>Sipariş: <a href="tel:' + esc(phone(inf.phone)) + '"><strong>' + esc(inf.phone) + "</strong></a></div>";
    if (inf.instagram) f += '<div>Instagram: <a href="https://www.instagram.com/' + encodeURIComponent(inf.instagram) + '/" target="_blank" rel="noopener noreferrer">@' + esc(inf.instagram) + "</a></div>";
    f += '<div class="note">Fiyatı yazılmayan ürünler için lütfen kasaya sorunuz.</div>';
    document.getElementById("info").innerHTML = f;
    if (location.hash) { var t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
  }

  /* Görsel henüz yayına çıkmadıysa (ya da silindiyse) küçük resmi gizle */
  menu.addEventListener("error", function (e) { var t = e.target; if (t.tagName === "IMG") { var b = t.closest(".ph"); if (b) b.remove(); } }, true);

  /* Küçük resme dokununca büyük fotoğraf */
  menu.addEventListener("click", function (e) {
    var b = e.target.closest(".ph"); if (!b || !lb || !lb.showModal) return;
    var im = lb.querySelector("img"); im.src = b.dataset.full; im.alt = b.dataset.name || "";
    lb.querySelector("p").textContent = b.dataset.name || "";
    lb.showModal();
  });
  if (lb) lb.addEventListener("click", function () { lb.close(); });

  fetch("menu.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(render)
    .catch(function () { menu.innerHTML = '<p class="loading">Menü şu an yüklenemedi. Lütfen sayfayı yenileyin.</p>'; });
})();
