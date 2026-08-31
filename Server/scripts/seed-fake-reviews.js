/**
 * Seed 100 published guest reviews across active units (uneven distribution).
 * Usage: node scripts/seed-fake-reviews.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { query, pool } = require('../src/config/db');
const { syncUnitRating } = require('../src/routes/reviews');

const ENGLISH_NAMES = [
  'Ahmed Hassan',
  'Mohamed Ali',
  'Sara Ibrahim',
  'Nourhan Mahmoud',
  'Youssef Abdelrahman',
  'Mariam Khaled',
  'Omar Fathy',
  'Yasmin Saeed',
  'Karim Mostafa',
  'Hoda Farouk',
  'Abdullah Nabil',
  'Dina Hussein',
  'Hossam Rabie',
  'Salma Tarek',
  'Mahmoud Galal',
  'Fatma Anwar',
  'Ibrahim Samir',
  'Rania Wael',
  'Tamer Shawky',
  'Nadia Kamal',
  'Amir Reda',
  'Lina Adel',
  'Sherif Magdy',
  'Maysa Hamdy',
  'Bassem Fathallah',
  'Heba Salah',
  'Ziad Mansour',
  'Aya Gamal',
  'Mostafa Emad',
  'Nour El Din',
  'Farida Ashraf',
  'Hassan Younis',
];

const ARABIC_EGYPTIAN_NAMES = [
  'أحمد حسن',
  'محمد علي',
  'سارة إبراهيم',
  'نورهان محمود',
  'يوسف عبد الرحمن',
  'مريم خالد',
  'عمر فتحي',
  'ياسمين سعيد',
  'كريم مصطفى',
  'هدى فاروق',
  'عبدالله نبيل',
  'دينا حسين',
  'حسام ربيع',
  'سلمى طارق',
  'محمود جلال',
  'فاطمة أنور',
  'إبراهيم سمير',
  'رانيا وائل',
  'تامر شوقي',
  'نادية كمال',
  'أمير رضا',
  'لينا عادل',
  'شريف مجدي',
  'ميساء حمدي',
  'باسم فتح الله',
  'هبة صلاح',
  'زياد منصور',
  'آية جمال',
];

const COMMENTS_5_EN = [
  'Absolutely loved our stay. The apartment was spotless and exactly as pictured. Check-in was smooth and the location made everything easy.',
  'Fantastic unit — quiet, clean, and thoughtfully stocked. We would book again without thinking twice.',
  'Beautiful place with great views. Everything worked perfectly and the beds were very comfortable.',
  'Exceeded expectations. Spacious, stylish, and the host communication was excellent throughout.',
  'One of the best Airbnb-style stays we have had in Egypt. Highly recommend for families.',
  'Loved the vibe of the unit. Modern finishes, strong Wi‑Fi, and a kitchen we actually used every day.',
  'Perfect weekend getaway. Clean towels, fast hot water, and a really calm atmosphere.',
  'Super easy arrival, keys ready, and the living room is perfect for kids. Felt like a real home.',
  'Very professional team. Unit smelled fresh, linens were crisp, and the balcony view was a highlight.',
  'We hosted friends here for a long weekend — everyone complimented the design and cleanliness.',
  'Quiet nights, strong AC, and a fully usable kitchen. Exactly what we needed after a busy week.',
];

const COMMENTS_5_AR = [
  'مكان نظيف جداً والتنظيم ممتاز. الإقامة كانت مريحة والتعامل راقي. هحجز تاني بكل تأكيد.',
  'الشقة زي الصور بالظبط، واسعة ونضيفة. الموقع كويس والخدمات سريعة. شكراً جداً.',
  'تجربة ممتازة من أول تواصل لحد الخروج. المكان هادي ومجهز كويس جداً.',
  'حجز سلس والشقة فوق الممتاز. الأمان في الكمبوند يريح، والمكان واسع للعيلة.',
  'الإضاءة حلوة والأوض واسعة. التعامل محترم جداً وهنرجع تاني إن شاء الله.',
  'كل حاجة كانت جاهزة ومريحة. النظافة عالية والسرير مريح جداً.',
  'المكان هادي والإطلالة جميلة. خدمة سريعة وهحجز معاكم تاني.',
  'أفضل إقامة قضيناها في الساحل. الشقة واسعة ومجهزة كويس للعيلة.',
];

const COMMENTS_4_EN = [
  'Really nice stay overall. A couple of small things (shower pressure, missing spatula) but nothing major. Would still recommend.',
  'Great location and clean rooms. Check-out felt a bit rushed, but we enjoyed the apartment.',
  'Comfortable and well maintained. Parking was slightly tricky, otherwise solid 4 stars.',
  'Good value and friendly coordination. The AC in one room was a little loud at night.',
  'Nice place, photos are accurate. Wi‑Fi dropped once or twice but came back quickly.',
  'Enjoyed our stay. Beach access was convenient; the sofa could use a refresh someday.',
  'Pretty good overall. Building entrance was a bit confusing the first night, then it was fine.',
  'Clean and comfortable. Would have given 5 if the coffee machine had been working.',
  'Solid stay for the price. Check-in instructions were clear; towels could be softer.',
  'Lovely layout and daylight. Minor scuff on the wardrobe door but we still had a great time.',
];

const COMMENTS_4_AR = [
  'المكان حلو ونضيف، بس المصعد كان بطيء شوية. غير كده الإقامة كانت كويسة.',
  'إقامة لطيفة والشقة مرتبة. كان ناقص كام حاجة بسيطة في المطبخ بس عموماً راضيين.',
  'الموقع ممتاز للشغل من البيت، بس الصوت من الجيران ظهر يوم واحد. غير كده تمام.',
  'الشقة نظيفة والمكان مريح، بس التكييف في أوضة كان عالي شوية في الصوت.',
  'إقامة كويسة والموقع مناسب. الخروج كان مستعجل شوية بس التجربة حلوة.',
  'حاجات بسيطة ناقصة في المطبخ، غير كده المكان مرتب وهيستاهل أربع نجوم.',
];

const COMMENTS_3_EN = [
  'Average stay. The unit was fine for a short trip, but cleaning could have been more thorough in the bathroom corners.',
  'Okay experience. Location is good, though noise from the hallway was noticeable late evening.',
  'Decent apartment but not quite matching the listing photos — a bit more worn than expected. Staff still helpful.',
  'Fine for one night. Kitchen utensils were limited and the water heater took a while to warm up.',
  'Mixed feelings — spacious layout, but some stains on the couch and slow response on one request.',
  'Not bad, not great. Good for a quick work trip if you mainly need a bed and desk.',
  'Acceptable cleanliness, but the mattress felt uneven. Would consider another unit next time.',
  'Location saves it. Inside, a few bulbs were out and the balcony door stuck a little.',
];

const COMMENTS_3_AR = [
  'الإقامة مقبولة بس مش أكتر. في تفاصيل بسيطة محتاجة اهتمام زي الروائح في الحمام.',
  'مكان عادي، السرير مريح لكن التكييف كان ضعيف في أوضتين. السعر مناسب تقريباً.',
  'الشقة واسعة لكن المفروشات قديمة شوية. الإقامة عدّت عادي من غير مشاكل كبيرة.',
  'التجربة متوسطة. المكان كويس للمبيت السريع بس النظافة محتاجة شوية تركيز.',
  'في ضوضاء من السلم بالليل، والمكان مش مطابق للصور أوي. التعامل كان كويس.',
  'مقبول لليلة واحدة، بس السخان اتأخر والمطبخ ناقصه حاجات.',
];

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length)];
}

function weightedRating(rand) {
  const x = rand();
  if (x < 0.55) return 5;
  if (x < 0.82) return 4;
  return 3;
}

function commentsFor(rating, arabic) {
  if (rating >= 5) return arabic ? COMMENTS_5_AR : COMMENTS_5_EN;
  if (rating === 4) return arabic ? COMMENTS_4_AR : COMMENTS_4_EN;
  return arabic ? COMMENTS_3_AR : COMMENTS_3_EN;
}

function commentFor(rating, rand, arabicName) {
  // Arabic-script names always write in Arabic.
  // Latin Egyptian names mostly English, with a chance of Arabic comments.
  const useArabic = arabicName || rand() < 0.28;
  return pick(rand, commentsFor(rating, useArabic));
}

function guestName(rand) {
  // ~45% Arabic script, rest Latin Egyptian names
  if (rand() < 0.45) return { name: pick(rand, ARABIC_EGYPTIAN_NAMES), arabic: true };
  return { name: pick(rand, ENGLISH_NAMES), arabic: false };
}

/** Zipf-ish uneven weights so a few units get many reviews and some get few/none. */
function buildUnevenCounts(unitCount, total, rand) {
  const weights = [];
  for (let i = 0; i < unitCount; i += 1) {
    // shuffle rank via rand so popular units aren't always first in DB order
    const rank = i + 1 + rand() * 0.3;
    weights.push(1 / Math.pow(rank, 0.85));
  }
  // Zero out ~15–25% of units so distribution is visibly uneven
  for (let i = 0; i < unitCount; i += 1) {
    if (rand() < 0.2) weights[i] = 0;
  }
  // Ensure at least a handful of units can receive reviews
  if (weights.every((w) => w === 0)) {
    for (let i = 0; i < Math.min(5, unitCount); i += 1) weights[i] = 1;
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / sum) * total));
  let assigned = counts.reduce((a, b) => a + b, 0);
  // Give leftovers to heaviest units
  const order = counts
    .map((c, i) => ({ i, w: weights[i] }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.i);
  let o = 0;
  while (assigned < total && order.length) {
    const idx = order[o % order.length];
    if (weights[idx] > 0) {
      counts[idx] += 1;
      assigned += 1;
    }
    o += 1;
    if (o > total * 3) break;
  }
  return counts;
}

