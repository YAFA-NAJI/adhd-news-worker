const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser'); // مكتبة معالجة الـ RSS
const { translate } = require('google-translate-api-x');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const parser = new Parser();
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, 
    process.env.SUPABASE_SERVICE_KEY        
);

const MAX_ARTICLES_PER_RUN = 3; 
const KEYWORDS = ['adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 'النمو العصبي', 'neurodiversity'];

// استخدام روابط الـ RSS لضمان جلب أحدث المقالات فور صدورها
const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/feed/", lang: "en" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/rss/adhd", lang: "en" },
    { name: "Psychology Today", url: "https://www.psychologytoday.com/intl/front/feed", lang: "en" }, // أضفت هذا المصدر لقوته
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", lang: "ar", isRSS: false }, // الطبي لا يوفر RSS بسهولة
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", lang: "ar", isRSS: false }
];

const DEFAULT_IMAGES = [
    "https://images.pexels.com/photos/8560016/pexels-photo-8560016.jpeg", 
    "https://images.pexels.com/photos/5710953/pexels-photo-5710953.jpeg", 
    "https://images.pexels.com/photos/7579174/pexels-photo-7579174.jpeg",
    "https://images.pexels.com/photos/8560014/pexels-photo-8560014.jpeg"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        if (text.length > 2500) {
            const paragraphs = text.split('\n\n');
            let translatedParts = [];
            for (let p of paragraphs) {
                if (p.trim() === "") continue;
                const res = await translate(p, { from: fromLang, to: toLang });
                translatedParts.push(res.text);
                await sleep(1000); 
            }
            return translatedParts.join('\n\n');
        } else {
            const res = await translate(text, { from: fromLang, to: toLang });
            return res.text;
        }
    } catch (e) {
        console.error(`   ❌ Translation failed: ${e.message}`);
        return text; 
    }
}

async function extractImageUrl(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 
            timeout: 10000 
        });
        const $ = cheerio.load(response.data);
        let image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');

        if (!image || !image.startsWith('http')) {
            return DEFAULT_IMAGES[Math.floor(Math.random() * DEFAULT_IMAGES.length)];
        }
        return image;
    } catch (e) {
        return DEFAULT_IMAGES[Math.floor(Math.random() * DEFAULT_IMAGES.length)];
    }
}

async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        // سحب المحتوى مع استثناء العناصر غير المرغوبة
        $('article p, .article-body p, .entry-content p, p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 80 && !txt.includes('©') && !txt.includes('All rights reserved')) {
                paragraphs.push(txt);
            }
        });
        return paragraphs.slice(0, 10).join('\n\n'); 
    } catch (e) { return null; }
}

async function masterScraper() {
    console.log("🚀 Starting Optimized Scraper (RSS + HTML)...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;
        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            let foundItems = [];

            if (source.isRSS !== false) {
                // قراءة الـ RSS
                const feed = await parser.parseURL(source.url);
                foundItems = feed.items.map(item => ({
                    title: item.title,
                    link: item.link
                }));
            } else {
                // قراءة الـ HTML للمواقع التي لا تملك RSS
                const response = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                const $ = cheerio.load(response.data);
                $('a').each((i, el) => {
                    const title = $(el).text().trim();
                    const link = $(el).attr('href');
                    if (title.length > 25 && link) {
                        foundItems.push({ title, link });
                    }
                });
            }

            // تصفية النتائج بناءً على الكلمات المفتاحية وعدم التكرار
            let filteredItems = foundItems.filter(item => {
                const searchArea = (item.title + item.link).toLowerCase();
                return KEYWORDS.some(key => searchArea.includes(key.toLowerCase()));
            });

            // حذف التكرار في نفس الدورة
            let uniqueItems = Array.from(new Map(filteredItems.map(item => [item.link, item])).values());

            for (const item of uniqueItems) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const fullLink = item.link.startsWith('http') ? item.link : (new URL(source.url).origin + item.link);
                
                // التأكد من عدم وجود المقال مسبقاً في الداتابيز
                const { data: existing } = await supabase.from('articles').select('id').eq('source_url', fullLink).maybeSingle();
                if (existing) continue;

                console.log(`   🎯 New Content Found: "${item.title.substring(0, 50)}..."`);
                const content = await fetchFullContent(fullLink);
                if (!content || content.length < 300) continue;

                const finalImageUrl = await extractImageUrl(fullLink);
                const articleSlug = item.title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 50) + "-" + Date.now();
                
                let articleData = {
                    source_name: source.name,
                    source_url: fullLink,
                    slug: articleSlug,
                    image_url: finalImageUrl,
                    created_at: new Date().toISOString()
                };

                if (source.lang === 'ar') {
                    console.log("      🌐 Translating (AR -> EN)...");
                    articleData.title_ar = item.title;
                    articleData.content_ar = content;
                    articleData.title_en = await smartTranslate(item.title, 'ar', 'en');
                    articleData.content_en = await smartTranslate(content, 'ar', 'en');
                } else {
                    console.log("      🌐 Translating (EN -> AR)...");
                    articleData.title_en = item.title;
                    articleData.content_en = content;
                    articleData.title_ar = await smartTranslate(item.title, 'en', 'ar');
                    articleData.content_ar = await smartTranslate(content, 'en', 'ar');
                }

                const { data: newArticle, error: articleError } = await supabase.from('articles').insert([articleData]).select().single();
                if (articleError) {
                    console.error("   ❌ Supabase Error:", articleError.message);
                    continue;
                }

                await supabase.from('content_items').insert([{
                    external_article_id: newArticle.id,
                    content_type: 'external_article',
                    slug: articleSlug,
                    is_published: true,
                    published_at: new Date().toISOString()
                }]);

                console.log(`   ✅ Successfully Saved.`);
                totalSaved++;
                await sleep(5000); // زيادة وقت الانتظار لتجنب الـ Rate Limit
            }
        } catch (e) { console.error(`❌ Error with ${source.name}: ${e.message}`); }
    }
    console.log("\n🏁 Done. Total new articles added:", totalSaved);
}

masterScraper();