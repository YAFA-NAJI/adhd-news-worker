const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('google-translate-api-x'); // استخدام المكتبة الأحدث
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, 
    process.env.SUPABASE_SERVICE_KEY        
);

const MAX_ARTICLES_PER_RUN = 3; 
const KEYWORDS = ['adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 'النمو العصبي', 'neurodiversity','ADHD'];

const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/category/parenting-adhd-kids/", lang: "en" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", lang: "en" },
    { name: "Psychiatrist.com", url: "https://www.psychiatrist.com/news/", lang: "en" },
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", lang: "ar" }
];

const DEFAULT_IMAGES = [
    "https://images.pexels.com/photos/8560016/pexels-photo-8560016.jpeg?auto=compress&cs=tinysrgb&w=600", 
    "https://media.gemini.media/img/normal/2024/1/8/2024_1_8_18_15_56_754.jpg", 
    "https://www.egyptke.com/UploadCache/libfiles/10/0/800x450o/807.jpg", 
    "https://images.pexels.com/photos/5710953/pexels-photo-5710953.jpeg", 
    "https://gadalta.org.il/wp-content/uploads/2016/09/wsi-imageoptim-307.jpg", 
    "https://images.pexels.com/photos/7579174/pexels-photo-7579174.jpeg",
    "https://images.pexels.com/photos/8560014/pexels-photo-8560014.jpeg",
    "https://images.pexels.com/photos/12955556/pexels-photo-12955556.jpeg",
    "https://images.pexels.com/photos/8378730/pexels-photo-8378730.jpeg",
    "https://images.pexels.com/photos/8378728/pexels-photo-8378728.jpeg",
    "https://images.pexels.com/photos/3958418/pexels-photo-3958418.jpeg",
    "https://images.pexels.com/photos/3958400/pexels-photo-3958400.jpeg",
    "https://media.istockphoto.com/id/1927703857/photo/man-with-brain-stroke.jpg?s=612x612&w=0&k=20&c=KXuO0qyYo9vQO-Bxdts9QWm82E6GMEEbN8i6I7yzHlk=",
    "https://media.istockphoto.com/id/1435795971/photo/lazy-student-girl-at-home.jpg?s=612x612&w=0&k=20&c=wFsgCcZf5U38f2k6nINR70JO-SoPBUnHaj5jpUehl8o=",
    "https://media.istockphoto.com/id/924925656/photo/thoughtful-stressed-young-man-with-a-mess-in-his-head.jpg?s=612x612&w=0&k=20&c=-nHtAf78D-TFdVdtluJXdewjyvGAIx7w2zdPIYj8ceQ=",
    "https://media.istockphoto.com/id/1911523324/photo/stressed-mother-having-problem-with-noisy-naughty-daughter.jpg?s=612x612&w=0&k=20&c=-nuo8YwJ0Gzk0SneGAGdE-tYYQ4-ceGjmrWp7z5EGZM=",
    "https://media.istockphoto.com/id/2045635756/photo/young-male-college-student-looking-stressed-about-his-schoolwork.jpg?s=612x612&w=0&k=20&c=e6snZviJtD4Zb9kQ7j8apej15JB1wRNxsuXHsR0GFAA=",
    "https://media.istockphoto.com/id/1384818373/photo/unhappy-mommy-with-daughter.jpg?s=612x612&w=0&k=20&c=eA5wZmkeM4QcTQlsRUSmvFGMsW1_oGoR8aet9B_s9hI=",
    "https://media.istockphoto.com/id/2100350300/photo/adhd-diagnosis-and-treatment-3d-rendering.jpg?s=612x612&w=0&k=20&c=XyXpsDSEXjTwKnAQQyWYH4za33QRpVF6xU93geGhIf0=",
    "https://media.istockphoto.com/id/1158481725/photo/frustrated-stressed-african-mom-feel-tired-annoyed-about-noisy-kids.jpg?s=612x612&w=0&k=20&c=JOU1PF09VszjLBgbaHukrRCvDwMc-7F4fyavOMZ9oNU="
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة الترجمة الذكية مع تقسيم النص الطويل
async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        // إذا كان النص طويلاً جداً (أكثر من 2500 حرف)، نقسمه لفقرات
        if (text.length > 2500) {
            const paragraphs = text.split('\n\n');
            let translatedParts = [];
            for (let p of paragraphs) {
                if (p.trim() === "") continue;
                const res = await translate(p, { from: fromLang, to: toLang });
                translatedParts.push(res.text);
                await sleep(500); // تهدئة الطلبات لـ Google
            }
            return translatedParts.join('\n\n');
        } else {
            const res = await translate(text, { from: fromLang, to: toLang });
            return res.text;
        }
    } catch (e) {
        console.error(`   ❌ Translation failed for a section: ${e.message}`);
        return text; // في حال الفشل نرجع النص الأصلي
    }
}

