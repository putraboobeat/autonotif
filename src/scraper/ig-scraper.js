const { getBrowser, getPage } = require('./browser');
const { IgRuleModel, IgPostModel, ConfigModel } = require('../database/models');
const { sendGroupMessage, sendPersonalMessage } = require('../notifier/starsender');
const { createLogger } = require('../utils/logger');

const log = createLogger('IG-SCRAPER');

async function scrapeInstagram() {
  const isEnabled = ConfigModel.get('ig_enabled');
  if (isEnabled !== '1') {
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

  const activeRules = IgRuleModel.getActive();
  if (activeRules.length === 0) {
    log.debug('No active IG rules found. Skipping scrape.');
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
      
      // Wait for articles to load
      try {
        ConfigModel.set('ig_scraper_status', `Menunggu data postingan @${username}...`);
        await igPage.waitForFunction(() => {
          return Array.from(document.querySelectorAll('a')).some(a => a.href && a.href.includes('/p/'));
        }, { timeout: 10000 });
      } catch (err) {
        log.warn(`Could not find posts for @${username}. Maybe private or blocked.`);
        await igPage.close();
        continue; // Try next user
      }

      // Extract posts
      const posts = await igPage.evaluate(() => {
        const postElements = Array.from(document.querySelectorAll('a')).filter(a => a.href && a.href.includes('/p/'));
        const results = [];
        
        postElements.forEach(el => {
          const href = el.href;
          const match = href.match(/\/p\/(.+?)\//);
          if (match) {
            const shortcode = match[1];
            // We will fetch the true caption by visiting the post page directly
            if (!results.some(r => r.shortcode === shortcode)) {
              results.push({ shortcode, caption: '', link: `https://www.instagram.com/p/${shortcode}/` });
            }
          }
        });
        return results;
      });
      
      await igPage.close();
      
      log.info(`Found ${posts.length} posts for @${username}`);
      ConfigModel.set('ig_scraper_status', `Menemukan ${posts.length} postingan di @${username}. Mengecek filter...`);

      for (const post of posts) {
        // Check if already processed
        if (IgPostModel.isProcessed(post.shortcode)) {
          continue;
        }
        
        // Fetch true caption and image from the post page
        let caption = post.caption;
        let imageUrl = '';
        try {
          const postPage = await browser.newPage();
          await postPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
          const extracted = await postPage.evaluate(() => {
            let cap = '';
            let img = '';
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
            return { cap, img };
          });
          caption = extracted.cap;
          imageUrl = extracted.img;
          await postPage.close();
        } catch (e) {
          log.warn(`Could not fetch data for ${post.shortcode}: ${e.message}`);
        }

        post.caption = caption || 'Tanpa Caption';
        post.imageUrl = imageUrl || '';
        
        const isForwardAll = ConfigModel.get('ig_forward_all') === '1';
        let matchedRule = null;
        
        if (isForwardAll) {
          matchedRule = {
            code: 'FORWARD_ALL',
            target_group: ConfigModel.get('ig_default_group') || '',
            target_admin: ConfigModel.get('ig_default_admin') || ''
          };
          log.info(`Post ${post.shortcode} matched by FORWARD_ALL mode`);
        } else {
          const lowerCaption = post.caption.toLowerCase();
          for (const rule of activeRules) {
            const lowerCode = rule.code.toLowerCase();
            if (lowerCaption.includes(lowerCode)) {
              matchedRule = rule;
              break; // First match wins
            }
          }
        }
        
        if (matchedRule) {
          if (!isForwardAll) log.info(`Post ${post.shortcode} matched rule code: ${matchedRule.code}`);
          
          // Get templates
          const templateMsg = ConfigModel.get('ig_template_msg') || '📸 *INFO POSTINGAN BARU* 📸\n\nAda postingan Instagram terbaru (@{{username}}) yang terkait dengan instansi Anda.\n\n*Kode:* {{kode}}\n*Caption:* {{caption}}\n\n*Link:* {{link}}';
          const watermark = ConfigModel.get('ig_watermark') || '_Pesan otomatis dari Auto Notif Pengaduan_';
          
          // Format message
          const captionSnippet = post.caption.substring(0, 500) + (post.caption.length > 500 ? '...' : '');
          let message = templateMsg
            .replace(/\{\{username\}\}/g, username)
            .replace(/\{\{kode\}\}/g, matchedRule.code)
            .replace(/\{\{caption\}\}/g, captionSnippet)
            .replace(/\{\{link\}\}/g, post.link);
            
          message += `\n\n${watermark}`;
          
          let status = 'success';
          let errorMsg = '';
          
          // Send to group
          if (matchedRule.target_group) {
            try {
              const resGroup = await sendGroupMessage(matchedRule.target_group, message, { imageUrl: post.imageUrl });
              if (!resGroup.success) {
                status = 'failed';
                errorMsg += `Group: ${resGroup.error}. `;
              }
            } catch (err) {
              status = 'failed';
              errorMsg += `Group Exception: ${err.message}. `;
            }
          }
          
          // Send to admin
          if (matchedRule.target_admin) {
            try {
              const resAdmin = await sendPersonalMessage(matchedRule.target_admin, message, { imageUrl: post.imageUrl });
              if (!resAdmin.success) {
                status = 'failed';
                errorMsg += `Admin: ${resAdmin.error}. `;
              }
            } catch (err) {
              status = 'failed';
              errorMsg += `Admin Exception: ${err.message}. `;
            }
          }
          
          // Save to processed
          IgPostModel.save({
            shortcode: post.shortcode,
            link: post.link,
            caption: post.caption,
            matched_code: matchedRule.code,
            notified_group: matchedRule.target_group,
            status: status,
            error_msg: errorMsg.trim()
          });
          
        } else {
          // Save as processed even if no match so we don't check it again
          IgPostModel.save({
            shortcode: post.shortcode,
            link: post.link,
            caption: post.caption,
            matched_code: '',
            notified_group: '',
            status: 'ignored',
            error_msg: ''
          });
        }
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
