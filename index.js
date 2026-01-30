const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cheerio = require('cheerio');

// Use environment variables for security
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_NEW_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY; // Use Service Key for database writing

if (!SB_URL || !SB_KEY) {
    console.error("❌ Error: Supabase URL or Key is missing in environment variables!");
    process.exit(1);
}
const supabase = createClient(SB_URL, SB_KEY);

const sources = [
    { name: "Altibbi", url: "https://altibbi.com/مقالات-طبية/الصحة-النفسية", selector: "h2", lang: "ar" },
    { name: "Medical News Today", url: "https://www.medicalnewstoday.com/categories/adhd", selector: "h2", lang: "en" }
];

/**
 * Fetches the full content of an article from its URL
 */
async function fetchFullContent(url) {
    try {
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' },
            timeout: 15000 
        });
        const $ = cheerio.load(response.data);
        
        let paragraphs = [];
        
        // Target content containers and fetch all paragraphs
        $('article p, .article-content p, .post-content p, .topic-content p, .text-content p').each((i, el) => {
            const txt = $(el).text().trim();
            // Fetch meaningful text only
            if (txt.length > 20 && !txt.includes('Copyright')) {
                paragraphs.push(txt);
            }
        });

        // Fetch subheadings and format them as Markdown
        $('article h2, article h3').each((i, el) => {
             const headerTxt = $(el).text().trim();
             if(headerTxt.length > 5) paragraphs.push(`### ${headerTxt}`);
        });

        return paragraphs.length > 0 ? paragraphs.join('\n\n') : "Content available via the original link.";
    } catch (e) {
        return "Full content is being synchronized...";
    }
}

/**
 * Main Scraper Function
 */
async function masterScraper() {
    console.log("🚀 Starting Article Scraper with Original Images...");
    
    for (const source of sources) {
        try {
            const response = await axios.get(source.url, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const $ = cheerio.load(response.data);
            
            // Select the first article
            const firstItem = $(source.selector).first();
            const title = firstItem.text().trim();
            if (!title) continue;
            
            // 1. Get Article Link
            let link = firstItem.find('a').attr('href') || firstItem.closest('a').attr('href');
            if (!link) continue;
            const fullLink = link.startsWith('http') ? link : (new URL(source.url).origin + link);

            // 2. Extract Original Image
            // Look for the closest image tag in the article container
            let imageUrl = firstItem.closest('article').find('img').attr('src') || 
                           firstItem.parent().find('img').attr('src') ||
                           firstItem.closest('div').find('img').attr('src');

            // Fix relative image URLs
            if (imageUrl && !imageUrl.startsWith('http')) {
                imageUrl = new URL(source.url).origin + imageUrl;
            }

            const content = await fetchFullContent(fullLink);

            const payload = {
                source_name: source.name,
                source_url: fullLink,
                image_url: imageUrl || "/images/blogPosts1.jpg", 
                slug: title.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-').substring(0, 60) + "-" + Date.now(),
                is_published: true,
                title_en: source.lang === 'en' ? title : title,
                title_ar: source.lang === 'ar' ? title : title,
                content_en: content,
                content_ar: content,
                excerpt_en: title,
                excerpt_ar: title,
                created_at: new Date().toISOString()
            };

            const { error } = await supabase.from('articles').upsert(payload, { onConflict: 'source_url' });
            
            if (error) throw error;
            console.log(`✅ Success: Saved "${source.name}" with its original image.`);
            
        } catch (e) { 
            console.log(`❌ Error fetching ${source.name}:`, e.message); 
        }
    }
    console.log("🏁 Scraper Finished.");
}

// Execute the Scraper
masterScraper();