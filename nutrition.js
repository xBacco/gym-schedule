// Guida alimentazione: contenuto statico (solo lettura) + render dell'overlay.
// Nessun dato salvato — è materiale di consultazione, non un log.
// Il testo usa *asterischi* per il grassetto inline (vedi rich()).

export const NUTRITION_GUIDE = {
  intro:
    "Approccio essenziale: *piatto unico* a ogni pasto, focus che si sposta col tipo di seduta, idratazione sempre. Tocca una sezione per aprirla.",
  sections: [
    {
      icon: "🍽️",
      title: "I principi",
      open: true,
      blocks: [
        { p: "Il *piatto unico* è l'arma principale: economico, veloce, ti fa tornare i conti a occhio." },
        { ul: [
          "*½ piatto* verdura / fibre",
          "*¼ piatto* proteine (uova, pollo, tonno, legumi)",
          "*¼ piatto* carboidrati (riso, pasta, piadina, patate)",
          "*1–2 cucchiai* olio EVO a crudo",
        ] },
        { tip: "*Idratazione* = la base di tutto. Borraccia sempre con te, ~2 L al giorno, di più nei giorni di corsa." },
      ],
    },
    {
      icon: "🏋️",
      title: "Giorno di palestra",
      blocks: [
        { p: "Focus sulle *proteine*, soprattutto a cena (post-workout). Allenamento ore 18.", muted: true },
        { meal: { h: "Colazione", t: "Avena + latte/yogurt + frutta" } },
        { meal: { h: "Pranzo · piatto unico", t: "Pasta + tonno + verdura + olio" } },
        { meal: { h: "★ Spuntino", time: "16:30", key: true,
          t: "Il pasto chiave: piadina + tacchino, o banana + fette biscottate. Ti fa arrivare carico alle 18." } },
        { meal: { h: "Cena · proteica", time: "19:30+", t: "Uova/pollo + verdura abbondante + poco riso/patate" } },
      ],
    },
    {
      icon: "🏃",
      title: "Giorno di corsa",
      blocks: [
        { p: "Stesso schema, ma carichi i *carboidrati* nello spuntino pre e nella cena.", muted: true },
        { ul: [
          "Più riso / pasta / patate prima e dopo",
          "I carbo sono la prima benzina dell'aerobico: reintegrali",
        ] },
      ],
    },
    {
      icon: "🛒",
      title: "Spesa furba a Verona",
      blocks: [
        { p: "Eurospin / Lidl / MD. Roba che non si butta, costa poco, si combina in mille modi.", muted: true },
        { ul: [
          "*Uova* — la proteina più economica",
          "*Legumi secchi* — proteine + fibre, costano meno delle scatolette",
          "*Pasta, riso, patate* — i carbo base",
          "*Tonno/sgombro in scatola* — scorta in offerta",
          "*Pollo* (sovracosce) — dividi e congela",
          "*Verdura surgelata* — zero spreco, pochi soldi",
        ] },
      ],
    },
    {
      icon: "🍳",
      title: "Cucinare con poco",
      blocks: [
        { p: "Solo microonde + fornelli, niente forno.", muted: true },
        { ul: [
          "*One-pot*: riso/pasta + legumi/tonno + verdura saltata + olio",
          "*Batch*: una pentola grande la domenica copre 2-3 pasti",
          "*Micro*: riso pronto 2 min, patate bucate ~8 min",
        ] },
        { tip: "*BCAA*: solo se fai ipertrofia specifica, e sono opzionali. Se mangi abbastanza proteine contano poco — non è una spesa prioritaria." },
      ],
    },
  ],
  foot: "guida statica · nessun dato salvato",
};

// Piccolo helper DOM (createElement + figli). Coerente con lo stile di app.js
// che evita innerHTML.
function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) {
    if (c == null) continue;
    e.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

// Trasforma "testo con *grassetto*" in nodi di testo + <b>. Indici dispari dello
// split sono il contenuto tra asterischi.
function rich(str) {
  const frag = document.createDocumentFragment();
  String(str).split(/\*([^*]+)\*/).forEach((part, i) => {
    if (part === "") return;
    frag.append(i % 2 === 1 ? el("b", null, part) : document.createTextNode(part));
  });
  return frag;
}

function renderBlock(b) {
  if (b.p != null) return el("p", b.muted ? "muted" : null, rich(b.p));
  if (b.ul) return el("ul", null, ...b.ul.map((t) => el("li", null, rich(t))));
  if (b.tip != null) return el("div", "tip", rich(b.tip));
  if (b.meal) {
    const m = b.meal;
    const head = el("div", "mh", el("span", null, m.h));
    if (m.time) head.append(el("span", "time", m.time));
    return el("div", "meal" + (m.key ? " key" : ""), head, el("div", "mt", rich(m.t)));
  }
  return null;
}

function renderSection(sec) {
  const head = el("div", "acc-h",
    el("span", "ic", sec.icon),
    el("span", "ti", sec.title),
    el("span", "cv", "▾"));
  const body = el("div", "acc-c", ...sec.blocks.map(renderBlock).filter(Boolean));
  const acc = el("div", "acc" + (sec.open ? " open" : ""), head, body);
  head.addEventListener("click", () => acc.classList.toggle("open"));
  return acc;
}

// Popola `container` con la guida. Idempotente: ricostruisce da zero a ogni apertura.
export function renderNutritionGuide(container) {
  container.replaceChildren();
  container.append(el("p", "nutri-intro", rich(NUTRITION_GUIDE.intro)));
  for (const sec of NUTRITION_GUIDE.sections) container.append(renderSection(sec));
  container.append(el("div", "nutri-foot", NUTRITION_GUIDE.foot));
}