function daysAgo(rand, maxDays) {
  const days = Math.floor(rand() * maxDays);
  const hours = Math.floor(rand() * 24);
  const mins = Math.floor(rand() * 60);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hours, mins, Math.floor(rand() * 60), 0);
  return d;
}

async function main() {
  const TOTAL = 100;
  const rand = mulberry32(20260831);

  const { rows: units } = await query(
    `SELECT id, wp_post_id, title, unit_number, slug, status
     FROM units
     ORDER BY created_at ASC NULLS LAST, unit_number ASC NULLS LAST`
  );

  if (!units.length) {
    console.error('No units found to attach reviews to.');
    process.exit(1);
  }

  console.log(`Found ${units.length} units. Seeding ${TOTAL} reviews…`);

  // Shuffle unit order for distribution ranks
  const shuffled = [...units];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const counts = buildUnevenCounts(shuffled.length, TOTAL, rand);
  const touched = new Set();
  let inserted = 0;

  for (let i = 0; i < shuffled.length; i += 1) {
    const n = counts[i];
    if (!n) continue;
    const unit = shuffled[i];
    for (let k = 0; k < n; k += 1) {
      const rating = weightedRating(rand);
      const { name, arabic } = guestName(rand);
      const comment = commentFor(rating, rand, arabic);
      const createdAt = daysAgo(rand, 420);

      await query(
        `INSERT INTO reviews (unit_id, listing_wp_id, guest_user_id, guest_name, rating, comment, published, created_at)
         VALUES ($1, $2, NULL, $3, $4, $5, true, $6)`,
        [unit.id, unit.wp_post_id || null, name, rating, comment, createdAt.toISOString()]
      );
      inserted += 1;
    }
    touched.add(unit.id);
    console.log(
      `  ${unit.unit_number || unit.slug || unit.id.slice(0, 8)} → ${n} review(s)`
    );
  }

  for (const unitId of touched) {
    await syncUnitRating(unitId);
  }

  const { rows: stats } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE rating = 5)::int AS r5,
       COUNT(*) FILTER (WHERE rating = 4)::int AS r4,
       COUNT(*) FILTER (WHERE rating = 3)::int AS r3,
       COUNT(DISTINCT unit_id)::int AS units_with_reviews
     FROM reviews
     WHERE guest_user_id IS NULL
       AND published = true
       AND created_at > now() - interval '1 minute'`
  ).catch(() => ({ rows: [{}] }));

  // Broader verification for this seed batch is hard by time; report from counts
  const { rows: dist } = await query(
    `SELECT rating, COUNT(*)::int AS c
     FROM reviews
     WHERE published = true
     GROUP BY rating
     ORDER BY rating DESC`
  );
  const { rows: top } = await query(
    `SELECT u.unit_number, u.title, u.review_count, u.average_rating
     FROM units u
     WHERE u.review_count > 0
     ORDER BY u.review_count DESC
     LIMIT 12`
  );

  console.log(`\nInserted ${inserted} reviews across ${touched.size} units.`);
  console.log('Rating mix (all published reviews):', dist);
  console.log('Top units by review_count:', top);
  if (stats[0]?.total != null) console.log('Recent null-guest inserts window:', stats[0]);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
