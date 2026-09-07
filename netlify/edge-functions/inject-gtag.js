// PR Portable Cooling - conversion edge function
// 1. Extracts base64 images out of the HTML so the page ships ~100KB instead of 3.5MB
// 2. Adds WhatsApp + quick-quote to the existing sticky bar, and shows that bar on desktop
// 3. Drops the dead AW_CONVERSION_ID script request
// 4. Keeps the working AW-18276254764 tag and tel: conversion tracking

const PHONE = "17878780878";
const AW_ID = "AW-18276254764";
const CALL_LABEL = "qIANCIz86t4cEKyI5opE";

// Shared by the rewriter and the image server - they MUST stay identical
// so that image index N in the HTML resolves to image index N on disk.
const IMG_RE = /(<img\b[^>]*?\bsrc=")data:image\/([a-zA-Z0-9+.\-]+);base64,([^"]+)(")/g;

// Same idea for images embedded in CSS via url(data:...). Indexed separately
// under a "c" prefix so the two sequences can never collide.
const CSS_RE = /url\(\s*['"]?data:image\/([a-zA-Z0-9+.\-]+);base64,([^)'"\s]+)['"]?\s*\)/g;

export default async (request, context) => {
  const url = new URL(request.url);

  // Raw passthrough. The image handler calls back into the site with ?__raw=1
  // to get the untransformed HTML without recursing through the rewriter.
  if (url.searchParams.has("__raw")) {
    return await context.next();
  }

  if (url.pathname.startsWith("/_img/")) {
    try {
      return await serveImage(url);
    } catch (e) {
      return new Response("image error", { status: 404 });
    }
  }

  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  let html;
  try {
    html = await res.text();
  } catch (e) {
    return res;
  }

  let out;
  try {
    out = transform(html, url.pathname);
  } catch (e) {
    out = html; // never break the live page over a transform bug
  }

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(out, { status: res.status, headers });
};

function transform(html, pathname) {
  const p = encodeURIComponent(pathname || "/");
  let i = -1;

  let out = html.replace(IMG_RE, (m, pre, ext, data, post) => {
    i++;
    const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
    let tag = pre + "/_img/" + i + "." + e + "?p=" + p + post;

    if (i < 2) {
      // Above the fold: must not be lazy, or the largest paint is delayed.
      tag = tag.replace(/\sloading="lazy"/g, "");
      if (!/fetchpriority=/.test(tag)) {
        tag = tag.replace("<img", '<img fetchpriority="high"');
      }
    } else if (!/loading=/.test(tag)) {
      tag = tag.replace("<img", '<img loading="lazy" decoding="async"');
    }
    return tag;
  });

  // Images embedded in CSS backgrounds.
  let ci = -1;
  out = out.replace(CSS_RE, (m, ext, data) => {
    ci++;
    const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
    return "url(/_img/c" + ci + "." + e + "?p=" + p + ")";
  });

  // Dead placeholder tag. This <script> carries BOTH a src and inline content,
  // so its closing tag is thousands of chars away and the inline code never
  // runs today. Deleting the tag would suddenly activate that dead code, so
  // neutralise the type instead: the browser then neither fetches the src nor
  // executes the body. Same behaviour, minus the wasted request.
  out = out.replace(
    /<script([^>]*)\ssrc="https?:\/\/www\.googletagmanager\.com\/gtag\/js\?id=AW_CONVERSION_ID"([^>]*)>/g,
    '<script type="text/plain" data-disabled="dead-gtag-placeholder">'
  );

  return out.includes("</body>")
    ? out.replace("</body>", INJECT + "</body>")
    : out + INJECT;
}

async function serveImage(url) {
  const m = url.pathname.match(/^\/_img\/(c?)(\d+)\.([a-z0-9]+)$/i);
  if (!m) return new Response("bad request", { status: 404 });

  const isCss = m[1] === "c";
  const idx = parseInt(m[2], 10);
  const page = url.searchParams.get("p") || "/";

  const src = new URL(page, url.origin);
  src.searchParams.set("__raw", "1");

  const r = await fetch(src.toString(), { headers: { accept: "text/html" } });
  const html = await r.text();

  let n = -1;
  let payload = null;
  let mime = null;

  if (isCss) {
    html.replace(CSS_RE, (mm, ext, data) => {
      n++;
      if (n === idx) {
        payload = data;
        mime = ext.toLowerCase();
      }
      return mm;
    });
  } else {
    html.replace(IMG_RE, (mm, pre, ext, data) => {
      n++;
      if (n === idx) {
        payload = data;
        mime = ext.toLowerCase();
      }
      return mm;
    });
  }

  if (!payload) return new Response("not found", { status: 404 });

  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);

  return new Response(bytes, {
    headers: {
      "content-type": "image/" + (mime === "jpg" ? "jpeg" : mime),
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, max-age=31536000, immutable"
    }
  });
}

