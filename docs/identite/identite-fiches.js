/* =====================================================================
   Rendu des micro-fiches — format de données et fonctions de rendu
   ---------------------------------------------------------------------
   Format d'une fiche (rappel/fiches/<id>.json = collection `fiches` de Rappel v1) :
     { id, title, why, order, blocks: [...] }
     title : "CM6 · Artères et veines" -> sigle (eyebrow) + nom, séparés par " · "
             (les fiches de sémio v1 n'ont pas de sigle : "Bruits du cœur et souffles")
     blocks, champ k :
       { k:"h",     t }                                   intertitre
       { k:"p",     t }                                   paragraphe
       { k:"pin",   title, lines:[string] }               encadré titre + puces
       { k:"table", head:[string], rows:[[{t, s?}]] }     s = "key" | "ok" (classe de cellule)
       { k:"nums",  items:[{v, l}] }                      chiffres clés (valeur, libellé)
     Comptage sur les 23 fiches du dépôt : pin 40, table 25, p 15, nums 5, h 3 ;
     s = "key" 50 cellules, "ok" 8.

   IMPORTANT : les trois pages de micro-fiches sont du HTML STATIQUE, sans aucun
   <script> : leur HTML a été généré hors page. La partie A ci-dessous est donc une
   RECONSTRUCTION qui redonne leur balisage exact (vérifiée par diff sur les fiches
   cv-cm06…cv-cm17, sem-digestif, resp-tp02). La partie B est le code VERBATIM de
   Rappel v1 (rappel/v1/index.html, identique à la version publiée), qui affiche la
   fiche en surimpression avec l'ANCIENNE identité.
   ===================================================================== */


/* ---------------------------------------------------------------------
   A. RECONSTRUCTION — balisage des pages de micro-fiches (identité cible)
   --------------------------------------------------------------------- */

// Échappement identique aux pages (l'apostrophe sort en &#x27;).
const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// "CM6 · Artères et veines" -> { label: "CM6", name: "Artères et veines" }
function splitTitle(title) {
  const i = title.indexOf(' · ');
  return i < 0 ? { label: '', name: title } : { label: title.slice(0, i), name: title.slice(i + 3) };
}

// id de section tel que dans les pages : "CM6"->"cm6", "CM10-11"->"cm1011", "TP 5"->"tp 5".
// Défaut de la source : l'espace donne un id invalide ("tp 5"). Pour Rappel 2,
// préférer l'id de la fiche (ex. "resp-tp02") ou un slug sans espace.
const sectionId = label => label.toLowerCase().replace(/-/g, '');

