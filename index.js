const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// إعدادات التحكم
const MAX_ARTICLES_PER_RUN = 5; 
const ARTICLES_DIR = path.join(process.cwd(), 'articles');

if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR, { recursive: true });
}

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
    console.log("🚀 Starting Smart Scraper...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
            });
            const $ = cheerio.load(response.data);
            
            // استراتيجية البحث الشاملة: نبحث عن أي رابط (a) يحتوي نص طويل وكلمة مفتاحية
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

            // إزالة التكرار من الروابط الموجودة في نفس الصفحة
            let uniqueItems = Array.from(new Map(foundItems.map(item => [item.link, item])).values());
            console.log(`   📊 Found ${uniqueItems.length} relevant articles.`);

            for (const item of uniqueItems) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const fullLink = item.link.startsWith('http') ? item.link : (new URL(source.url).origin + item.link);
                const safeFileName = Buffer.from(fullLink).toString('base64').substring(0, 30) + ".json";
                const filePath = path.join(ARTICLES_DIR, safeFileName);
                
                if (fs.existsSync(filePath)) continue; 

                console.log(`   🎯 Catching: "${item.title.substring(0, 50)}..."`);

                const content = await fetchFullContent(fullLink);
                if (!content || content.length < 200) continue;

                const articleSlug = item.title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 50) + "-" + Date.now();
                const payload = {
                    source_name: source.name,
                    source_url: fullLink,
                    slug: articleSlug,
                    created_at: new Date().toISOString()
                };

                if (source.lang === 'ar') {
                    payload.title_ar = item.title;
                    payload.content_ar = content;
                    payload.title_en = await smartTranslate(item.title, 'ar', 'en');
                    payload.content_en = await smartTranslate(content, 'ar', 'en');
                } else {
                    payload.title_en = item.title;
                    payload.content_en = content;
                    payload.title_ar = await smartTranslate(item.title, 'en', 'ar');
                    payload.content_ar = await smartTranslate(content, 'en', 'ar');
                }

                fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
                console.log(`   ✅ Saved: ${safeFileName}`);
                totalSaved++;
                await sleep(2000);
            }
        } catch (e) { 
            console.error(`❌ Error in ${source.name}: ${e.message}`); 
        }
    }
    console.log(`\n🏁 Done. Total new: ${totalSaved}`);
}

masterScraper();