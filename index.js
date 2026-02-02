const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');
const { translate } = require('@vitalets/google-translate-api');
const { Resend } = require('resend');
require('dotenv').config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_NEW_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// كلمات مفتاحية دقيقة لضمان جودة المحتوى
const KEYWORDS = [
    'adhd', 'تشتت', 'انتباه', 'توحد', 'autism', 'فرط حركة', 
    'الاندفاعية', 'impulsivity', 'hyperactivity', 'neurodiversity', 
    'النمو العصبي', 'تأخر النطق', 'صعوبات تعلم', 'ADHD'
];

const sources = [
    { name: "ADDitude Magazine", url: "https://www.additudemag.com/category/parenting-adhd-kids/", selector: "article", lang: "en" },
    { name: "NIH Research", url: "https://www.nih.gov/news-events/nih-research-matters/", selector: ".news-item, article", lang: "en" },
    { name: "Psychiatrist.com", url: "https://www.psychiatrist.com/news/", selector: ".post-item, article", lang: "en" },
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "article", lang: "ar" },
    { name: "WebTeb", url: "https://www.webteb.com/mental-health", selector: ".card, .article-card", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "li.css-0, article", lang: "en" },
    { name: "Verywell Mind", url: "https://www.verywellmind.com/adhd-4157274", selector: ".mntl-card-list-items", lang: "en" }
];

// دالة للنوم (Sleep) لتجنب حظر الترجمة
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function smartTranslate(text, fromLang, toLang) {
    if (!text || text.trim() === "") return null;
    try {
        // تحديد طول النص بـ 2000 حرف لتقليل احتمالية الـ Timeout
        const safeText = text.substring(0, 2000);
        
        const res = await translate(safeText, { 
            from: fromLang, 
            to: toLang,
            fetchOptions: { timeout: 15000 } // زيادة مهلة الانتظار لـ 15 ثانية
        });
        
        return res && res.text ? res.text : null;
    } catch (err) {
        // في حال حدوث Timeout أو خطأ، نطبع التحذير ونعود بـ null ليتم استخدام النص الأصلي
        console.warn(`      ⚠️ Translation Timeout/Error, skipping translation for this part.`);
        return null;
    }
}

async function notifyUsersViaResend(articleTitle, articleSlug) {
    try {
        await resend.emails.send({
            from: 'Tawazun ADHD <onboarding@resend.dev>',
            to: ['yafan***@gmail.com'], // تأكدي من وضع إيميلك المسجل هنا
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
        console.log(`   📧 Notification Sent.`);
    } catch (err) {
        console.error('   ⚠️ Email not sent.');
    }
}

async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const $ = cheerio.load(response.data);
        let paragraphs = [];
        $('article p, .article-content p, .article-body p, .mntl-sc-block-group--text p, .entry-content p').each((i, el) => {
            const txt = $(el).text().trim();
            if (txt.length > 60) paragraphs.push(txt);
        });
        return paragraphs.length > 0 ? paragraphs.join('\n\n') : null;
    } catch (e) { return null; }
}

async function masterScraper() {
    console.log("🚀 Starting Targeted Scraper Session (Timeout Safe Mode)...");
    
    for (const source of sources) {
        try {
            console.log(`\n🔎 Checking: ${source.name}...`);
            const response = await axios.get(source.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const $ = cheerio.load(response.data);
            const items = $(source.selector).slice(0, 10); 

            for (let i = 0; i < items.length; i++) {
                const el = $(items[i]);
                const title = el.find('h2, h3, .card__title, .mntl-card-list-items__title, a').first().text().trim();
                
                if (!title || !KEYWORDS.some(key => title.toLowerCase().includes(key))) continue;

                let link = el.find('a').attr('href') || el.attr('href');
                if (!link) continue;
                const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

                const { data: exists } = await supabase.from('articles').select('id').eq('source_url', fullLink).maybeSingle();
                if (exists) continue;

                console.log(`   🎯 Found Match: "${title.substring(0, 40)}..."`);

                const content = await fetchFullContent(fullLink);
                if (!content) continue;

                const imageUrl = el.find('img').first().attr('src') || `https://images.unsplash.com/photo-1551836022-d5d88e9218df?q=80&w=1200&auto=format&fit=crop`;
                const articleSlug = title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 60) + "-" + Date.now();

                const payload = {
                    source_name: source.name, source_url: fullLink, image_url: imageUrl,
                    slug: articleSlug, is_published: true, created_at: new Date().toISOString()
                };

                // --- عملية الترجمة المحسنة مع حماية من الـ Timeout ---
                console.log(`   ⏳ Translating...`);
                if (source.lang === 'ar') {
                    payload.title_ar = title;
                    payload.content_ar = content;
                    payload.title_en = await smartTranslate(title, 'ar', 'en') || title;
                    await sleep(1500); // زيادة الانتظار قليلاً لضمان استقرار السيرفر
                    payload.content_en = await smartTranslate(content, 'ar', 'en') || content;
                } else {
                    payload.title_en = title;
                    payload.content_en = content;
                    payload.title_ar = await smartTranslate(title, 'en', 'ar') || title;
                    await sleep(1500);
                    payload.content_ar = await smartTranslate(content, 'en', 'ar') || content;
                }

                const { data: savedArticle, error: articleError } = await supabase
                    .from('articles').upsert(payload, { onConflict: 'source_url' }).select().single();
                
                if (!articleError && savedArticle) {
                    const { data: existingItem } = await supabase.from('content_items').select('id').eq('external_article_id', savedArticle.id).maybeSingle();

                    if (!existingItem) {
                        await supabase.from('content_items').insert({
                            external_article_id: savedArticle.id, content_type: 'external_article', slug: articleSlug, is_published: true, published_at: new Date().toISOString()
                        });
                        console.log(`   ✅ Saved & Linked.`);
                        await notifyUsersViaResend(payload.title_ar || title, articleSlug);
                    }
                }
            }
        } catch (e) { console.error(`❌ Error in ${source.name}: ${e.message}`); }
    }
    console.log("\n🏁 Done.");
}

masterScraper().then(() => process.exit(0));