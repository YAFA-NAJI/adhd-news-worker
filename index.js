const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, process.env.SUPABASE_SERVICE_KEY);

const KEYWORDS = ['adhd', 'تشتت', 'انتباه', 'فرط', 'حركة', 'النمو العصبي', 'psychology', 'autism', 'توحد', 'تأخر', 'العصبية', 'التوتر'];

const sources = [
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0", lang: "en" }
];

async function fetchFullContent(url, sourceName) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36' },
            timeout: 15000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];

        let contentSelector = sourceName === "Medical News Today" 
            ? '.css-1v96o8 p, .article-body p, article p' 
            : '.article-content p, article p, .text-content p';

        $(contentSelector).each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 60 && !txt.includes('إشترك الآن') && !txt.toLowerCase().includes('copyright')) {
                paragraphs.push(txt);
            }
        });

        return paragraphs.length >= 3 ? paragraphs.join('\n\n') : null;
    } catch (e) {
        return null;
    }
}

async function masterScraper() {
    console.log("🚀 Starting Smart ADHD Content Engine with AI Image Selection...");
    
    for (const source of sources) {
        try {
            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0' } 
            });
            const $ = cheerio.load(response.data);
            const items = $(source.selector).slice(0, 10); 

            for (let i = 0; i < items.length; i++) {
                const el = $(items[i]);
                const title = el.find('h2, h3').first().text().trim();
                
                if (!title || !KEYWORDS.some(key => title.toLowerCase().includes(key))) continue;

                let link = el.find('a').attr('href');
                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                const content = await fetchFullContent(fullLink, source.name);
                if (!content) continue;

                // --- منطق استخراج وتوليد الصور الذكي ---
                let imageUrl = null;
                const imgElement = el.find('img').filter(function() {
                    const src = $(this).attr('src') || '';
                    return !src.includes('clock') && !src.includes('time') && !src.includes('user-icon');
                }).first();

                imageUrl = imgElement.attr('data-src') || imgElement.attr('srcset')?.split(' ')[0] || imgElement.attr('src');

                // إذا كانت الصورة مفقودة، نقوم بتحليل العنوان لاختيار صورة مناسبة للمحتوى
                if (!imageUrl || imageUrl.includes('placeholder') || imageUrl.length < 10) {
                    let searchTag = 'mental-health'; // افتراضي
                    const lowerTitle = title.toLowerCase();

                    // تحليل الكلمات المفتاحية في العنوان لاختيار الوسم المناسب لـ Unsplash
                    if (lowerTitle.includes('child') || lowerTitle.includes('طفل') || lowerTitle.includes('أطفال')) searchTag = 'child-psychology';
                    else if (lowerTitle.includes('autism') || lowerTitle.includes('توحد')) searchTag = 'autism';
                    else if (lowerTitle.includes('brain') || lowerTitle.includes('دماغ') || lowerTitle.includes('عصبي')) searchTag = 'neuroscience';
                    else if (lowerTitle.includes('stress') || lowerTitle.includes('توتر') || lowerTitle.includes('قلق')) searchTag = 'anxiety';
                    else if (lowerTitle.includes('doctor') || lowerTitle.includes('طبيب') || lowerTitle.includes('علاج')) searchTag = 'medical';
                    else if (lowerTitle.includes('adhd')) searchTag = 'focus-study';

                    // توليد رابط صورة من Unsplash بناءً على تحليل العنوان
                    imageUrl = `https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80&sig=${encodeURIComponent(title.substring(0,10))}&${searchTag}`;
                    console.log(`💡 Generated smart image for: ${title.substring(0, 20)}... using tag [${searchTag}]`);
                } else if (!imageUrl.startsWith('http')) {
                    imageUrl = new URL(source.url).origin + imageUrl;
                }

                const payload = {
                    source_name: source.name,
                    source_url: fullLink,
                    image_url: imageUrl, 
                    slug: title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 60) + "-" + Date.now(),
                    is_published: true,
                    title_en: source.lang === 'en' ? title : null,
                    title_ar: source.lang === 'ar' ? title : null,
                    content_en: source.lang === 'en' ? content : null,
                    content_ar: source.lang === 'ar' ? content : null,
                    excerpt_en: source.lang === 'en' ? title : null,
                    excerpt_ar: source.lang === 'ar' ? title : null,
                    created_at: new Date().toISOString()
                };

                const { error } = await supabase.from('articles').upsert(payload, { onConflict: 'source_url' });
                if (!error) console.log(`✅ Saved: "${title.substring(0, 30)}..."`);
            }
        } catch (e) { console.log(`❌ Error at ${source.name}:`, e.message); }
    }
    console.log("🏁 Process Finished.");
}

masterScraper().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});