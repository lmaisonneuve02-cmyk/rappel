// Machinerie de texte reprise de Rappel v1 (normalisation, racines, abréviations, synonymes,
// antonymes, découpage de la réponse attendue), avec quelques aides pour Rappel 2.
/* eslint-disable */

function clozeParts(q){const out=[];let last=0;q.replace(/\{\{(.+?)\}\}/g,(m,x,i)=>{out.push(q.slice(last,i));out.push({ans:x});last=i+m.length});out.push(q.slice(last));return out}
function clozeAnswers(q){return [...q.matchAll(/\{\{(.+?)\}\}/g)].map(m=>m[1])}
function refText(c){return c.type==='cloze'?clozeAnswers(c.q).join(' · '):(c.a||'')}
function plainQ(c){return c.type==='cloze'?c.q.replace(/\{\{(.+?)\}\}/g,'___'):c.q}
function fullText(c){return c.type==='cloze'?c.q.replace(/\{\{(.+?)\}\}/g,'$1'):(c.q+' → '+(c.a||''))}

const STOP=new Set(("le la les l un une des de du d et ou au aux en dans par pour sur sous avec ce ces cet cette se sa son ses leur leurs qui que qu quoi dont y il elle ils elles on est sont etre ete avoir ont a tres tout tous toute toutes ne n c s etc donc mais car ni or si comme lors quand chez vers entre ainsi alors aussi bien fait faire peut peuvent doit doivent souvent generalement habituellement notamment surtout egalement meme cas type plus moins autre autres chaque tel telle er ere eme nd e j m t on ça ca cela ceci c est maximal maximale maximum survenant survient surviennent retrouve retrouvee retrouves observe observee presente presentent traduit traduisent correspond correspondent").split(' '));
const NUMW={deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,neuf:9,dix:10,onze:11,douze:12,quinze:15,vingt:20,trente:30,quarante:40,cinquante:50,soixante:60,cent:100,premier:1,premiere:1,deuxieme:2,troisieme:3,quatrieme:4,cinquieme:5,sixieme:6,moitie:0.5,tiers:3,quart:4};
const ABBR={idm:'infarctus myocarde',ic:'insuffisance cardiaque',icg:'insuffisance cardiaque gauche',icd:'insuffisance cardiaque droite',vg:'ventricule gauche',vd:'ventricule droit',og:'oreillette gauche',od:'oreillette droite',eic:'espace intercostal',
  rot:'reflexe osteo tendineux',rcp:'reflexe cutane plantaire',hta:'hypertension arterielle',htap:'hypertension arterielle pulmonaire',hic:'hypertension intracranienne',ep:'embolie pulmonaire',oap:'oedeme aigu poumon',omi:'oedeme membre inferieur',
  aomi:'arteriopathie obliterante membre inferieur',ips:'index pression systolique',ta:'tension arterielle',pa:'pression arterielle',fc:'frequence cardiaque',fr:'frequence respiratoire',fa:'fibrillation atriale',im:'insuffisance mitrale',ia:'insuffisance aortique',
  rao:'retrecissement aortique',rm:'retrecissement mitral',it:'insuffisance tricuspide',civ:'communication interventriculaire',cia:'communication interauriculaire',bpco:'bronchopneumopathie chronique obstructive',avc:'accident vasculaire cerebral',
  ait:'accident ischemique transitoire',sep:'sclerose plaques',mi:'membre inferieur',ms:'membre superieur',lcr:'liquide cephalo rachidien',pl:'ponction lombaire',atcd:'antecedent',atcds:'antecedent',cv:'cardiovasculaire',fdr:'facteur risque',
  ttt:'traitement',tvp:'thrombose veineuse profonde',hvg:'hypertrophie ventriculaire gauche',ecg:'electrocardiogramme',bbd:'bloc branche droit',bbg:'bloc branche gauche',fop:'foramen ovale permeable',min:'minute',mn:'minute',h:'heure',hr:'heure',
  sem:'semaine',ans:'an',sca:'syndrome coronarien aigu',tj:'turgescence jugulaire',rhj:'reflux hepato jugulaire',ag:'angor',pf:'paralysie faciale',pfp:'paralysie faciale peripherique',pfc:'paralysie faciale centrale',
  sn:'systeme nerveux',snc:'systeme nerveux central',snp:'systeme nerveux peripherique',ddl:'decubitus lateral',
  nitres:'derive nitre',trinitrine:'derive nitre',nitre:'derive nitre'};
const SYNG=[['atrial','atriale','atriales','auriculaire','auriculaires'],['dyspnee','essoufflement','essouffle','essoufflee'],['douleur','douleurs','algie','algies','douloureux','douloureuse','douloureuses'],
  ['augmente','augmentee','augmentation','majore','majoree','majoration','accentue','accentuee','aggrave','aggravee','accru','accrue','exacerbe','exacerbee','renforce','renforcee','hausse'],
  ['diminue','diminuee','diminution','baisse','reduit','reduite','reduction','attenue','attenuee','abaisse','abaissee'],['absent','absente','absents','absentes','aboli','abolie','abolis','abolies','abolition','disparu','disparue'],
  ['vif','vifs','vive','vives','exagere','exageres','exageree','exagerees','vifes'],['brutal','brutale','brutaux','brutalement','brusque','brusquement','soudain','soudaine','soudainement','subit','subite'],
  ['progressif','progressive','progressivement','insidieux','insidieuse'],['cede','cedent','cesse','soulage','soulagee','calme','calmee','disparait'],['resiste','resistant','resistante','resistance'],
  ['constriction','constrictive','constrictif','etau','serrement','oppression','enserrement','serre'],['effort','efforts','exercice','exercices'],['conscience','connaissance'],
  ['inferieur','inferieure','inferieurs','inferieures'],['superieur','superieure','superieurs','superieures'],['anterieur','anterieure','anterieurs'],['posterieur','posterieure','posterieurs'],
  ['cyanose','cyanique','cyaniques','cyanose','cyanosee','cyanoses'],['coronaire','coronaires','coronarien','coronarienne'],['ischemie','ischemique','ischemiques'],
  ['homolateral','homolaterale','ipsilateral','ipsilaterale','homolateraux'],['controlateral','controlaterale','controlateraux'],['systole','systolique'],['diastole','diastolique'],
  ['inspiration','inspiratoire','inspirer','inspire'],['expiration','expiratoire','expirer','expire'],['penche','procubitus'],['decubitus','allonge','allongee','couche','couchee'],
  ['orthostatisme','debout','orthostatique'],['nocturne','nuit'],['matinale','matin','matinal','reveil'],['permanent','permanente','continu','continue','constant','constante'],
  ['bilateral','bilaterale','bilateraux','bilaterales'],['unilateral','unilaterale'],['irradiation','irradie','irradiant','irradiante','irradier'],['palpitation','palpitations'],
  ['intense','intensite','violent','violente','severe'],['hemorragie','saignement'],['oedeme','oedemes','edeme'],['proximal','proximale','proximaux','racine'],['distal','distale','distaux','extremite']];
const SYN={};for(const g of SYNG)for(const w of g)SYN[w]=g[0];
const ANTP=[['gauche','droite'],['gauche','droit'],['systole','diastole'],['augmente','diminue'],['cede','resiste'],['inspiration','expiration'],['proximal','distal'],['interne','externe'],['inferieur','superieur'],
  ['anterieur','posterieur'],['aigu','chronique'],['aigue','chronique'],['flexion','extension'],['flechisseur','extenseur'],['abduction','adduction'],['brutal','progressif'],['homolateral','controlateral'],['central','peripherique'],['centrale','peripherique'],
  ['tachycardie','bradycardie'],['mydriase','myosis'],['present','absent'],['hypotonie','hypertonie'],['hypertension','hypotension'],['horizontal','vertical'],['horizontale','verticale'],['repos','effort'],['elastique','plastique'],
  ['unilateral','bilateral'],['symetrique','asymetrique'],['ascendant','descendant'],['tachypnee','bradypnee'],['hyperesthesie','hypoesthesie'],['nocturne','matinale'],['vif','absent'],['spastique','flasque'],['sec','mou'],['aigu','grave'],['aigus','graves']];