function blockHtml(b) {
  switch (b.k) {
    case 'table':
      return '<div class="scroll"><table><thead><tr>'
        + (b.head || []).map(x => `<th scope="col">${esc(x)}</th>`).join('')
        + '</tr></thead><tbody>'
        + (b.rows || []).map(r => '<tr>' + r.map(c => `<td>${esc(c.t)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table></div>';
      // (les pages ignorent c.s ; proposition : `<td class="${c.s}">` + td.key / td.ok en CSS)
    case 'pin':
      return `<div class="pin"><h3>${esc(b.title)}</h3><ul>`
        + (b.lines || []).map(l => `<li>${esc(l)}</li>`).join('')
        + '</ul></div>';
    case 'nums':
      return '<div class="nums">'
        + (b.items || []).map(n => `<div class="num"><b>${esc(n.v)}</b><span>${esc(n.l)}</span></div>`).join('')
        + '</div>';
    case 'p':
      return `<p>${esc(b.t)}</p>`;
    case 'h':
      // Jamais rendu sur les pages (aucune fiche h parmi elles). Proposition :
      return `<h3 class="sub">${esc(b.t)}</h3>`;
    default:
      return '';
  }
}

function ficheSection(f) {
  const { label, name } = splitTitle(f.title);
  const sid = sectionId(label || f.id);
  return `<section class="fiche" id="${esc(sid)}" aria-labelledby="t-${esc(sid)}"><header>`
    + `<p class="eyebrow">${esc(label)}</p><h2 id="t-${esc(sid)}">${esc(name)}</h2>`
    + (f.why ? `<p class="why">${esc(f.why)}</p>` : '')
    + '</header>' + (f.blocks || []).map(blockHtml).join('') + '</section>';
}

function tocItem(f) {
  const { label, name } = splitTitle(f.title);
  const sid = sectionId(label || f.id);
  return `<li><a href="#${esc(sid)}"><span class="cm">${esc(label)}</span>${esc(name)}</a></li>`;
}

// Page complète (structure des trois pages) : fiches triées par `order`.
function fichesPage({ eyebrow, title, use, footerSource, rappelUrl }, fiches) {
  const list = [...fiches].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return `<main class="wrap">
  <header class="hero">
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1>${esc(title)}</h1>
    <p class="use">${esc(use)}</p>
    <nav aria-label="Cours"><ul class="toc">${list.map(tocItem).join('')}</ul></nav>
  </header>
  ${list.map(ficheSection).join('')}
  <footer>
    <p>Les mêmes fiches s'ouvrent dans Rappel après chaque réponse : « Voir la fiche ».</p>
    <p><a href="${esc(rappelUrl)}">Ouvrir Rappel</a> · ${esc(footerSource)}</p>
  </footer>
</main>`;
}
// Exemples de valeurs d'en-tête vues :
//   eyebrow "UE appareil cardio-vasculaire · S5" / "UE sémiologie clinique · S5" / "UE appareil respiratoire · S5"
//   use "L'essentiel de chaque cours, à relire après la ronéo et avant ses cartes dans Rappel."
//   footerSource "Sources : ronéos de la promo." / "Source : ronéo de la promo (sémiologie digestive)."


/* ---------------------------------------------------------------------
   B. VERBATIM — Rappel v1 (rappel/v1/index.html, l. 219-230, 340-359, 561-571)
   Rendu DOM de la fiche en surimpression (« Voir la fiche »), ancienne identité :
   pin = <div class="pin"><b>titre</b><p>ligne</p>…</div>, nums = <div><b/><span/></div>,
   why en <p class="lede">, p en <p class="small">, h en <h3>, cellule s -> class.
   --------------------------------------------------------------------- */

const $=id=>document.getElementById(id);
function h(tag,attrs,...kids){
  const e=document.createElement(tag);
  if(attrs) for(const [k,v] of Object.entries(attrs)){
    if(v==null||v===false) continue;
    if(k==='class') e.className=v;
    else if(k==='text') e.textContent=v;
    else if(k.startsWith('on')&&typeof v==='function') e.addEventListener(k.slice(2),v);
    else e.setAttribute(k,v===true?'':String(v));
  }
  for(const c of kids.flat(Infinity)){ if(c==null||c===false) continue; e.append(c instanceof Node?c:document.createTextNode(String(c))); }
  return e;
}

/* ================= fiche en surimpression ================= */
function ficheNode(f){
  const out=[h('h2',{text:f.title})];
  if(f.why) out.push(h('p',{class:'lede',text:f.why}));
  for(const b of (f.blocks||[])){
    if(b.k==='h') out.push(h('h3',{text:b.t}));
    else if(b.k==='p') out.push(h('p',{class:'small',text:b.t}));
    else if(b.k==='pin') out.push(h('div',{class:'pin'},h('b',{text:b.title}),(b.lines||[]).map(l=>h('p',{text:l}))));
    else if(b.k==='table') out.push(h('div',{class:'scroll'},h('table',null,
      h('thead',null,h('tr',null,(b.head||[]).map(x=>h('th',{text:x})))),
      h('tbody',null,(b.rows||[]).map(r=>h('tr',null,r.map(c=>h('td',{class:c.s||null,text:c.t}))))))));
    else if(b.k==='nums') out.push(h('div',{class:'nums'},(b.items||[]).map(n=>h('div',null,h('b',{text:n.v}),h('span',{text:n.l})))));
  }
  return h('div',{class:'stack'},out);
}
function openFiche(id){const f=APP.fiches[id];if(!f)return;const o=$('overlay');
  o.replaceChildren(h('div',{class:'bar-top'},h('div',{class:'in'},h('span',{class:'eyebrow',text:'Fiche de discrimination'}),h('button',{class:'btn sm',onclick:closeFiche,text:'Fermer'}))),h('div',{class:'body'},ficheNode(f)));
  o.hidden=false;o.scrollTop=0;document.body.style.overflow='hidden'}
function closeFiche(){$('overlay').hidden=true;document.body.style.overflow=''}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('overlay').hidden)closeFiche()});
const ficheList=()=>Object.entries(APP.fiches).sort((a,b)=>(a[1].order??99)-(b[1].order??99));

// Aplatit une fiche en lignes de texte (sert au « repère » de la correction locale).
function ficheLines(f){
  const L=[];
  for(const b of f.blocks||[]){
    if(b.k==='p')L.push(b.t);
    else if(b.k==='pin')for(const l of b.lines||[])L.push(l);
    else if(b.k==='table')for(const row of b.rows||[])L.push(row.map((c,i)=>(i&&b.head[i]?b.head[i]+' : ':'')+c.t).join(' · '));
    else if(b.k==='nums')for(const n of b.items||[])L.push(n.v+' : '+n.l);
  }
  return L;
}
// Note v1 : openFiche() sort sans rien afficher si la fiche n'existe pas
// (cas des 62 cartes sem-pneumo, qui pointent vers des fiches pn-* inexistantes).
