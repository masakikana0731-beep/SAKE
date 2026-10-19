// AI を使わずにラベル情報を補完する仕組み
//  1) 内蔵の銘柄辞書  2) ラベル文字のルール解析  3) Wikipedia 検索（無料・APIキー不要）
import { BRANDS } from './brands.js';
import { PREFS, TYPES } from './data.js';

const RICES = [
  '山田錦', '五百万石', '美山錦', '雄町', '愛山', '八反錦', '八反', '出羽燦々', '出羽の里', '亀の尾', '秋田酒こまち',
  '吟風', '彗星', '千本錦', '越淡麗', 'ひとごこち', '華吹雪', '雪女神', '強力', '神力', '酒未来', '龍の落とし子',
  '愛国', '白鶴錦', '改良信交', '吟ぎんが', '蔵の華', '夢の香', '吟の精', '美郷錦', '玉栄', '吟吹雪', '山恵錦',
  '山酒4号', '石川門', '富の香', '五百万石', 'きたしずく', '一本〆', '短稈渡船', '渡船',
];
const byLength = (a, b) => b.length - a.length;
const TYPE_WORDS = [...TYPES].sort(byLength);
const RICE_WORDS = [...new Set(RICES)].sort(byLength);
const PREF_SHORT = PREFS.map((p) => [p, p === '北海道' ? p : p.replace(/[都府県]$/, '')]);

// 全角数字・記号を半角に寄せ、改行や空白を取り除く（縦書きOCRは1文字ずつ改行されがち）
export function normalize(text) {
  return String(text || '')
    .replace(/[０-９．％]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, '');
}

/** 名前（入力欄の値）に一致する銘柄。完全一致を優先し、2文字以上なら前方一致も許す */
export function findBrand(name) {
  const n = normalize(name);
  if (!n) return null;
  return BRANDS.find((b) => b.name === n) ||
    (n.length >= 2 ? BRANDS.find((b) => b.name.length >= 2 && (n.startsWith(b.name) || b.name.startsWith(n))) : null);
}

/** ラベル全文に含まれる銘柄（誤検出を避けるため2文字以上の銘柄だけ探す） */
export function findBrandInText(text) {
  const t = normalize(text);
  return [...BRANDS].filter((b) => b.name.length >= 2).sort((a, b) => byLength(a.name, b.name)).find((b) => t.includes(b.name)) || null;
}

/** ラベルや説明文から項目を抜き出す。見つかった項目だけを返す */
export function parseLabelText(text) {
  const t = normalize(text);
  const out = {};
  if (!t) return out;

  const polish = t.match(/精米歩合[^\d]{0,6}(\d{1,3})%?/) || t.match(/(\d{2})%精米/);
  if (polish && +polish[1] > 0 && +polish[1] <= 100) out.polish = +polish[1];

  const abv = t.match(/(?:アルコール分?|度数|Alc\.?)[^\d]{0,6}(\d{1,2}(?:\.\d)?)(?:度|%)/i) || t.match(/(\d{1,2}(?:\.\d)?)度以上/);
  if (abv && +abv[1] > 0 && +abv[1] < 100) out.abv = +abv[1];

  const rice = RICE_WORDS.find((r) => t.includes(r));
  if (rice) out.rice = rice;

  const type = TYPE_WORDS.find((w) => t.includes(w));
  if (type) out.type = type;
  else if (/焼酎/.test(t)) {
    const base = [['芋', /さつまいも|甘藷|芋/], ['麦', /大麦|麦/], ['黒糖', /黒糖/], ['米', /米(?!こうじ|麹)/]].find(([, re]) => re.test(t.replace(/米こうじ|米麹/g, '')));
    if (base) out.type = base[0] + '焼酎';
  }

  if (/泡盛/.test(t)) out.category = '泡盛';
  else if (/焼酎/.test(t)) out.category = '焼酎';
  else if (/ウイスキー|ウヰスキー|whisky|whiskey/i.test(t)) out.category = 'ウイスキー';
  else if (/梅酒|果実酒/.test(t)) out.category = '梅酒・果実酒';
  else if (/ワイン|wine/i.test(t)) out.category = 'ワイン';
  else if (/ビール|beer|発泡酒/i.test(t)) out.category = 'ビール';
  else if (/清酒|日本酒|吟醸|純米|本醸造/.test(t)) out.category = '日本酒';

  const pref = PREFS.find((p) => t.includes(p)) || PREF_SHORT.find(([, s]) => s.length >= 2 && t.includes(s + '市'))?.[0];
  if (pref) out.pref = pref;

  const brewery = t.match(/(?:製造者|製造元|蔵元)[:：]?((?:株式会社|有限会社|合名会社|合資会社)?[^\d%,、。・()（）:：]{1,14}?(?:酒造店|酒造場|酒造|醸造店|醸造|銘醸|本店|商店|酒類))/) ||
    t.match(/(?:株式会社|有限会社|合名会社|合資会社)?([^\d%,、。・()（）:：株有合]{1,10}?(?:酒造店|酒造場|酒造|醸造店|醸造|銘醸|酒類))/);
  if (brewery) out.brewery = brewery[1].replace(/^(株式会社|有限会社|合名会社|合資会社)/, '');

  return out;
}

const WIKI = 'https://ja.wikipedia.org';

/** Wikipedia で検索して最も近い記事の概要を返す（ネット接続が必要） */
export async function searchWikipedia(name, category = '日本酒') {
  const q = `${name} ${category === 'その他' ? 'お酒' : category}`;
  const sr = await fetch(`${WIKI}/w/api.php?action=query&list=search&format=json&origin=*&srlimit=3&srsearch=${encodeURIComponent(q)}`);
  if (!sr.ok) throw new Error('検索に失敗しました');
  const hits = (await sr.json()).query?.search || [];
  if (!hits.length) return null;
  const hit = hits.find((h) => h.title.includes(normalize(name))) || hits[0];
  const res = await fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
  if (!res.ok) throw new Error('記事を取得できませんでした');
  const page = await res.json();
  return {
    title: page.title,
    extract: page.extract || '',
    url: page.content_urls?.mobile?.page || `${WIKI}/wiki/${encodeURIComponent(hit.title)}`,
  };
}

export const googleUrl = (name) => `https://www.google.com/search?q=${encodeURIComponent(`${name} 酒蔵 産地`)}`;

export const brandNames = () => BRANDS.map((b) => b.name);
