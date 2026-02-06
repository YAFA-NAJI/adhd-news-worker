const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// إعدادات التحكم
const MAX_ARTICLES_PER_RUN = 5; 
// استخدام process.cwd() لضمان المسار الصحيح في GitHub Actions
const ARTICLES_DIR = path.join(process.cwd(), 'articles');

// إنشاء مجلد الحفظ إذا لم يكن موجوداً
if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR, { recursive: true });
}

// الكلمات المفتاحية للفلترة (تم تحسينها لتكون شاملة ودقيقة)
const KEYWORDS = [
    'adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 
    'الاندفاعية', 'impulsivity', 'hyperactivity', 'neurodiversity', 
    'النمو العصبي', 'تأخر النطق', 'صعوبات تعلم', 'ADHD',
    'neurodivergent', 'executive function', 'attention deficit', 'add/adhd'
];

// المصادر المستهدفة مع تحسين الـ Selectors
const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/category/parenting-adhd-kids/", selector: "article, .post-item", lang: "en" },
    { name: "NIH Research", url: "https://www.nih.gov/news-events/nih-research-matters/", selector: ".news-item, article, .view-content li", lang: "en" },
    { name: "Psychiatrist.com", url: "https://www.psychiatrist.com/news/", selector: ".post-item, article, .elementor-post", lang: "en" },
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article, .article-card", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", selector: ".card, .article-card, .category-list-item", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0, article, .css-18v3mpx", lang: "en" },
    { name: "Verywell Mind", url: "https://www.verywellmind.com/adhd-4157274", selector: ".mntl-card-list-items, .card", lang: "en" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة الترجمة الذكية
async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        if (text.length < 500) {
            const res = await translate(text, { from: fromLang, to: toLang });
            return res.text;
        }
        const chunks = text.match(/[\s\S]{1,1000}/g) || [];
        let translatedFull = "";
        for (const chunk of chunks) {
            const res = await translate(chunk, { from: fromLang, to: toLang });
            translatedFull += res.text + " ";
            await sleep(1000);
        }
        return translatedFull.trim();
    } catch (e) {
        console.error("   ⚠️ Translation error, using original text.");
        return text;
    }
}

// دالة إرسال الإشعارات عبر Resend
async function notifyUsersViaResend(articleTitle, articleSlug) {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) return;
    try {
        await resend.emails.send({
            from: 'Tawazun ADHD <onboarding@resend.dev>',
            to: ['yafanaji2002@gmail.com'], 
            subject: `🆕 مقال جديد: ${articleTitle}`,
            html: `<div dir="rtl" style="font-family: sans-serif; text-align: right;">
                    <h2>موضوع جديد يخص توازن!</h2>
                    <p>العنوان: <strong>${articleTitle}</strong></p>
                    <a href="https://tawazun-adhd.vercel.app/ar/blog/${articleSlug}">إقرأ المقال الآن</a>
                   </div>`
        });
        console.log(`   📧 Email Sent.`);
    } catch (err) { console.error('   ⚠️ Email error:', err.message); }
}

// دالة سحب المحتوى الكامل
async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' }, 
            timeout: 20000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        $('article p, .article-content p, .article-body p, .entry-content p, .post-content p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 70) paragraphs.push(txt);
        });
        return paragraphs.length > 0 ? paragraphs.join('\n\n') : null;
    } catch (e) { return null; }
}

// السكربت الرئيسي
async function masterScraper() {
    console.log("🚀 Starting Targeted Scraper...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 15000
            });
            const $ = cheerio.load(response.data);
            
            // زيادة نطاق البحث لـ 15 عنصر لضمان إيجاد الجديد
            const items = $(source.selector).slice(0, 15); 

            for (let i = 0; i < items.length; i++) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const el = $(items[i]);
                // تحسين جلب العنوان ليشمل أي نص داخل روابط أو رؤوس أقلام
                const title = el.find('h1, h2, h3, h4, a, .title').first().text().trim();
                
                if (!title) continue;

                // التحقق من الكلمات المفتاحية
                const isMatch = KEYWORDS.some(key => title.toLowerCase().includes(key.toLowerCase()));
                if (!isMatch) continue;

                let link = el.find('a').attr('href') || el.attr('href');
                if (!link) continue;
                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                const safeFileName = Buffer.from(fullLink).toString('base64').substring(0, 30) + ".json";
                const filePath = path.join(ARTICLES_DIR, safeFileName);
                
                if (fs.existsSync(filePath)) continue; 

                console.log(`   🎯 Match Found: "${title.substring(0, 50)}..."`);

                const content = await fetchFullContent(fullLink);
                if (!content) continue;

                const imageUrl = el.find('img').first().attr('src') || `https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=1200&auto=format&fit=crop`;
                const articleSlug = title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 50) + "-" + Date.now();

                const payload = {
                    source_name: source.name,
                    source_url: fullLink,
                    image_url: imageUrl,
                    slug: articleSlug,
                    created_at: new Date().toISOString()
                };

                if (source.lang === 'ar') {
                    payload.title_ar = title;
                    payload.content_ar = content;
                    payload.title_en = await smartTranslate(title, 'ar', 'en');
                    payload.content_en = await smartTranslate(content, 'ar', 'en');
                } else {
                    payload.title_en = title;
                    payload.content_en = content;
                    payload.title_ar = await smartTranslate(title, 'en', 'ar');
                    payload.content_ar = await smartTranslate(content, 'en', 'ar');
                }

                fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
                console.log(`   ✅ Saved: ${safeFileName}`);
                totalSaved++;

                await notifyUsersViaResend(payload.title_ar, articleSlug);
                await sleep(2000);
            }
        } catch (e) { 
            console.error(`❌ Error in ${source.name}: ${e.message}`); 
        }
    }
    console.log(`\n🏁 Done. Saved ${totalSaved} new articles.`);
}

masterScraper().then(() => process.exit(0)).catch(() => process.exit(1));