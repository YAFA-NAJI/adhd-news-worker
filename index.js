const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, process.env.SUPABASE_SERVICE_KEY);

const KEYWORDS = ['adhd', 'تشتت', 'انتباه', 'فرط', 'حركة', 'النمو العصبي', 'psychology', 'autism', 'توحد', 'تأخر', 'العصبية', 'التوتر', 'stress', 'mental', 'anxiety', 'focus'];

const sources = [
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article", lang: "ar" },
    // تحديث رابط ويب طب لقسم أكثر استقراراً
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", selector: ".card, .article-card", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0, article", lang: "en" },
    { name: "Verywell Mind", url: "https://www.verywellmind.com/adhd-4157274", selector: ".mntl-card-list-items", lang: "en" },
    { name: "Psychology Today", url: "https://www.psychologytoday.com/intl/basics/adhd", selector: ".blog_post_card, .teaser-card", lang: "en" }
];

async function fetchFullContent(url, sourceName) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
            timeout: 10000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];

        // تحسين اختيار المحتوى للمواقع الأجنبية
        let contentSelector = '.article-content p, article p, .text-content p, .mntl-sc-block-group--text p, .css-1v96o8 p';

        $(contentSelector).each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 60 && !txt.includes('إشترك') && !txt.toLowerCase().includes('copyright')) {
                paragraphs.push(txt);
            }
        });

        return paragraphs.length >= 2 ? paragraphs.join('\n\n') : null;
    } catch (e) { return null; }
}

async function masterScraper() {
    console.log("🚀 Starting Smart ADHD Content Engine...");
    
    for (const source of sources) {
        try {
            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' } 
            });
            const $ = cheerio.load(response.data);
            const items = $(source.selector).slice(0, 10); 

            for (let i = 0; i < items.length; i++) {
                const el = $(items[i]);
                const title = el.find('h2, h3, .card__title, .mntl-card-list-items__title').first().text().trim();
                
                if (!title || !KEYWORDS.some(key => title.toLowerCase().includes(key))) continue;

                // --- الحل لمشكلة startsWith (تأمين الرابط) ---
                let link = el.find('a').attr('href');
                if (!link) {
                    // محاولة أخرى إذا كان العنصر نفسه هو الرابط
                    link = el.attr('href');
                }
                
                if (!link) continue; // تخطي إذا لم نجد رابطاً نهائياً

                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                const content = await fetchFullContent(fullLink, source.name);
                if (!content) continue;

                // منطق الصور الذكي
                let imageUrl = null;
                const imgElement = el.find('img').first();
                let rawSrc = imgElement.attr('data-src') || imgElement.attr('srcset')?.split(' ')[0] || imgElement.attr('src');

                if (!rawSrc || rawSrc.includes('clock') || rawSrc.includes('time') || rawSrc.length < 10) {
                    let searchTag = 'mental-health';
                    if (title.toLowerCase().includes('child') || title.includes('طفل')) searchTag = 'child';
                    imageUrl = `https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80&sig=${encodeURIComponent(title.substring(0,10))}&${searchTag}`;
                } else {
                    imageUrl = rawSrc.startsWith('http') ? rawSrc : (new URL(source.url).origin + rawSrc);
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
                if (!error) console.log(`✅ Saved: "${title.substring(0, 30)}..." from ${source.name}`);
            }
        } catch (e) { console.log(`❌ Error at ${source.name}:`, e.message); }
    }
    console.log("🏁 Process Finished.");
}

masterScraper().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });