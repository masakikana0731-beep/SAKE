export const PREFS = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
export const OTHER_ORIGINS = ['海外', '不明'];

export const CATEGORIES = ['日本酒', '焼酎', '泡盛', 'ワイン', 'ビール', 'ウイスキー', '梅酒・果実酒', 'その他'];

export const TYPES = [
  '純米大吟醸', '大吟醸', '純米吟醸', '吟醸', '特別純米', '純米', '特別本醸造', '本醸造', '普通酒',
  '生酛', '山廃', '生酒', '生詰', 'ひやおろし', '原酒', 'にごり', 'スパークリング', '古酒',
  '芋焼酎', '麦焼酎', '米焼酎', '黒糖焼酎', '赤ワイン', '白ワイン', 'ロゼ', 'IPA', 'ラガー',
  'シングルモルト', 'ブレンデッド',
];

export const TEMPS = [
  '雪冷え 5℃', '花冷え 10℃', '涼冷え 15℃', '常温', '日向燗 30℃', '人肌燗 35℃',
  'ぬる燗 40℃', '上燗 45℃', '熱燗 50℃', '飛び切り燗 55℃', 'ロック', '水割り', 'お湯割り', 'ソーダ割り',
];

export const TASTE_AXES = [
  { key: 'aroma', label: '香り' },
  { key: 'sweet', label: '甘み' },
  { key: 'acid', label: '酸味' },
  { key: 'umami', label: '旨味' },
  { key: 'dry', label: 'キレ' },
  { key: 'body', label: 'コク' },
];

const prefCount = (rs) => new Set(rs.map((r) => r.pref).filter((p) => PREFS.includes(p))).size;
const maxBrewery = (rs) => {
  const m = {};
  for (const r of rs) if (r.brewery) m[r.brewery] = (m[r.brewery] || 0) + 1;
  return Math.max(0, ...Object.values(m));
};

export const BADGES = [
  { icon: '🍶', name: 'はじめの一本', desc: '最初の1本を記録', test: (rs) => rs.length >= 1 },
  { icon: '🔟', name: '十本達成', desc: '10本記録', test: (rs) => rs.length >= 10 },
  { icon: '🏮', name: '五十本の酒豪', desc: '50本記録', test: (rs) => rs.length >= 50 },
  { icon: '🏯', name: '百本斬り', desc: '100本記録', test: (rs) => rs.length >= 100 },
  { icon: '🗾', name: '五県めぐり', desc: '5都道府県のお酒', test: (rs) => prefCount(rs) >= 5 },
  { icon: '🚄', name: '日本半周', desc: '24都道府県のお酒', test: (rs) => prefCount(rs) >= 24 },
  { icon: '👑', name: '全国制覇', desc: '47都道府県すべて', test: (rs) => prefCount(rs) >= 47 },
  { icon: '♨️', name: '燗酒デビュー', desc: '燗で飲んだ記録', test: (rs) => rs.some((r) => (r.temps || []).some((t) => t.includes('燗'))) },
  { icon: '⭐', name: '運命の一本', desc: '★5をつけた', test: (rs) => rs.some((r) => r.rating === 5) },
  { icon: '💎', name: '大吟醸の誘惑', desc: '大吟醸を記録', test: (rs) => rs.some((r) => (r.type || '').includes('大吟醸')) },
  { icon: '🌈', name: '酒の旅人', desc: '3カテゴリ以上', test: (rs) => new Set(rs.map((r) => r.category)).size >= 3 },
  { icon: '🏭', name: '蔵推し', desc: '同じ蔵を3本', test: (rs) => maxBrewery(rs) >= 3 },
  { icon: '🍽', name: 'ペアリング上手', desc: '料理を5回記録', test: (rs) => rs.filter((r) => r.pairing).length >= 5 },
];
