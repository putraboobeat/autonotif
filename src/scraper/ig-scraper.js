const { getBrowser, getPage } = require('./browser');
const { IgPostModel, ConfigModel, NotificationLogModel } = require('../database/models');
const { sendGroupMessage, sendPersonalMessage } = require('../notifier/starsender');
const { createLogger } = require('../utils/logger');

const log = createLogger('IG-SCRAPER');

let isScrapingInProgress = false;

async function scrapeInstagram(options = {}) {
  if (isScrapingInProgress) {
    log.info('IG scrape already in progress, skipping concurrent execution...');
    return;
  }
  isScrapingInProgress = true;

  try {
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

    for (const username of usernames) {
      log.info(`Checking Instagram for @${username}...`);
      ConfigModel.set('ig_scraper_status', `Sedang memeriksa profil @${username}...`);
      
      // We create a new page for IG to avoid messing with OCA page
      const browser = getBrowser();
      let igPage = null;
      
      try {
        igPage = await browser.newPage();
        await igPage.setCacheEnabled(false);
        
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
        
        // Close igPage after scraping profile — before processing posts
        await igPage.close();
        igPage = null;
        
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
          
          // Fetch true caption, image, video, and date from the post page
          let caption = post.caption;
          let imageUrl = '';
          let videoUrl = '';
          let postDate = '';
          let postPage = null;
          try {
            postPage = await browser.newPage();
            await postPage.setCacheEnabled(false);
            await postPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
            // Tunggu sebentar agar elemen slide utama selesai di-render
            try {
              await postPage.waitForSelector('div._aagv img, main img, meta[property="og:image"]', { timeout: 5000 });
              // Ensure the image has finished loading so we don't grab a cropped placeholder
              await postPage.evaluate(async () => {
                const img = document.querySelector('div._aagv img, main img');
                if (img) {
                  if (img.complete && img.naturalHeight > 0) return;
                  await new Promise(resolve => {
                    img.onload = resolve;
                    img.onerror = resolve;
                    setTimeout(resolve, 3000); // 3s timeout
                  });
                }
              });
            } catch {}

            const extracted = await postPage.evaluate(() => {
              let cap = '';
              let img = '';
              let vid = '';
              let pDate = '';
              const metaCap = document.querySelector('meta[property="og:title"]');
              if (metaCap) {
                const content = metaCap.getAttribute('content');
                const match = content.match(/on Instagram: "([\s\S]+)"/);
                cap = match ? match[1] : content;
              }

              // Ambil Slide 1 asli beresolusi penuh (bukan thumbnail og:image yang terpotong 1:1)
              let slide1Img = '';

              // Prioritas 1: div._aagv img (container media slide Instagram)
              const aagv = document.querySelector('div._aagv img');
              if (aagv && aagv.src) {
                if (aagv.srcset) {
                  const parts = aagv.srcset.split(',').map(s => s.trim().split(' '));
                  slide1Img = parts[parts.length - 1][0];
                } else {
                  slide1Img = aagv.src;
                }
              }

              // Prioritas 2: Gambar utama pertama di main/article (bukan avatar/foto profil)
              if (!slide1Img) {
                const allImgs = Array.from(document.querySelectorAll('main img, article img'));
                const firstSlide = allImgs.find(i => {
                  const alt = (i.alt || '').toLowerCase();
                  if (alt.includes('profile picture') || alt.includes('avatar')) return false;
                  if (i.closest('header')) return false;
                  const w = i.naturalWidth || i.width || 0;
                  const h = i.naturalHeight || i.height || 0;
                  return (w > 250 || h > 250);
                });
                if (firstSlide) {
                  if (firstSlide.srcset) {
                    const parts = firstSlide.srcset.split(',').map(s => s.trim().split(' '));
                    slide1Img = parts[parts.length - 1][0];
                  } else {
                    slide1Img = firstSlide.src;
                  }
                }
              }

              // Fallback: og:image hanya jika elemen slide di DOM tidak ditemukan sama sekali
              if (!slide1Img) {
                const metaImg = document.querySelector('meta[property="og:image"]');
                if (metaImg) {
                  slide1Img = metaImg.getAttribute('content');
                }
              }

              img = slide1Img || '';

              const metaVid = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]');
              if (metaVid) {
                vid = metaVid.getAttribute('content');
              }
              const timeEl = document.querySelector('time');
              if (timeEl) {
                pDate = timeEl.getAttribute('datetime');
              }
              // Transcode Slide 1 langsung menggunakan Canvas Chromium ke format JPEG murni
              // Ini mencegah bug text outline/rusak dan menjamin kompatibilitas 100% dengan WhatsApp
              let jpegBase64 = '';
              const targetImg = aagv || document.querySelector('main img, article img');
              if (targetImg && (targetImg.naturalWidth || targetImg.width) > 250) {
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = targetImg.naturalWidth || targetImg.width;
                  canvas.height = targetImg.naturalHeight || targetImg.height;
                  const ctx = canvas.getContext('2d');
                  ctx.fillStyle = '#FFFFFF';
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(targetImg, 0, 0);
                  jpegBase64 = canvas.toDataURL('image/jpeg', 0.95);
                } catch (e) {}
              }

              return { cap, img, vid, pDate, jpegBase64 };
            });
            caption = extracted.cap;
            imageUrl = extracted.img || '';
            videoUrl = extracted.vid || '';
            postDate = extracted.pDate;

            // Jika berhasil di-transcode ke JPEG murni via Canvas, upload langsung ke temporary host
            if (extracted.jpegBase64 && extracted.jpegBase64.startsWith('data:image/jpeg;base64,')) {
              try {
                const { uploadJpegBuffer } = require('../notifier/starsender');
                const buf = Buffer.from(extracted.jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
                const hostedUrl = await uploadJpegBuffer(buf);
                if (hostedUrl) {
                  imageUrl = hostedUrl;
                }
              } catch (upErr) {
                log.warn(`[SCRAPER] Gagal upload JPEG canvas: ${upErr.message}`);
              }
            }

            // Jika videoUrl belum didapat dari meta tags (sering terjadi pada format reels terbaru),
            // cari pola video_versions langsung dari HTML halaman
            if (!videoUrl) {
              const pageHtml = await postPage.content();
              const mVid = pageHtml.match(/"video_versions":\[\{"type":\d+,"url":"([^"]+)"/) ||
                           pageHtml.match(/"video_url":"([^"]+)"/);
              if (mVid) {
                videoUrl = mVid[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
              }
            }

          } catch (e) {
            log.warn(`Could not fetch data for ${post.shortcode}: ${e.message}`);
          } finally {
            // PENTING: Selalu tutup postPage agar tidak memory leak
            if (postPage && !postPage.isClosed()) {
              try { await postPage.close(); } catch {}
            }
          }

          post.caption = caption || 'Tanpa Caption';
          post.imageUrl = imageUrl || '';
          post.videoUrl = videoUrl || '';
          post.postDate = postDate || '';
          
          let targetGroup = (ConfigModel.get('ig_default_group') || '').trim();
          if (!targetGroup) {
            targetGroup = (ConfigModel.get('wa_group_id') || '').trim();
          }
          let targetAdmin = (ConfigModel.get('ig_default_admin') || '').trim();
          
          // Get templates
          const defaultTemplate = post.videoUrl 
            ? '🎬 *REELS / VIDEO TERBARU INSTAGRAM*\n@{{username}}\n\n{{caption}}\n\nSelengkapnya : {{link}}'
            : '📸 *POSTINGAN TERBARU INSTAGRAM*\n@{{username}}\n\n{{caption}}\n\nSelengkapnya : {{link}}';
          let templateMsg = ConfigModel.get('ig_template_msg');
          if (!templateMsg || templateMsg.includes('Kode:') || templateMsg.includes('terkait dengan instansi Anda')) {
            templateMsg = defaultTemplate;
          } else if (post.videoUrl && templateMsg.includes('📸 *POSTINGAN TERBARU INSTAGRAM*')) {
            templateMsg = templateMsg.replace('📸 *POSTINGAN TERBARU INSTAGRAM*', '🎬 *REELS / VIDEO TERBARU INSTAGRAM*');
          }
          
          // Format message (panjang caption sesuai setting ig_caption_max_length, default 50)
          const maxLen = parseInt(ConfigModel.get('ig_caption_max_length'), 10) || 50;
          const rawCaption = (post.caption || '').replace(/\s+/g, ' ').trim();
          const captionSnippet = rawCaption.length > maxLen ? rawCaption.substring(0, maxLen).trim() + '...' : (rawCaption || 'Postingan baru');
          
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
            // Send to group(s)
            if (targetGroup) {
              const groups = targetGroup.split(',').map(g => g.trim()).filter(Boolean);
              for (const grp of groups) {
                try {
                  const resGroup = await sendGroupMessage(grp, message, { imageUrl: post.imageUrl, videoUrl: post.videoUrl });
                  if (!resGroup.success) {
                    status = 'failed';
                    errorMsg += `Group (${grp}): ${resGroup.error || 'Gagal'}. `;
                  }
                  NotificationLogModel.create({
                    ticketId: `IG-${post.shortcode}`,
                    targetType: 'group',
                    targetName: grp,
                    targetNumber: '',
                    message: resGroup.sentMessage || message,
                    status: resGroup.success ? 'sent' : 'failed',
                    response: JSON.stringify(resGroup)
                  });
                  if (groups.length > 1) await sleep(1500);
                } catch (err) {
                  status = 'failed';
                  errorMsg += `Group (${grp}) Exception: ${err.message}. `;
                  NotificationLogModel.create({
                    ticketId: `IG-${post.shortcode}`,
                    targetType: 'group',
                    targetName: grp,
                    targetNumber: '',
                    message: message,
                    status: 'failed',
                    response: JSON.stringify({ error: err.message })
                  });
                }
              }
            }
            
            // Send to admin(s)
            if (targetAdmin) {
              const admins = targetAdmin.split(',').map(a => a.trim()).filter(Boolean);
              for (const adm of admins) {
                try {
                  const resAdmin = await sendPersonalMessage(adm, message, { imageUrl: post.imageUrl, videoUrl: post.videoUrl });
                  if (!resAdmin.success) {
                    status = 'failed';
                    errorMsg += `Admin (${adm}): ${resAdmin.error || 'Gagal'}. `;
                  }
                  NotificationLogModel.create({
                    ticketId: `IG-${post.shortcode}`,
                    targetType: 'personal',
                    targetName: 'Admin IG',
                    targetNumber: adm,
                    message: resAdmin.sentMessage || message,
                    status: resAdmin.success ? 'sent' : 'failed',
                    response: JSON.stringify(resAdmin)
                  });
                  if (admins.length > 1) await sleep(1500);
                } catch (err) {
                  status = 'failed';
                  errorMsg += `Admin (${adm}) Exception: ${err.message}. `;
                  NotificationLogModel.create({
                    ticketId: `IG-${post.shortcode}`,
                    targetType: 'personal',
                    targetName: 'Admin IG',
                    targetNumber: adm,
                    message: message,
                    status: 'failed',
                    response: JSON.stringify({ error: err.message })
                  });
                }
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
            image_url: post.imageUrl || '',
            video_url: post.videoUrl || '',
            account_username: username || ''
          });
        }

      } catch (profileError) {
        log.error(`Error scraping profile @${username}: ${profileError.message}`);
      } finally {
        // PENTING: Selalu tutup igPage agar tidak memory leak
        if (igPage && !igPage.isClosed()) {
          try { await igPage.close(); } catch {}
        }
      }
    } // End of loop over usernames

  } catch (error) {
    log.error('Error scraping Instagram', { error: error.message });
    ConfigModel.set('ig_scraper_status', `Gagal: ${error.message}`);
  } finally {
    // Lock selalu dilepas, tidak peduli exit path manapun
    setTimeout(() => {
        ConfigModel.set('ig_scraper_status', 'stopped');
    }, 5000); // Keep status visible for 5s
    ConfigModel.set('last_ig_scrape_time', new Date().toISOString());
    isScrapingInProgress = false;
  }
}

module.exports = {
  scrapeInstagram
};