function norm(s){return String(s||'').toLowerCase().replace(/œ/g,'oe').replace(/æ/g,'ae').normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/[’'`´]/g,' ').replace(/(\d)[,.](\d)/g,'$1.$2').replace(/[^a-z0-9. ]+/g,' ').replace(/\.(?!\d)/g,' ').replace(/(^|[^\d])\./g,'$1 ').replace(/\s+/g,' ').trim()}
const SUF=['issements','issement','ements','ement','ations','ation','atrices','atrice','ateurs','ateur','ances','ance','ences','ence','ites','ite','iques','ique','ives','ive','ifs','if','euses','euse','eux','ales','ale','aux','al','ees','ee','es','e'];
function stem(w){if(w.length<=3||/\d/.test(w))return w;w=w.replace(/[sx]$/,'');for(const s of SUF)if(w.endsWith(s)&&w.length-s.length>=4){w=w.slice(0,-s.length);break}return w}
const canon=w=>stem(SYN[w]||w);
const ANTS=new Map();for(const [a,b] of ANTP){ANTS.set(canon(a),canon(b));ANTS.set(canon(b),canon(a))}

// Abréviations du carnet : {abr: sens} → clés et sens normalisés (mis en cache par objet).
const ABR_CACHE = new WeakMap();
function normAbr(o) {
  if (ABR_CACHE.has(o)) return ABR_CACHE.get(o);
  const r = {};
  for (const [k, v] of Object.entries(o || {})) {
    const nk = norm(k).replace(/ /g, ''), nv = norm(v);
    if (nk && nv && !/\d/.test(nk)) r[nk] = nv;
  }
  ABR_CACHE.set(o, r);
  return r;
}

function analyze(text,abrExtra){
  const AX=abrExtra?normAbr(abrExtra):null;
  const raw=norm(text).split(' ').filter(Boolean);
  const nums=new Set(),stems=[],set=new Set(),words=new Map();
  const push=(orig,t)=>{if(STOP.has(t)||(t.length<2))return;const s=canon(t);stems.push(s);set.add(s);if(!words.has(s))words.set(s,orig)};
  for(let w of raw){
    if(/^\d+(\.\d+)?$/.test(w)){nums.add(String(parseFloat(w)));continue}
    const m=w.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);if(m){nums.add(String(parseFloat(m[1])));w=m[2];if(STOP.has(w))continue}
    if(NUMW[w]!=null){nums.add(String(NUMW[w]));continue}
    const ex=(AX&&AX[w])||ABBR[w];if(ex){for(const t of ex.split(' '))if(t)push(w,t);continue}
    push(w,w);
  }
  const pairs=[];
  for(let i=0;i+1<raw.length;i++){const a=raw[i],b=raw[i+1];if(/\d/.test(a+b)||a.length<2||b.length<2||STOP.has(a)||STOP.has(b))continue;const j=stem(a+b);set.add(j);pairs.push([canon(a),canon(b),j])}
  return {stems,set,nums,words,pairs,arr:[...new Set(stems)]};
}
// Distance de Damerau-Levenshtein restreinte : l'inversion de deux lettres voisines compte
// pour une faute (« infractus »). Arrêt anticipé dès que toute une ligne dépasse max.
function lev(a,b,max){if(Math.abs(a.length-b.length)>max)return max+1;let pp=null,p=[...Array(b.length+1).keys()];
  for(let i=1;i<=a.length;i++){const c=[i];let best=i;for(let j=1;j<=b.length;j++){let d=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d=Math.min(d,pp[j-2]+1);c[j]=d;if(d<best)best=d}
    if(best>max)return max+1;pp=p;p=c}return p[b.length]}
function hasStem(A,s){
  if(A.set.has(s))return true;if(s.length<5)return false;const opp=ANTS.get(s);
  for(const t of A.arr){
    if(t===opp||t.length<4)continue;
    if((/^hypo/.test(s)&&/^hyper/.test(t))||(/^hyper/.test(s)&&/^hypo/.test(t))||(/^tachy/.test(s)&&/^brady/.test(t))||(/^brady/.test(s)&&/^tachy/.test(t)))continue;
    if(Math.min(t.length,s.length)>=5&&(t.startsWith(s)||s.startsWith(t)))return true;
    const mx=s.length>=9?2:1;if(lev(s,t,mx)<=mx)return true;
  }
  return false;
}
let IDF={key:'',df:{},n:1};

const OPTRE=/^(parfois|plus rarement|rarement|eventuellement|voire|par exemple|exemple|ex|notamment|aussi|egalement)\b/;
function splitRef(c){
  if(c.type==='cloze')return clozeAnswers(c.q).map(t=>({text:t,opt:false}));
  if(Array.isArray(c.cles)&&c.cles.length)return c.cles.map(t=>({text:String(t),opt:false}));
  const opts=[];const ref=String(c.a||'').replace(/\(([^)]{2,})\)/g,(m,x)=>{opts.push(x);return ' '}).replace(/(^|\s)\d{1,2}[.)]\s+/g,'$1');
  const out=[];
  for(const sent of ref.split(/\.\s+|;\s*|\n+|\s(?=\d\.\s)/)){
    let opt=false;
    const pieces=sent.split(/\s*:\s+/);
    pieces.forEach((piece,pi)=>{
      for(let seg of piece.split(/,\s+|\s+et\s+|\s+puis\s+|\s+avec\s+/)){
        seg=seg.replace(/^\s*\d+[.)]\s*/,'').replace(/[.\s]+$/,'').trim();if(!seg)continue;
        if(OPTRE.test(norm(seg)))opt=true;
        out.push({text:seg,opt,label:pieces.length>1&&pi===0&&pi<pieces.length-1});
      }
    });
  }
  for(const t of opts)out.push({text:t.trim(),opt:true});
  return out;
}