async function extractImageUrl(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }, 
            timeout: 10000 
        });
        const $ = cheerio.load(response.data);
        let image = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');

        const blockedSites = ['additudemag.com', 'medicalnewstoday.com', 'psychiatrist.com'];
        const isBlocked = blockedSites.some(site => url.includes(site));

        if (!image || isBlocked || !image.startsWith('http')) {
            console.log(`   🎨 Applying fallback image.`);
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
        $('article p, .article-body p, .entry-content p, p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 80) paragraphs.push(txt);
        });
        return paragraphs.slice(0, 12).join('\n\n'); 
    } catch (e) { return null; }
}

async function masterScraper() {
    console.log("🚀 Starting Scraper with Translation Engine...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;
        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            const response = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data);
            
            let foundItems = [];
            $('a').each((i, el) => {
                const title = $(el).text().trim();
                const link = $(el).attr('href');
                if (title.length > 25 && KEYWORDS.some(key => title.toLowerCase().includes(key.toLowerCase()))) {
                    if (link && !link.includes('/category/') && !link.includes('/tag/')) {
                        foundItems.push({ title, link });
                    }
                }
            });

            let uniqueItems = Array.from(new Map(foundItems.map(item => [item.link, item])).values());

            for (const item of uniqueItems) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const fullLink = item.link.startsWith('http') ? item.link : (new URL(source.url).origin + item.link);
                const { data: existing } = await supabase.from('articles').select('id').eq('source_url', fullLink).maybeSingle();
                if (existing) continue;

                console.log(`   🎯 Catching: "${item.title.substring(0, 40)}..."`);
                const content = await fetchFullContent(fullLink);
                if (!content || content.length < 200) continue;

                const finalImageUrl = await extractImageUrl(fullLink);
                const articleSlug = item.title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 50) + "-" + Date.now();
                
                let articleData = {
                    source_name: source.name,
                    source_url: fullLink,
                    slug: articleSlug,
                    image_url: finalImageUrl,
                    created_at: new Date().toISOString()
                };

                // منطق الترجمة المزدوجة
                if (source.lang === 'ar') {
                    console.log("      🌐 Translating (Arabic -> English)...");
                    articleData.title_ar = item.title;
                    articleData.content_ar = content;
                    articleData.title_en = await smartTranslate(item.title, 'ar', 'en');
                    articleData.content_en = await smartTranslate(content, 'ar', 'en');
                } else {
                    console.log("      🌐 Translating (English -> Arabic)...");
                    articleData.title_en = item.title;
                    articleData.content_en = content;
                    articleData.title_ar = await smartTranslate(item.title, 'en', 'ar');
                    articleData.content_ar = await smartTranslate(content, 'en', 'ar');
                }

                const { data: newArticle, error: articleError } = await supabase.from('articles').insert([articleData]).select().single();
                if (articleError) {
                    console.error("   ❌ Supabase Insert Error:", articleError.message);
                    continue;
                }

                await supabase.from('content_items').insert([{
                    external_article_id: newArticle.id,
                    content_type: 'external_article',
                    slug: articleSlug,
                    is_published: true,
                    published_at: new Date().toISOString()
                }]);

                console.log(`   ✅ Saved & Translated.`);
                totalSaved++;
                await sleep(3000); // زيادة مدة النوم لتجنب حظر جوجل
            }
        } catch (e) { console.error(`❌ Error: ${e.message}`); }
    }
    console.log("\n🏁 Done. Total new articles added:", totalSaved);
}

masterScraper();