const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, process.env.SUPABASE_SERVICE_KEY);

const KEYWORDS = ['adhd', 'تشتت', 'انتباه', 'فرط', 'حركة', 'النمو العصبي', 'psychology', 'autism', 'توحد', 'تأخر', 'العصبية', 'التوتر', 'stress', 'mental', 'anxiety', 'focus'];

const sources = [
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", selector: ".card, .article-card", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0, article", lang: "en" },
    { name: "Verywell Mind", url: "https://www.verywellmind.com/adhd-4157274", selector: ".mntl-card-list-items", lang: "en" },
    { name: "Psychology Today", url: "https://www.psychologytoday.com/intl/basics/adhd", selector: ".blog_post_card, .teaser-card", lang: "en" }
];

async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        const res = await translate(text, { from: fromLang, to: toLang });
        return res && res.text ? res.text : null;
    } catch (err) {
        console.error(`⚠️ Translation Error (${fromLang} -> ${toLang}):`, err.message);
        return null;
    }
}

async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        let contentSelectors = ['.article-content p', '.article-body p', '.mntl-sc-block-group--text p', '.entry-content p', '.css-1v96o8 p', 'article p'];
        
        $(contentSelectors.join(', ')).each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 50 && !txt.includes('اقرأ أكثر') && !txt.includes('إشترك')) {
                paragraphs.push(txt);
            }
        });
        return paragraphs.length >= 1 ? paragraphs.join('\n\n') : null;
    } catch (e) { return null; }
}

// دالة ذكية لاستخراج صورة الغلاف الحقيقية
async function fetchMainImage($, articleEl, sourceUrl) {
    let imageUrl = null;
    
    // 1. محاولة إيجاد الصورة في العنصر نفسه (القائمة)
    const imgCandidates = articleEl.find('img');
    imgCandidates.each((i, el) => {
        const src = $(el).attr('data-src') || $(el).attr('srcset')?.split(' ')[0] || $(el).attr('src');
        if (src && src.length > 10 && !src.includes('clock') && !src.includes('time') && !src.includes('avatar') && !src.includes('logo')) {
            imageUrl = src;
            return false; // كسر الحلقة عند العثور على أول صورة مناسبة
        }
    });

    // 2. إذا لم يجد في القائمة، يأخذ صورة الـ OG Meta من الرابط الأصلي للمقال (أدق صورة غلاف)
    if (!imageUrl || imageUrl.includes('data:image')) {
        try {
            const res = await axios.get(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
            const $page = cheerio.load(res.data);
            imageUrl = $page('meta[property="og:image"]').attr('content') || 
                       $page('meta[name="twitter:image"]').attr('content');
        } catch (e) {}
    }

    // 3. تصحيح المسار إذا كان نسبياً
    if (imageUrl && !imageUrl.startsWith('http')) {
        const origin = new URL(sourceUrl).origin;
        imageUrl = origin + (imageUrl.startsWith('/') ? '' : '/') + imageUrl;
    }

    // 4. خيار احتياطي احترافي (Unsplash) بدلاً من صورة الساعة
    if (!imageUrl) {
        imageUrl = `https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=1200&auto=format&fit=crop`;
    }

    return imageUrl;
}

async function masterScraper() {
    console.log("🚀 Starting Smart Scraper with Real Cover Images...");
    
    for (const source of sources) {
        try {
            console.log(`\n🔎 Source: ${source.name}`);
            const response = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data);
            const items = $(source.selector).slice(0, 10); 

            for (let i = 0; i < items.length; i++) {
                const el = $(items[i]);
                const title = el.find('h2, h3, .card__title, .mntl-card-list-items__title').first().text().trim();
                if (!title || !KEYWORDS.some(key => title.toLowerCase().includes(key))) continue;

                let link = el.find('a').attr('href') || el.attr('href');
                if (!link) continue;
                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                const content = await fetchFullContent(fullLink);
                if (!content) continue;

                // استخراج صورة الغلاف الحقيقية
                const imageUrl = await fetchMainImage($, el, fullLink);

                const payload = {
                    source_name: source.name,
                    source_url: fullLink,
                    image_url: imageUrl,
                    slug: title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 60) + "-" + Date.now(),
                    is_published: true,
                };

                // منطق الترجمة المزدوجة
                if (source.lang === 'ar') {
                    payload.title_ar = title;
                    payload.content_ar = content;
                    payload.excerpt_ar = title.substring(0, 150);
                    const [tT, tC] = await Promise.all([smartTranslate(title, 'ar', 'en'), smartTranslate(content, 'ar', 'en')]);
                    payload.title_en = tT; payload.content_en = tC; payload.excerpt_en = tT ? tT.substring(0, 150) : null;
                } else {
                    payload.title_en = title;
                    payload.content_en = content;
                    payload.excerpt_en = title.substring(0, 150);
                    const [tT, tC] = await Promise.all([smartTranslate(title, 'en', 'ar'), smartTranslate(content, 'en', 'ar')]);
                    payload.title_ar = tT; payload.content_ar = tC; payload.excerpt_ar = tT ? tT.substring(0, 150) : null;
                }

                await supabase.from('articles').upsert(payload, { onConflict: 'source_url' });
                console.log(`✅ Saved: "${title.substring(0, 30)}..." with real image.`);
            }
        } catch (e) { console.log(`❌ Error: ${e.message}`); }
    }
    console.log("\n🏁 Done.");
}

masterScraper().then(() => process.exit(0));