export default async (request, context) => {
const res = await context.next();
const type = res.headers.get("content-type") || "";
if (!type.includes("text/html")) return res;
const html = await res.text();
const tag = `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18276254764"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","AW-18276254764");document.addEventListener("DOMContentLoaded",function(){document.querySelectorAll('a[href^="tel:"]').forEach(function(l){l.addEventListener("click",function(){gtag("event","conversion",{send_to:"AW-18276254764/qIANCIz86t4cEKyI5opE"});});});});</script>`;
const out = html.includes("</head>") ? html.replace("</head>", tag + "</head>") : tag + html;
return new Response(out, { status: res.status, headers: res.headers });
};

export const config = { path: "/*" };