const INJECT = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${AW_ID}"></script>
<script>
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag("js",new Date());gtag("config","${AW_ID}");
</script>
<style>
.bb-row{display:flex;gap:8px;max-width:420px;margin:0 auto;padding:0;align-items:stretch;}
.bb-row>*{flex:1;min-width:0;}
.bb-wa,.bb-q{display:flex;align-items:center;justify-content:center;border-radius:10px;padding:15px 8px;font-size:1.02rem;font-weight:700;text-decoration:none;border:0;cursor:pointer;font-family:inherit;line-height:1.1;}
.bb-wa{background:#25D366;color:#fff;}
.bb-q{background:#0f2b36;color:#fff;}
.bb-modal{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:9999;display:none;align-items:center;justify-content:center;padding:16px;}
.bb-modal.on{display:flex;}
.bb-card{background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px;max-height:92vh;overflow:auto;font-family:inherit;}
.bb-card h3{margin:0 0 4px;font-size:1.28rem;color:#0f2b36;}
.bb-card .bb-sub{margin:0 0 12px;font-size:.88rem;color:#5a6b75;}
.bb-card label{display:block;font-size:.78rem;font-weight:700;color:#0f2b36;margin:11px 0 4px;letter-spacing:.02em;}
.bb-card input,.bb-card select{width:100%;padding:11px;border:1px solid #cfd8dd;border-radius:8px;font-size:1rem;box-sizing:border-box;font-family:inherit;}
.bb-send{width:100%;margin-top:18px;background:#25D366;color:#fff;border:0;border-radius:10px;padding:14px;font-size:1.05rem;font-weight:700;cursor:pointer;font-family:inherit;}
.bb-close{background:none;border:0;font-size:.85rem;color:#5a6b75;width:100%;margin-top:10px;cursor:pointer;font-family:inherit;}
</style>
<div class="bb-modal" id="bbModal">
  <div class="bb-card">
    <h3>Cotiza tu evento</h3>
    <p class="bb-sub">Completa esto y te contestamos por WhatsApp.</p>
    <label for="bbN">Nombre</label>
    <input id="bbN" type="text" autocomplete="name">
    <label for="bbT">Telefono</label>
    <input id="bbT" type="tel" inputmode="tel" autocomplete="tel">
    <label for="bbF">Fecha del evento</label>
    <input id="bbF" type="date">
    <label for="bbP">Pueblo</label>
    <input id="bbP" type="text">
    <label for="bbE">Tipo de evento</label>
    <select id="bbE">
      <option>Boda</option><option>Cumpleanos</option><option>Graduacion</option>
      <option>Actividad corporativa</option><option>Fiesta patronal</option><option>Otro</option>
    </select>
    <button class="bb-send" type="button" id="bbSend">Enviar por WhatsApp</button>
    <button class="bb-close" type="button" id="bbX">Cancelar</button>
  </div>
</div>
<script>
(function(){
  var PH="${PHONE}";
  function conv(){try{gtag("event","conversion",{send_to:"${AW_ID}/${CALL_LABEL}"});}catch(e){}}
  function wa(t){return "https://wa.me/"+PH+"?text="+encodeURIComponent(t);}
  function val(id){var e=document.getElementById(id);return e&&e.value?e.value.trim():"";}

  function init(){
    document.querySelectorAll('a[href^="tel:"]').forEach(function(l){l.addEventListener("click",conv);});

    var header=document.querySelector("header");
    var nav=header&&header.querySelector("nav");
    if(header&&nav&&!header.querySelector(".mobile-menu-toggle")){
      var menu=document.createElement("button");
      menu.className="mobile-menu-toggle";
      menu.type="button";
      menu.textContent="Menu";
      menu.setAttribute("aria-expanded","false");
      menu.setAttribute("aria-label","Abrir menu de navegacion");
      menu.addEventListener("click",function(e){
        e.stopPropagation();
        var open=nav.classList.toggle("mobile-open");
        menu.setAttribute("aria-expanded",open?"true":"false");
        menu.textContent=open?"Cerrar":"Menu";
      });
      nav.querySelectorAll("a").forEach(function(link){link.addEventListener("click",function(){nav.classList.remove("mobile-open");menu.setAttribute("aria-expanded","false");menu.textContent="Menu";});});
      header.insertBefore(menu,header.querySelector(".header-actions"));
      document.addEventListener("click",function(e){if(!header.contains(e.target)){nav.classList.remove("mobile-open");menu.setAttribute("aria-expanded","false");menu.textContent="Menu";}});
    }

    var bar=document.querySelector(".sticky-bar");
    if(bar && !bar.querySelector(".bb-row")){
      var row=document.createElement("div");
      row.className="bb-row";
      while(bar.firstChild){row.appendChild(bar.firstChild);}
      var w=document.createElement("a");
      w.className="bb-wa";w.target="_blank";w.rel="noopener";w.textContent="WhatsApp · Reservar";
      w.href=wa("Hola, quiero informacion sobre el alquiler del Portacool Jetstream 260 para mi evento.");
      w.addEventListener("click",conv);
      row.appendChild(w);
      bar.appendChild(row);
    }

    var mod=document.getElementById("bbModal");
    var x=document.getElementById("bbX");
    var s=document.getElementById("bbSend");
    if(x)x.addEventListener("click",function(){mod.classList.remove("on");});
    if(mod)mod.addEventListener("click",function(e){if(e.target===mod)mod.classList.remove("on");});
    if(s)s.addEventListener("click",function(){
      var msg="Hola, quiero cotizar el Portacool Jetstream 260."
        +"\\nNombre: "+(val("bbN")||"-")
        +"\\nTelefono: "+(val("bbT")||"-")
        +"\\nFecha: "+(val("bbF")||"-")
        +"\\nPueblo: "+(val("bbP")||"-")
        +"\\nEvento: "+(val("bbE")||"-");
      conv();
      window.open(wa(msg),"_blank","noopener");
      mod.classList.remove("on");
    });
  }

  if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",init);}else{init();}
})();
</script>
`;

export const config = { path: "/*" };

// Exported for offline verification; unused at runtime.
export { transform, IMG_RE, CSS_RE };