const DUNNO=/^(je (ne )?(sais|sait|se) (pas|plus)|j sais pas|sais pas|aucune idee|pas d idee|passe|joker|je passe|oublie|j ai oublie|trou|rien)$/;
const isDunno=a=>DUNNO.test(norm(a));

// Comparaison exacte : casse, accents, ponctuation et espaces ignorés.
function normaliser(s) {
  return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)[,.](\d)/g, '$1.$2').replace(/[^a-z0-9.]+/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
}

const estJeNeSaisPas = isDunno;

// Question à lire à voix haute : les trous deviennent « blanc ».
function texteOral(c) {
  return c.type === 'cloze' ? c.q.replace(/\{\{(.+?)\}\}/g, 'blanc') : c.q;
}

// Poids des racines rares : log(1 + n / (1 + df)), calculé sur toutes les cartes (comme v1).
function creerIdf(cartes) {
  const df = {};
  let n = 0;
  for (const c of cartes) { n++; for (const t of analyze(fullText(c)).set) df[t] = (df[t] || 0) + 1; }
  n = n || 1;
  return s => Math.log(1 + n / (1 + (df[s] || 0)));
}

export { STOP, NUMW, ABBR, SYNG, SYN, ANTP, ANTS, norm, stem, canon, analyze, lev, hasStem, splitRef, OPTRE, DUNNO,
  clozeParts, clozeAnswers, refText, plainQ, fullText, isDunno, estJeNeSaisPas, normaliser, texteOral, creerIdf };
