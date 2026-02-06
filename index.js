const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// إعداد اتصال Supabase
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, 
    process.env.SUPABASE_SERVICE_KEY        
);

// إعدادات التحكم
const MAX_ARTICLES_PER_RUN = 5; 

const KEYWORDS = [
    'adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 
    'الاندفاعية', 'impulsivity', 'hyperactivity', 'neurodiversity', 
    'النمو العصبي', 'تأخر النطق', 'صعوبات تعلم', 'ADHD',
    'neurodivergent', 'executive function', 'attention deficit'
];

const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/category/parenting-adhd-kids/", lang: "en" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", lang: "en" },
    { name: "Psychiatrist.com", url: "https://www.psychiatrist.com/news/", lang: "en" },
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", lang: "ar" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        const res = await translate(text, { from: fromLang, to: toLang });
        return res.text;
    } catch (e) { return text; }
}

async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }, 
            timeout: 15000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        $('article p, .article-body p, .entry-content p, p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 80) paragraphs.push(txt);
        });
        return paragraphs.slice(0, 15).join('\n\n'); 
    } catch (e) { return null; }
}

async function masterScraper() {
    console.log("🚀 Starting Supabase Integrated Scraper...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
            });
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
            console.log(`   📊 Found ${uniqueItems.length} potential articles.`);

            for (const item of uniqueItems) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const fullLink = item.link.startsWith('http') ? item.link : (new URL(source.url).origin + item.link);

                // 1. التحقق من وجود المقال مسبقاً في Supabase لتجنب التكرار
                const { data: existing } = await supabase
                    .from('articles')
                    .select('id')
                    .eq('source_url', fullLink)
                    .maybeSingle();

                if (existing) {
                    console.log(`   ⏭️ Skipping (Already exists): ${item.title.substring(0, 30)}...`);
                    continue;
                }

                console.log(`   🎯 Catching New: "${item.title.substring(0, 50)}..."`);
                const content = await fetchFullContent(fullLink);
                if (!content || content.length < 200) continue;

                const articleSlug = item.title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 50) + "-" + Date.now();
                
                let articleData = {
                    source_name: source.name,
                    source_url: fullLink,
                    slug: articleSlug,
                    image_url: `https://images.unsplash.com/photo-1617791160536-598cf3278667?q=80&w=1000&auto=format&fit=crop`,
                    created_at: new Date().toISOString()
                };

                // الترجمة
                if (source.lang === 'ar') {
                    articleData.title_ar = item.title;
                    articleData.content_ar = content;
                    articleData.title_en = await smartTranslate(item.title, 'ar', 'en');
                    articleData.content_en = await smartTranslate(content, 'ar', 'en');
                } else {
                    articleData.title_en = item.title;
                    articleData.content_en = content;
                    articleData.title_ar = await smartTranslate(item.title, 'en', 'ar');
                    articleData.content_ar = await smartTranslate(content, 'en', 'ar');
                }

                // 2. حفظ في جدول articles
                const { data: newArticle, error: articleError } = await supabase
                    .from('articles')
                    .insert([articleData])
                    .select()
                    .single();

                if (articleError) {
                    console.error("   ❌ Error saving article:", articleError.message);
                    continue;
                }

                // 3. الربط في جدول content_items ليظهر في صفحة المدونة فوراً
                const { error: linkError } = await supabase
                    .from('content_items')
                    .insert([{
                        external_article_id: newArticle.id,
                        content_type: 'external_article',
                        slug: articleSlug,
                        is_published: true,
                        published_at: new Date().toISOString()
                    }]);

                if (linkError) {
                    console.error("   ❌ Error linking to content_items:", linkError.message);
                } else {
                    console.log(`   ✅ Successfully saved & linked to Supabase!`);
                    totalSaved++;
                    await sleep(2000); // تأخير بسيط لتجنب ضغط الـ API
                }
            }
        } catch (e) { 
            console.error(`❌ Error in ${source.name}: ${e.message}`); 
        }
    }
    console.log(`\n🏁 Done. Total new articles added: ${totalSaved}`);
}

masterScraper();