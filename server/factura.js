"use strict";
// Lectura de documentos para prellenar el formulario de gasto.
// - XML (CFDI 3.3 / 4.0): datos exactos del comprobante.
// - PDF: se reconstruye el texto en orden de lectura (por posición en la página) y se reconoce el tipo:
//     · factura (CFDI impreso)            → emisor, RFC, montos, folio, UUID
//     · comprobante de pago / SPEI       → beneficiario, monto pagado, fecha, clave de rastreo, concepto
//     · otro                              → lo que se alcance a leer; el usuario revisa.
const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const money = s => { if (s == null || s === "") return null; const n = Number(String(s).replace(/[^\d.-]/g, "")); return isFinite(n) && String(s).match(/\d/) ? round2(n) : null; };
const isoDesde = s => {
  if (!s) return null;
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})(?!\d)/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/\b(\d{1,2})\s+de\s+([a-záé]+)\s+de\s+(20\d{2})\b/i);
  if (m) { const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]; const i = meses.indexOf(m[2].toLowerCase()); if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
};

// ---------- XML CFDI ----------
function buscarNodo(obj, nombreLocal) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of Object.keys(obj)) { const local = k.includes(":") ? k.split(":").pop() : k; if (local === nombreLocal) return obj[k]; }
  for (const k of Object.keys(obj)) { const r = buscarNodo(obj[k], nombreLocal); if (r) return r; }
  return null;
}
const lista = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

function leerXml(contenido) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", removeNSPrefix: false, parseAttributeValue: false });
  const doc = parser.parse(contenido);
  const comp = buscarNodo(doc, "Comprobante");
  if (!comp) throw new Error("El XML no es un CFDI (no tiene el nodo Comprobante).");
  const emisor = buscarNodo(comp, "Emisor") || {};
  const conceptos = lista(buscarNodo(buscarNodo(comp, "Conceptos") || {}, "Concepto"));
  const timbre = buscarNodo(comp, "TimbreFiscalDigital") || {};
  let iva = 0, encontrado = false;
  const impuestosComp = buscarNodo(comp, "Impuestos");
  const trasladosComp = impuestosComp && typeof impuestosComp === "object" ? lista(buscarNodo(buscarNodo(impuestosComp, "Traslados") || {}, "Traslado")) : [];
  for (const t of trasladosComp) { if (String(t.Impuesto) === "002") { iva += Number(t.Importe) || 0; encontrado = true; } }
  if (!encontrado) for (const c of conceptos) { const tr = lista(buscarNodo(buscarNodo(buscarNodo(c, "Impuestos") || {}, "Traslados") || {}, "Traslado")); for (const t of tr) if (String(t.Impuesto) === "002") iva += Number(t.Importe) || 0; }
  const subtotal = round2(comp.SubTotal), descuento = round2(comp.Descuento || 0), total = round2(comp.Total);
  const descripciones = conceptos.map(c => String(c.Descripcion || "").trim()).filter(Boolean);
  const concepto = descripciones.length ? (descripciones.length === 1 ? descripciones[0] : descripciones[0] + " (+" + (descripciones.length - 1) + " conceptos)") : "";
  return {
    origen: "xml", tipo_documento: "factura", confianza: "alta",
    fecha: String(comp.Fecha || "").slice(0, 10) || null,
    proveedor: String(emisor.Nombre || "").trim() || null,
    rfc: String(emisor.Rfc || "").trim().toUpperCase() || null,
    concepto: concepto.slice(0, 200) || null,
    subtotal: round2(subtotal - descuento), iva: round2(iva), total,
    folio: [comp.Serie, comp.Folio].filter(Boolean).join("-") || null,
    uuid: String(timbre.UUID || "").trim().toUpperCase() || null,
    moneda: comp.Moneda || "MXN",
  };
}

// ---------- PDF: texto en orden de lectura ----------
async function textoPdf(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  const paginas = [];
  for (let p = 1; p <= Math.min(doc.numPages, 5); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str, w: i.width || 0 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lineas = []; let cur = null;
    for (const it of items) { if (!cur || Math.abs(cur.y - it.y) > 3) { cur = { y: it.y, parts: [] }; lineas.push(cur); } cur.parts.push(it); }
    paginas.push(lineas.map(l => l.parts.sort((a, b) => a.x - b.x).map((q, i, arr) => (i && q.x - (arr[i - 1].x + arr[i - 1].w) > 8 ? "  " : (i && !/\s$/.test(arr[i - 1].s) && !/^\s/.test(q.s) && q.x - (arr[i - 1].x + arr[i - 1].w) > 1.5 ? " " : "")) + q.s).join("").trim()).filter(Boolean).join("\n"));
  }
  try { await doc.destroy(); } catch {}
  return paginas.join("\n");
}

// Valor que sigue a una etiqueta en la misma línea ("Monto:  46,284.00  Moneda: MXN" → "46,284.00").
// El valor termina en un doble espacio (otra columna), en la siguiente etiqueta ("Algo:") o al final de la línea.
function valorTras(t, etiqueta) {
  const re = new RegExp("(?:^|\\n|\\s)" + etiqueta + "\\s*[:：]\\s*(.*?)(?=\\s{2,}|\\s+[A-Za-zÁÉÍÓÚÑáéíóúñ][^\\n:]{0,40}:|\\n|$)", "i");
  const m = t.match(re); if (!m) return null;
  const v = m[1].trim();
  return v || null;
}
function valorMonto(t, etiqueta) {
  const re = new RegExp("(?:^|\\n|\\s)" + etiqueta + "[^\\d\\n$]{0,25}\\$?\\s*(-?[\\d,]+\\.\\d{2})", "i");
  const m = t.match(re); return m ? money(m[1]) : null;
}

function leerSpei(t) {
  const total = valorMonto(t, "Monto") ?? valorMonto(t, "Importe") ?? valorMonto(t, "Monto\\s+(?:de\\s+la\\s+)?transferencia") ?? valorMonto(t, "Total");
  const proveedor = valorTras(t, "Nombre del Beneficiario") || valorTras(t, "Beneficiario") || valorTras(t, "Nombre o raz[oó]n social del beneficiario");
  const concepto = valorTras(t, "Concepto de Pago") || valorTras(t, "Concepto");
  const clave = valorTras(t, "Clave de Rastreo") || valorTras(t, "Clave de seguimiento") || valorTras(t, "Folio de operaci[oó]n") || valorTras(t, "N[uú]mero de referencia");
  const fecha = isoDesde(valorTras(t, "Fecha de liquidaci[oó]n") || "") || isoDesde(valorTras(t, "Fecha valor") || "") || isoDesde(valorTras(t, "Fecha de operaci[oó]n") || "") || isoDesde(valorTras(t, "Fecha") || "") || isoDesde(t);
  const refFactura = concepto ? (concepto.match(/\b([A-Z]{1,3}\s?-?\s?\d{3,8})\b/) || [])[1] : null;
  const subtotal = total != null ? round2(total / 1.16) : null;
  return {
    origen: "pdf", tipo_documento: "pago", confianza: "revisar",
    fecha, proveedor: proveedor ? proveedor.replace(/\s{2,}/g, " ") : null, rfc: null,
    concepto: concepto ? ("Pago " + concepto).slice(0, 200) : null,
    subtotal, iva: total != null ? round2(total - subtotal) : null, total,
    montos_derivados: total != null,
    folio: clave ? clave.split(/\s/)[0] : null,
    referencia_factura: refFactura ? refFactura.replace(/\s/g, "") : null,
    uuid: null, moneda: /\bUSD\b/.test(t) && !/\bMXN\b/.test(t) ? "USD" : "MXN", estado: "pagado",
  };
}

