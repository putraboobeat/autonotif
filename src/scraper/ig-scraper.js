const { getBrowser, getPage } = require('./browser');
const { IgPostModel, ConfigModel, NotificationLogModel } = require('../database/models');
const { sendGroupMessage, sendPersonalMessage } = require('../notifier/starsender');
const { isEligibleForNuelink, postToNuelink } = require('../notifier/nuelink');
const { createLogger } = require('../utils/logger');

const log = createLogger('IG-SCRAPER');

function cleanIgImageUrl(url) {
  if (!url) return '';
  let u = url.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  // Hapus parameter crop Instagram seperti stp=c0.140.1080.1080a_ atau /c0.140.1080.1080a/ atau /s640x640/ agar rasio asli 4:5 / portrait tidak terpotong jadi 1:1 square
  u = u.replace(/stp=c[0-9\.]+a_/g, 'stp=');
  u = u.replace(/\/c[0-9\.]+a\//g, '/');
  u = u.replace(/\/s\d+x\d+\//g, '/');
  return u;
}

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
        const newPagePromise = browser.newPage();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('newPage timeout')), 10000));
        igPage = await Promise.race([newPagePromise, timeoutPromise]);
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
            const newPagePromise2 = browser.newPage();
            const timeoutPromise2 = new Promise((_, reject) => setTimeout(() => reject(new Error('newPage timeout')), 10000));
            postPage = await Promise.race([newPagePromise2, timeoutPromise2]);
            await postPage.setCacheEnabled(false);
            await postPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
            // Tunggu sebentar agar elemen slide utama selesai di-render
            try {
              await postPage.waitForSelector('div._aagv img, main img, meta[property="og:image"]', { timeout: 6000 });
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

            const pageHtml = await postPage.content();

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

              // Fallback: og:image jika elemen slide di DOM tidak ditemukan
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
              
              return { cap, img, vid, pDate };
            });

            caption = extracted.cap;
            imageUrl = cleanIgImageUrl(extracted.img || '');
            videoUrl = extracted.vid || '';
            postDate = extracted.pDate;

            // Ekstraksi mendalam dari pageHtml jika ada resource gambar tidak terpotong (display_resources / JSON-LD / display_url)
            if (pageHtml) {
              // 1. Ekstraksi tanggal publikasi jika timeEl kosong
              if (!postDate) {
                const mDatePub = pageHtml.match(/"datePublished":\s*"([^"]+)"/) || pageHtml.match(/"uploadDate":\s*"([^"]+)"/);
                if (mDatePub) {
                  postDate = mDatePub[1];
                } else {
                  const mTs = pageHtml.match(/"taken_at_timestamp":\s*(\d+)/) || pageHtml.match(/"taken_at":\s*(\d+)/);
                  if (mTs) {
                    postDate = new Date(parseInt(mTs[1], 10) * 1000).toISOString();
                  } else {
                    const mDatetime = pageHtml.match(/datetime="([^"]+)"/);
                    if (mDatetime) postDate = mDatetime[1];
                  }
                }
              }

              // 2. Ekstraksi gambar asli (uncropped 4:5 / 1080x1350) jika imageUrl kosong atau berpotensi terpotong
              const isPotentiallyCropped = !imageUrl || imageUrl.includes('stp=c') || imageUrl.includes('s640x640');
              if (isPotentiallyCropped) {
                // Cari display_resources (array resolusi asli Instagram)
                const mDispRes = pageHtml.match(/"display_resources":\s*(\[[^\]]+\])/);
                if (mDispRes) {
                  try {
                    const arr = JSON.parse(mDispRes[1]);
                    if (Array.isArray(arr) && arr.length > 0) {
                      arr.sort((a, b) => ((b.config_width || 0) * (b.config_height || 0)) - ((a.config_width || 0) * (a.config_height || 0)));
                      imageUrl = cleanIgImageUrl(arr[0].src);
                    }
                  } catch {}
                }

                // Cari display_url uncropped
                if (!imageUrl || isPotentiallyCropped) {
                  const mDispUrl = pageHtml.match(/"display_url":\s*"([^"]+)"/);
                  if (mDispUrl) {
                    imageUrl = cleanIgImageUrl(mDispUrl[1]);
                  }
                }

                // Cari JSON-LD image
                if (!imageUrl) {
                  const mLd = pageHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
                  if (mLd) {
                    try {
                      const ld = JSON.parse(mLd[1]);
                      const ldImg = typeof ld.image === 'string' ? ld.image : (ld.image?.url || ld.image?.[0]);
                      if (ldImg) imageUrl = cleanIgImageUrl(ldImg);
                    } catch {}
                  }
                }
              }

              // 3. Ekstraksi video URL
              if (!videoUrl) {
                const mVid = pageHtml.match(/"video_versions":\[\{"type":\d+,"url":"([^"]+)"/) ||
                             pageHtml.match(/"video_url":"([^"]+)"/) ||
                             pageHtml.match(/property="og:video(?::secure_url)?" content="([^"]+)"/i);
                if (mVid) {
                  videoUrl = mVid[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                }
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

          
            // ============================================
            // Download image locally for dashboard
            // ============================================
            if (imageUrl) {
              try {
                const fs = require('fs');
                const path = require('path');
                const uploadDir = path.join(__dirname, '..', 'dashboard', 'public', 'uploads');
                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                const localPath = path.join(uploadDir, `ig_${post.shortcode}.jpg`);
                
                // Fetch image and save
                const res = await fetch(imageUrl, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                  },
                  signal: AbortSignal.timeout(10000)
                });
                if (res.ok) {
                  
                  let arrayBuffer = await res.arrayBuffer();
                  let buffer = Buffer.from(arrayBuffer);
                  
                  try {
                    const sharp = require('sharp');
                    // Force convert any format (WEBP/AVIF/PNG) to standard JPEG
                    buffer = await sharp(buffer)
                      .jpeg({ quality: 90 })
                      .toBuffer();
                  } catch (sharpErr) {
                    log.warn(`[IG] Warning: sharp conversion failed, using original buffer. Error: ${sharpErr.message}`);
                  }
                  
                  fs.writeFileSync(localPath, buffer);

                  const { uploadJpegBuffer } = require('../notifier/starsender');
                  const hostedUrl = await uploadJpegBuffer(buffer);
                  if (hostedUrl) {
                    post.imageUrl = hostedUrl; // Save Catbox URL to DB so Nuelink/WA can access it publicly
                  } else {
                    post.imageUrl = imageUrl; // Fallback to original CDN url
                  }
                }
              } catch (dlErr) {
                log.warn(`Failed to download image locally for ${post.shortcode}: ${dlErr.message}`);
              }
            }

          post.caption = caption || 'Tanpa Caption';
          post.imageUrl = post.imageUrl || imageUrl || '';
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
          
          // Cek toggle filter blast khusus akun kanwilbpnaceh
          const blastKanwilOnly = ConfigModel.get('ig_blast_kanwil_only') === '1';
          const isKanwilAccount = (username || '').toLowerCase().replace('@', '').trim() === 'kanwilbpnaceh';
          
          if (blastKanwilOnly && !isKanwilAccount) {
            log.info(`[IG] Filter aktif: Postingan ${post.shortcode} dari @${username} dipantau tanpa blast ke WhatsApp (hanya @kanwilbpnaceh yang diblast).`);
            status = 'monitored';
          } else if (!targetGroup && !targetAdmin) {
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
          
          // ============================================
          // Nuelink Auto Repost (Khusus Reels ATR/BPN)
          // ============================================
          let nuelinkPostId = null;
          let nuelinkPushedAt = null;

          try {
            const nuelinkCheck = isEligibleForNuelink(post, username);
            if (nuelinkCheck.eligible) {
              log.info(`[IG->NUELINK] Post ${post.shortcode} from @${username} is eligible. Sending to Nuelink Repost collection...`);
              const nuelinkRes = await postToNuelink({
                caption: post.caption,
                videoUrl: post.videoUrl,
                imageUrl: post.imageUrl,
                link: post.link,
                username: username,
                shortcode: post.shortcode
              });
              if (nuelinkRes && nuelinkRes.postId) {
                nuelinkPostId = String(nuelinkRes.postId);
                nuelinkPushedAt = new Date().toISOString();
                log.info(`[IG->NUELINK] ✅ Successfully queued to Nuelink (Post ID: ${nuelinkPostId})`);
              }
            } else {
              log.debug(`[IG->NUELINK] Skipped post ${post.shortcode}: ${nuelinkCheck.reason}`);
            }
          } catch (nuelinkErr) {
            log.error(`[IG->NUELINK] ⚠️ Failed posting to Nuelink: ${nuelinkErr.message}`);
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
            account_username: username || '',
            nuelink_post_id: nuelinkPostId,
            nuelink_pushed_at: nuelinkPushedAt
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
