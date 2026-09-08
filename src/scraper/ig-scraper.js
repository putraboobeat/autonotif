const { getBrowser, getPage } = require('./browser');
const { IgRuleModel, IgPostModel, ConfigModel, NotificationLogModel } = require('../database/models');
const { sendGroupMessage, sendPersonalMessage } = require('../notifier/starsender');
const { createLogger } = require('../utils/logger');

const log = createLogger('IG-SCRAPER');

async function scrapeInstagram(options = {}) {
  const isEnabled = ConfigModel.get('ig_enabled');
  if (isEnabled !== '1' && !options.isManual) {
    return;
  }

  const usernameConfig = ConfigModel.get('ig_username');
  if (!usernameConfig) {
    log.warn('IG Scraper enabled but ig_username is empty');
    return;
  }

  const usernames = usernameConfig.split(',').map(u => u.trim()).filter(Boolean);
  if (usernames.length === 0) {
    log.warn('No valid IG usernames found to scrape.');
    return;
  }

  ConfigModel.set('ig_scraper_status', 'running');
  
  let page = getPage();
  if (!page) {
    log.warn('Browser page not available yet for IG scraper. Skipping...');
    return;
  }

  try {
    for (const username of usernames) {
      log.info(`Checking Instagram for @${username}...`);
      ConfigModel.set('ig_scraper_status', `Sedang memeriksa profil @${username}...`);
      
      // We create a new page for IG to avoid messing with OCA page
      const browser = getBrowser();
      const igPage = await browser.newPage();
      
      // Block unnecessary resources
      await igPage.setRequestInterception(true);
      igPage.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      // Go to profile
      const url = `https://www.instagram.com/${username}/`;
      ConfigModel.set('ig_scraper_status', `Membuka halaman @${username}...`);
      await igPage.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Scrape posts logic
      let posts = [];
      let previousHeight = 0;
      let scrollAttempts = 0;
      
      while (true) {
        // Wait for articles to load
        try {
          ConfigModel.set('ig_scraper_status', `Sedang membaca data postingan @${username}... (${posts.length} ditemukan)`);
          await igPage.waitForFunction(() => {
            return Array.from(document.querySelectorAll('a')).some(a => a.href && a.href.includes('/p/'));
          }, { timeout: 10000 });
        } catch (err) {
          log.warn(`Could not find more posts for @${username}.`);
          break; // Stop scrolling if no posts found
        }
  
        // Extract posts from current view
        const currentPosts = await igPage.evaluate(() => {
          const postElements = Array.from(document.querySelectorAll('a')).filter(a => a.href && (a.href.includes('/p/') || a.href.includes('/reel/')));
          const results = [];
          
          postElements.forEach(el => {
            const href = el.href;
            const match = href.match(/\/(p|reel)\/(.+?)\//);
            if (match) {
              const type = match[1];
              const shortcode = match[2];
              if (!results.some(r => r.shortcode === shortcode)) {
                results.push({ shortcode, caption: '', link: `https://www.instagram.com/${type}/${shortcode}/` });
              }
            }
          });
          return results;
        });
        
        // Merge into total posts without duplicates
        for (const p of currentPosts) {
           if (!posts.some(existing => existing.shortcode === p.shortcode)) {
              posts.push(p);
           }
        }
        
        const mode = ConfigModel.get('ig_scrape_mode') || 'normal';
        if (mode === 'stopping') {
          log.info('Scraper received stop signal.');
          break;
        }
        
        if (mode !== 'deep') {
          // Normal mode: just grab what is visible initially and stop
          break;
        }
        
        // Deep mode: try to scroll
        const newHeight = await igPage.evaluate('document.body.scrollHeight');
        if (newHeight === previousHeight) {
          scrollAttempts++;
          if (scrollAttempts >= 3) {
             log.info('Reached bottom of profile.');
             break; // No more content after 3 attempts
          }
        } else {
          scrollAttempts = 0;
        }
        previousHeight = newHeight;
        await igPage.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        await new Promise(r => setTimeout(r, 3000)); // wait for load
      }
      
      await igPage.close();
      
      log.info(`Found ${posts.length} posts for @${username}`);
      ConfigModel.set('ig_scraper_status', `Memproses ${posts.length} postingan dari @${username}...`);
      let processedCount = 0;

      for (const post of posts) {
        processedCount++;
        ConfigModel.set('ig_scraper_status', `Memproses postingan ${processedCount}/${posts.length} di @${username}...`);
        
        // Check if already processed
        if (IgPostModel.isProcessed(post.shortcode)) {
          log.info(`Post ${post.shortcode} already processed. Skipping...`);
          continue;
        }
        
        // Fetch true caption, image, and date from the post page
        let caption = post.caption;
        let imageUrl = '';
        let postDate = '';
        try {
          const postPage = await browser.newPage();
          await postPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
          const extracted = await postPage.evaluate(() => {
            let cap = '';
            let img = '';
            let pDate = '';
            const metaCap = document.querySelector('meta[property="og:title"]');
            if (metaCap) {
              const content = metaCap.getAttribute('content');
              const match = content.match(/on Instagram: "([\s\S]+)"/);
              cap = match ? match[1] : content;
            }
            const metaImg = document.querySelector('meta[property="og:image"]');
            if (metaImg) {
              img = metaImg.getAttribute('content');
            }
            const timeEl = document.querySelector('time');
            if (timeEl) {
              pDate = timeEl.getAttribute('datetime');
            }
            return { cap, img, pDate };
          });
          caption = extracted.cap;
          imageUrl = extracted.img;
          if (imageUrl) {
            imageUrl = imageUrl.replace(/\.webp(?=\?|$)/gi, '.jpg').replace(/dst-webp/gi, 'dst-jpg');
          }
          postDate = extracted.pDate;
          await postPage.close();
        } catch (e) {
          log.warn(`Could not fetch data for ${post.shortcode}: ${e.message}`);
        }

        post.caption = caption || 'Tanpa Caption';
        post.imageUrl = imageUrl || '';
        post.postDate = postDate || '';
        
        let targetGroup = (ConfigModel.get('ig_default_group') || '').trim();
        if (!targetGroup) {
          targetGroup = (ConfigModel.get('wa_group_id') || '').trim();
        }
        let targetAdmin = (ConfigModel.get('ig_default_admin') || '').trim();
        
        // Get templates
        const defaultTemplate = '📸 *POSTINGAN TERBARU INSTAGRAM*\n@{{username}}\n\n{{caption}}\n\nSelengkapnya : {{link}}';
        let templateMsg = ConfigModel.get('ig_template_msg');
        if (!templateMsg || templateMsg.includes('Kode:') || templateMsg.includes('terkait dengan instansi Anda')) {
          templateMsg = defaultTemplate;
        }
        
        // Format message (50 karakter pertama + selengkapnya link)
        const rawCaption = (post.caption || '').replace(/\s+/g, ' ').trim();
        const captionSnippet = rawCaption.length > 50 ? rawCaption.substring(0, 50).trim() + '...' : (rawCaption || 'Postingan baru');
        
        let message = templateMsg
          .replace(/\{\{username\}\}/g, username)
          .replace(/\{\{caption\}\}/g, captionSnippet)
          .replace(/\{\{link\}\}/g, post.link)
          .replace(/Kode:\s*\{\{kode\}\}\n*/gi, '')
          .replace(/\{\{kode\}\}/g, '')
          .trim();
        
        let status = 'success';
        let errorMsg = '';
        
        if (!targetGroup && !targetAdmin) {
          status = 'failed';
          errorMsg = 'Tujuan Group / Nomor Admin WhatsApp belum diatur di form Default Target Pengiriman Instagram atau Pengaturan Utama.';
          log.warn(`[IG] No target group or admin configured. Post ${post.shortcode} marked as failed.`);
        } else {
          // Send to group
          if (targetGroup) {
            try {
              const resGroup = await sendGroupMessage(targetGroup, message, { imageUrl: post.imageUrl });
              if (!resGroup.success) {
                status = 'failed';
                errorMsg += `Group (${targetGroup}): ${resGroup.error || 'Gagal'}. `;
              }
              NotificationLogModel.create({
                ticketId: `IG-${post.shortcode}`,
                targetType: 'group',
                targetName: targetGroup,
                targetNumber: '',
                message: resGroup.sentMessage || message,
                status: resGroup.success ? 'sent' : 'failed',
                response: JSON.stringify(resGroup)
              });
            } catch (err) {
              status = 'failed';
              errorMsg += `Group Exception: ${err.message}. `;
              NotificationLogModel.create({
                ticketId: `IG-${post.shortcode}`,
                targetType: 'group',
                targetName: targetGroup,
                targetNumber: '',
                message: message,
                status: 'failed',
                response: JSON.stringify({ error: err.message })
              });
            }
          }
          
          // Send to admin
          if (targetAdmin) {
            try {
              const resAdmin = await sendPersonalMessage(targetAdmin, message, { imageUrl: post.imageUrl });
              if (!resAdmin.success) {
                status = 'failed';
                errorMsg += `Admin (${targetAdmin}): ${resAdmin.error || 'Gagal'}. `;
              }
              NotificationLogModel.create({
                ticketId: `IG-${post.shortcode}`,
                targetType: 'personal',
                targetName: 'Admin IG',
                targetNumber: targetAdmin,
                message: resAdmin.sentMessage || message,
                status: resAdmin.success ? 'sent' : 'failed',
                response: JSON.stringify(resAdmin)
              });
            } catch (err) {
              status = 'failed';
              errorMsg += `Admin Exception: ${err.message}. `;
              NotificationLogModel.create({
                ticketId: `IG-${post.shortcode}`,
                targetType: 'personal',
                targetName: 'Admin IG',
                targetNumber: targetAdmin,
                message: message,
                status: 'failed',
                response: JSON.stringify({ error: err.message })
              });
            }
          }
        }
        
        // Save to processed
        IgPostModel.save({
          shortcode: post.shortcode,
          link: post.link,
          caption: post.caption,
          matched_code: 'ALL',
          notified_group: targetGroup || targetAdmin || '-',
          status: status,
          error_msg: errorMsg.trim(),
          post_date: post.postDate,
          image_url: post.imageUrl || ''
        });
      }
    } // End of loop over usernames

  } catch (error) {
    log.error('Error scraping Instagram', { error: error.message });
    ConfigModel.set('ig_scraper_status', `Gagal: ${error.message}`);
  } finally {
    setTimeout(() => {
        ConfigModel.set('ig_scraper_status', 'stopped');
    }, 5000); // Keep status visible for 5s
    ConfigModel.set('last_ig_scrape_time', new Date().toISOString());
  }
}

module.exports = {
  scrapeInstagram
};
