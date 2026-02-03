const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// إعدادات التحكم
const MAX_ARTICLES_PER_RUN = 5; 
const ARTICLES_DIR = path.join(__dirname, 'articles');

// إنشاء مجلد الحفظ إذا لم يكن موجوداً
if (!fs.existsSync(ARTICLES_DIR)) {
    fs.mkdirSync(ARTICLES_DIR);
}

// الكلمات المفتاحية للفلترة
const KEYWORDS = [
    'adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 
    'الاندفاعية', 'impulsivity', 'hyperactivity', 'neurodiversity', 
    'النمو العصبي', 'تأخر النطق', 'صعوبات تعلم', 'ADHD'
];

// المصادر المستهدفة
const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/category/parenting-adhd-kids/", selector: "article", lang: "en" },
    { name: "NIH Research", url: "https://www.nih.gov/news-events/nih-research-matters/", selector: ".news-item, article", lang: "en" },
    { name: "Psychiatrist.com", url: "https://www.psychiatrist.com/news/", selector: ".post-item, article", lang: "en" },
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", selector: ".card, .article-card", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0, article", lang: "en" },
    { name: "Verywell Mind", url: "https://www.verywellmind.com/adhd-4157274", selector: ".mntl-card-list-items", lang: "en" }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// دالة الترجمة الذكية بنظام التقطيع (Chunks)
async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    
    if (text.length < 500) {
        try {
            const res = await translate(text, { from: fromLang, to: toLang });
            return res.text;
        } catch (e) { return text; }
    }

    const chunks = text.match(/[\s\S]{1,1000}/g) || [];
    let translatedFull = "";

    console.log(`   📦 Breaking content into ${chunks.length} parts...`);

    for (const chunk of chunks) {
        try {
            const res = await translate(chunk, { from: fromLang, to: toLang });
            translatedFull += res.text + " ";
            await sleep(1500); // انتظار لتجنب حظر جوجل
        } catch (err) {
            translatedFull += chunk + " ";
        }
    }
    return translatedFull.trim();
}

// دالة إرسال الإشعارات عبر Resend
async function notifyUsersViaResend(articleTitle, articleSlug) {
    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
    if (!resend) {
        console.warn("⚠️ Resend API Key is missing. Skipping email.");
        return;
    }
    try {
        const data = await resend.emails.send({
            from: 'Tawazun ADHD <onboarding@resend.dev>',
            to: ['yafanaji2002@gmail.com'], 
            subject: `🆕 مقال جديد: ${articleTitle}`,
            html: `
                <div dir="rtl" style="font-family: sans-serif; text-align: right; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #0070f3;">موضوع جديد يخص توازن!</h2>
                    <p style="font-size: 16px;">العنوان: <strong>${articleTitle}</strong></p>
                    <div style="margin-top: 25px;">
                        <a href="https://tawazun-adhd.vercel.app/ar/blog/${articleSlug}" 
                           style="background: #0070f3; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                           إقرأ المقال الآن
                        </a>
                    </div>
                </div>
            `
        });
        console.log(`   📧 Email Sent: ${data.id}`);
    } catch (err) {
        console.error('   ⚠️ Email error:', err.message);
    }
}

// دالة سحب المحتوى الكامل للمقال
async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
            }, 
            timeout: 30000 
        });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        $('article p, .article-content p, .article-body p, .mntl-sc-block-group--text p, .entry-content p, .post-content p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 60) paragraphs.push(txt);
        });
        return paragraphs.length > 0 ? paragraphs.join('\n\n') : null;
    } catch (e) { return null; }
}

// السكربت الرئيسي
async function masterScraper() {
    console.log("🚀 Starting Targeted Scraper (Local JSON Mode)...");
    let totalSaved = 0;

    for (const source of sources) {
        if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            await sleep(2000); 

            const response = await axios.get(source.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 20000
            });
            const $ = cheerio.load(response.data);
            const items = $(source.selector).slice(0, 10); 

            for (let i = 0; i < items.length; i++) {
                if (totalSaved >= MAX_ARTICLES_PER_RUN) break;

                const el = $(items[i]);
                const title = el.find('h2, h3, .card__title, .mntl-card-list-items__title, a').first().text().trim();
                
                if (!title || !KEYWORDS.some(key => title.toLowerCase().includes(key.toLowerCase()))) continue;

                let link = el.find('a').attr('href') || el.attr('href');
                if (!link) continue;
                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                // التحقق من وجود المقال مسبقاً (عن طريق تشفير الرابط كاسم ملف)
                const safeFileName = Buffer.from(fullLink).toString('base64').substring(0, 40) + ".json";
                const filePath = path.join(ARTICLES_DIR, safeFileName);
                
                if (fs.existsSync(filePath)) {
                    continue; 
                }

                console.log(`   🎯 Match Found: "${title.substring(0, 40)}..."`);

                const content = await fetchFullContent(fullLink);
                if (!content) continue;

                const imageUrl = el.find('img').first().attr('src') || `https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=1200&auto=format&fit=crop`;
                const articleSlug = title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 60) + "-" + Date.now();

                const payload = {
                    source_name: source.name,
                    source_url: fullLink,
                    image_url: imageUrl,
                    slug: articleSlug,
                    created_at: new Date().toISOString()
                };

                console.log(`   ⏳ Translating...`);
                if (source.lang === 'ar') {
                    payload.title_ar = title;
                    payload.content_ar = content;
                    payload.title_en = await smartTranslate(title, 'ar', 'en') || title;
                    await sleep(2000);
                    payload.content_en = await smartTranslate(content, 'ar', 'en') || content;
                } else {
                    payload.title_en = title;
                    payload.content_en = content;
                    payload.title_ar = await smartTranslate(title, 'en', 'ar') || title;
                    await sleep(2000);
                    payload.content_ar = await smartTranslate(content, 'en', 'ar') || content;
                }

                // حفظ المقال كملف JSON
                fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
                console.log(`   ✅ Saved Locally: ${safeFileName}`);
                totalSaved++;

                await notifyUsersViaResend(payload.title_ar || title, articleSlug);
                await sleep(1000);
            }
        } catch (e) { 
            console.error(`❌ Error in ${source.name}: ${e.message}`); 
        }
    }
    console.log(`\n🏁 Done. Saved ${totalSaved} new articles.`);
}

// تشغيل السكربت
masterScraper().then(() => {
    console.log("Process finished successfully.");
    process.exit(0);
}).catch(err => {
    console.error("Critical Error:", err);
    process.exit(1);
});