function leerFacturaPdf(t) {
  const uuid = (t.match(/\b([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\b/) || [])[1];
  const rfcs = [...new Set([...t.matchAll(/\b([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\b/g)].map(m => m[1]))];
  const total = valorMonto(t, "Total(?!\\s*(?:de\\s+)?impuestos)") ?? valorMonto(t, "Importe total") ?? valorMonto(t, "Total a pagar");
  const subtotal = valorMonto(t, "Sub\\s*-?\\s*total") ?? valorMonto(t, "Importe");
  const iva = valorMonto(t, "I\\.?\\s?V\\.?\\s?A\\.?(?:\\s*\\(?\\s*16\\s*%\\s*\\)?)?") ?? valorMonto(t, "Impuestos? trasladados?");
  const proveedor = valorTras(t, "Nombre del emisor") || valorTras(t, "Emisor") || valorTras(t, "Raz[oó]n social") || valorTras(t, "Nombre") ||
    (t.split(/\n/).map(l => l.trim()).find(l => l.length >= 4 && l.length <= 80 && /[A-Za-zÁÉÍÓÚÑ]/.test(l) && !/\d{3}/.test(l) && !/\bRFC\b|factura|comprobante|cfdi|p[aá]gina/i.test(l)) || null);
  const folio = valorTras(t, "Folio(?!\\s*fiscal)(?:\\s*interno|\\s*de\\s+factura)?") ;
  const serie = valorTras(t, "Serie");
  const fecha = isoDesde(valorTras(t, "Fecha(?:\\s*y\\s*hora)?(?:\\s*de\\s*(?:emisi[oó]n|expedici[oó]n))?") || "") || isoDesde(t);
  const folioLimpio = folio ? (folio.match(/^[A-Z0-9-]{1,20}/i) || [])[0] : null;
  return {
    origen: "pdf", tipo_documento: "factura", confianza: "revisar",
    fecha, proveedor: proveedor ? proveedor.replace(/\s{2,}/g, " ").replace(/\s*RFC.*$/i, "") : null, rfc: rfcs[0] || null, rfcs,
    concepto: null,
    subtotal: subtotal ?? (total != null && iva != null ? round2(total - iva) : null),
    iva: iva ?? (total != null && subtotal != null ? round2(total - subtotal) : null),
    total: total ?? (subtotal != null && iva != null ? round2(subtotal + iva) : null),
    folio: folioLimpio ? (serie && !folioLimpio.includes("-") && !/^[A-Z]/i.test(folioLimpio) ? serie.split(/\s/)[0] + "-" + folioLimpio : folioLimpio) : null,
    uuid: uuid ? uuid.toUpperCase() : null, moneda: /\bUSD\b/.test(t) && !/\bMXN\b/.test(t) ? "USD" : "MXN",
  };
}

async function leerPdf(buffer) {
  const t = (await textoPdf(buffer)).replace(/ /g, " ");
  if (!t.replace(/\s/g, "").length) throw new Error("El PDF no contiene texto (parece una imagen escaneada); captura los datos a mano o pide el XML de la factura.");
  const esPago = /\bSPEI\b|Clave de Rastreo|Comprobante\s+(?:electr[oó]nico\s+)?de\s+pago|Transferencia|Beneficiario/i.test(t) && !/\bCFDI\b|Folio fiscal|UUID/i.test(t);
  const r = esPago ? leerSpei(t) : leerFacturaPdf(t);
  r.texto_detectado = t.slice(0, 400);
  return r;
}

async function analizarArchivo(ruta, nombreOriginal) {
  const esXml = /\.xml$/i.test(nombreOriginal || "");
  if (esXml) return leerXml(fs.readFileSync(ruta, "utf8"));
  const buf = fs.readFileSync(ruta);
  if (buf.slice(0, 5).toString() === "%PDF-") return leerPdf(buf);
  if (/<\?xml|<cfdi:Comprobante/i.test(buf.slice(0, 200).toString("utf8"))) return leerXml(buf.toString("utf8"));
  throw new Error("El archivo no es un PDF ni un XML de CFDI.");
}

module.exports = { analizarArchivo, leerXml, leerPdf, textoPdf };
