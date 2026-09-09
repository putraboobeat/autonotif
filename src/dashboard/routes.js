const express = require('express');
const { AdminModel, TicketModel, NotificationLogModel, ConfigModel, HolidayModel, IgPostModel, WebArticleModel } = require('../database/models');
const { sendPersonalMessage, sendGroupMessage } = require('../notifier/starsender');
const { buildTestMessage } = require('../notifier/message-builder');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { formatPhoneNumber } = require('../utils/helpers');
const { getAuthStatus, startLoginInteractive, submitOtpInteractive } = require('../scraper/login-controller');
const { getAllTemplates, renderTemplate } = require('../notifier/templates');
const { getSlaMetrics } = require('../analytics/sla-service');
const { generateCsvReport, generateHtmlReport, generatePdfReport, sendExecutiveReportToKanwil } = require('../analytics/report-generator');
const { scrapeInstagram } = require('../scraper/ig-scraper');
const { testNuelinkConnection, postToNuelink, getNuelinkConfig } = require('../notifier/nuelink');

const log = createLogger('ROUTES');

function createRoutes() {
  const router = express.Router();

  // ============================================
  // StarSender API Health Check (Realtime)
  // ============================================
  router.get('/starsender/status', async (req, res) => {
    try {
      const apiKey = (() => {
        try {
          require('dotenv').config({ override: true });
          if (process.env.STARSENDER_API_KEY) config.starsender.apiKey = process.env.STARSENDER_API_KEY;
        } catch {}
        try {
          const dbKey = ConfigModel.get('starsender_api_key');
          if (dbKey) return dbKey;
        } catch {}
        return config.starsender.apiKey;
      })();

      if (!apiKey) {
        return res.json({ success: true, data: { status: 'no_key', message: 'API Key belum dikonfigurasi' } });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(config.starsender.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 401 || response.status === 403) {
        res.json({ success: true, data: { status: 'error', message: 'API Key tidak valid atau expired', checkedAt: new Date().toISOString() } });
      } else {
        res.json({ success: true, data: { status: 'connected', message: 'StarSender API terkoneksi dan aktif', checkedAt: new Date().toISOString() } });
      }
    } catch (error) {
      res.json({ success: true, data: { status: 'disconnected', message: error.name === 'AbortError' ? 'Timeout: API tidak merespons' : error.message, checkedAt: new Date().toISOString() } });
    }
  });

  // ============================================
  // Dashboard Stats
  // ============================================

  router.get('/stats', (req, res) => {
    try {
      const ticketStats = TicketModel.getStats();
      const notifStats = NotificationLogModel.getStats();
      const sysConfig = ConfigModel.getAll();

      res.json({
        success: true,
        data: {
          tickets: ticketStats,
          notifications: notifStats,
          scraper: {
            status: sysConfig.scraper_status || 'unknown',
            lastScrape: sysConfig.last_scrape_time || '-',
            interval: config.app.scrapeInterval,
          },
          settings: {
            notificationEnabled: sysConfig.notification_enabled === '1',
            groupEnabled: sysConfig.group_notification_enabled === '1',
            personalEnabled: sysConfig.personal_notification_enabled === '1',
            waGroupId: sysConfig.wa_group_id || '',
            reminderInterval: sysConfig.reminder_interval_minutes || '0',
          },
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Admin CRUD
  // ============================================

  // Get all admins
  router.get('/admins', (req, res) => {
    try {
      const admins = AdminModel.getAll();
      res.json({ success: true, data: admins });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get admin by ID
  router.get('/admins/:id', (req, res) => {
    try {
      const admin = AdminModel.getById(parseInt(req.params.id));
      if (!admin) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }
      res.json({ success: true, data: admin });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create admin
  router.post('/admins', (req, res) => {
    try {
      const { nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null } = req.body;
      if (!nama || !kantor_pertanahan || !no_hp) {
        return res.status(400).json({ success: false, error: 'Nama, kantor pertanahan, dan no HP wajib diisi' });
      }
      const result = AdminModel.create({ 
        nama, 
        kantor_pertanahan, 
        no_hp: formatPhoneNumber(no_hp), 
        jabatan, 
        nama_ktu, 
        no_hp_ktu: no_hp_ktu ? formatPhoneNumber(no_hp_ktu) : null 
      });
      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ success: false, error: 'Kantor pertanahan sudah terdaftar' });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update admin
  router.put('/admins/:id', (req, res) => {
    try {
      const { nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null, is_active } = req.body;
      AdminModel.update(parseInt(req.params.id), {
        nama,
        kantor_pertanahan,
        no_hp: formatPhoneNumber(no_hp),
        jabatan,
        nama_ktu,
        no_hp_ktu: no_hp_ktu ? formatPhoneNumber(no_hp_ktu) : null,
        is_active: is_active !== undefined ? is_active : true,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete admin
  router.delete('/admins/:id', (req, res) => {
    try {
      AdminModel.delete(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Holiday (Hari Besar) CRUD
  // ============================================

  router.get('/holidays', (req, res) => {
    try {
      const holidays = HolidayModel.getAll();
      res.json({ success: true, data: holidays });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/holidays/seed', async (req, res) => {
    try {
      const { getHolidaySeedData } = require('../detector/holiday-seeder');
      const currentYear = new Date().getFullYear();
      const seedData = await getHolidaySeedData(currentYear);
      const count = HolidayModel.insertMany(seedData);
      res.json({ success: true, count, message: `${count} hari besar berhasil di-generate untuk tahun ${currentYear}` });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/holidays', (req, res) => {
    try {
      const { name, event_date, target_group, target_admins } = req.body;
      if (!name || !event_date) {
        return res.status(400).json({ success: false, error: 'Nama dan Tanggal Hari Besar wajib diisi' });
      }
      HolidayModel.create({
        name,
        event_date,
        target_group: target_group || null,
        target_admins: target_admins || null,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.put('/holidays/:id', (req, res) => {
    try {
      const { name, event_date, target_group, target_admins, is_active } = req.body;
      if (!name || !event_date) {
        return res.status(400).json({ success: false, error: 'Nama dan Tanggal Hari Besar wajib diisi' });
      }
      HolidayModel.update(parseInt(req.params.id), {
        name,
        event_date,
        target_group: target_group || null,
        target_admins: target_admins || null,
        is_active: is_active !== undefined ? is_active : true,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/holidays/:id', (req, res) => {
    try {
      HolidayModel.delete(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Instagram Rules CRUD
  // ============================================

  router.post('/ig-scraper/force', async (req, res) => {
    try {
      ConfigModel.set('ig_scrape_mode', 'normal');
      // Trigger IG scrape asynchronously
      scrapeInstagram({ isManual: true }).catch(e => log.error('Manual IG Scrape Error', { error: e.message }));
      res.json({ success: true, message: 'Instagram scraper dijalankan di latar belakang.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  router.post('/ig-scraper/deep', async (req, res) => {
    try {
      ConfigModel.set('ig_scrape_mode', 'deep');
      // Trigger IG scrape asynchronously
      scrapeInstagram({ isManual: true }).catch(e => log.error('Deep IG Scrape Error', { error: e.message }));
      res.json({ success: true, message: 'Instagram Scraper (Unlimited Scroll Mode) dimulai.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-scraper/stop', (req, res) => {
    try {
      ConfigModel.set('ig_scrape_mode', 'stopping');
      res.json({ success: true, message: 'Perintah berhenti dikirim ke Scraper.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  router.get('/ig-posts', (req, res) => {
    try {
      const { IgPostModel, ConfigModel } = require('../database/models');
      const posts = IgPostModel.getAll();
      const defaultUser = (ConfigModel.get('ig_username') || '').trim() || 'kanwilbpnaceh';
      const enrichedPosts = posts.map(p => {
        const isReel = !!(p.video_url || (p.link && p.link.includes('/reel/')));
        let account = p.account_username;
        if (!account && p.link) {
          const matchUser = p.link.match(/instagram\.com\/([^\/]+)\/(p|reel)\//);
          if (matchUser && matchUser[1] && !['p', 'reel', 'tv'].includes(matchUser[1])) {
            account = matchUser[1];
          }
        }
        // Normalize SQLite UTC created_at to ISO string so client browser parses local WIB correctly
        let formattedCreatedAt = p.created_at;
        if (formattedCreatedAt && typeof formattedCreatedAt === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(formattedCreatedAt)) {
          formattedCreatedAt = formattedCreatedAt.replace(' ', 'T') + 'Z';
        }
        return {
          ...p,
          created_at: formattedCreatedAt,
          category: isReel ? 'reels' : 'feed',
          account_username: account || defaultUser
        };
      });
      res.json({ success: true, data: enrichedPosts });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-posts/:id/resend', async (req, res) => {
    try {
      const { IgPostModel } = require('../database/models');
      const post = IgPostModel.getById(parseInt(req.params.id));
      if (!post) {
        return res.status(404).json({ success: false, error: 'Postingan tidak ditemukan' });
      }
      
      let { target_group, target_admin } = req.body;
      if (!target_group && !target_admin) {
         target_group = ConfigModel.get('ig_default_group') || '';
         target_admin = ConfigModel.get('ig_default_admin') || '';
         if (!target_group && !target_admin) {
           return res.status(400).json({ success: false, error: 'Target Group atau Admin belum disetel di pengaturan.' });
         }
      }
      

      
      let imageUrl = post.image_url || '';
      let videoUrl = post.video_url || '';

      // Cek apakah imageUrl kosong, thumbnail terpotong, atau CDN Instagram yang butuh transcode JPEG murni
      const isInstagramCdn = imageUrl && (imageUrl.includes('cdninstagram.com') || imageUrl.includes('fbcdn.net'));
      const isCroppedImage = imageUrl && (imageUrl.includes('stp=c') || imageUrl.includes('s640x640'));
      const needsImageFetch = (!imageUrl || isCroppedImage || isInstagramCdn) && !videoUrl && post.link;
      const needsVideoFetch = !videoUrl && post.link && post.link.includes('/reel/');

      if (needsVideoFetch || needsImageFetch) {
        try {
          const { launchBrowser } = require('../scraper/browser');
          const { browser } = await launchBrowser();
          const pPage = await browser.newPage();
          await pPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 18000 });

          if (needsVideoFetch) {
            const pHtml = await pPage.content();
            const mVid = pHtml.match(/"video_versions":\[\{"type":\d+,"url":"([^"]+)"/) ||
                         pHtml.match(/"video_url":"([^"]+)"/);
            if (mVid) {
              videoUrl = mVid[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
              if (post.id) {
                try {
                  const { getDb } = require('../database/init');
                  getDb().prepare('UPDATE processed_ig_posts SET video_url = ? WHERE id = ?').run(videoUrl, post.id);
                } catch {}
              }
            }
          }

          if (needsImageFetch) {
            try {
              await pPage.waitForSelector('div._aagv img, main img, meta[property="og:image"]', { timeout: 3500 });
            } catch {}

            const extResult = await pPage.evaluate(() => {
              // 1. div._aagv img (container slide Instagram)
              const aagv = document.querySelector('div._aagv img');
              let slide1Img = '';
              if (aagv && aagv.src) {
                if (aagv.srcset) {
                  const parts = aagv.srcset.split(',').map(s => s.trim().split(' '));
                  slide1Img = parts[parts.length - 1][0];
                } else {
                  slide1Img = aagv.src;
                }
              }
              // 2. Gambar pertama di main/article (bukan avatar)
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
              // 3. Fallback meta og:image
              if (!slide1Img) {
                slide1Img = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
              }

              // 4. Transcode via Canvas ke format JPEG murni
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

              return { slide1Img, jpegBase64 };
            });

            if (extResult.jpegBase64 && extResult.jpegBase64.startsWith('data:image/jpeg;base64,')) {
              try {
                const { uploadJpegBuffer } = require('../notifier/starsender');
                const buf = Buffer.from(extResult.jpegBase64.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
                const hostedUrl = await uploadJpegBuffer(buf);
                if (hostedUrl) imageUrl = hostedUrl;
              } catch (upErr) {}
            } else if (extResult.slide1Img) {
              imageUrl = extResult.slide1Img;
            }

            if (imageUrl && post.id) {
              try {
                const { getDb } = require('../database/init');
                getDb().prepare('UPDATE processed_ig_posts SET image_url = ? WHERE id = ?').run(imageUrl, post.id);
              } catch {}
            }
          }

          await pPage.close();
        } catch (e) {
          if (!imageUrl && post.link) {
            try {
              const resHtml = await fetch(post.link, { headers: { 'User-Agent': 'curl/7.68.0' }, signal: AbortSignal.timeout(6000) });
              const html = await resHtml.text();
              const m = html.match(/property="og:image" content="([^"]+)"/);
              if (m) imageUrl = m[1].replace(/&amp;/g, '&');
            } catch {}
          }
        }
      }

      const defaultTemplate = videoUrl 
        ? '🎬 *REELS / VIDEO TERBARU INSTAGRAM*\n@{{username}}\n\n{{caption}}\n\nSelengkapnya : {{link}}'
        : '📸 *POSTINGAN TERBARU INSTAGRAM*\n@{{username}}\n\n{{caption}}\n\nSelengkapnya : {{link}}';
      let templateMsg = ConfigModel.get('ig_template_msg');
      if (!templateMsg || templateMsg.includes('Kode:') || templateMsg.includes('terkait dengan instansi Anda')) {
        templateMsg = defaultTemplate;
      } else if (videoUrl && templateMsg.includes('📸 *POSTINGAN TERBARU INSTAGRAM*')) {
        templateMsg = templateMsg.replace('📸 *POSTINGAN TERBARU INSTAGRAM*', '🎬 *REELS / VIDEO TERBARU INSTAGRAM*');
      }

      const maxLen = parseInt(ConfigModel.get('ig_caption_max_length'), 10) || 50;
      const rawCaption = (post.caption || '').replace(/\s+/g, ' ').trim();
      const captionSnippet = rawCaption.length > maxLen ? rawCaption.substring(0, maxLen).trim() + '...' : (rawCaption || 'Postingan baru');
      
      let message = templateMsg
        .replace(/\{\{username\}\}/g, post.account_username || 'Instagram')
        .replace(/\{\{caption\}\}/g, captionSnippet)
        .replace(/\{\{link\}\}/g, post.link || '')
        .replace(/Kode:\s*\{\{kode\}\}\n*/gi, '')
        .replace(/\{\{kode\}\}/g, '')
        .trim();
      
      let status = 'success';
      let errorMsg = '';
      
      if (target_group) {
        const groups = target_group.split(',').map(g => g.trim()).filter(Boolean);
        for (const grp of groups) {
          try {
            const resGroup = await sendGroupMessage(grp, message, { imageUrl, videoUrl });
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
            if (groups.length > 1) {
              const { sleep } = require('../utils/helpers');
              await sleep(1500);
            }
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
      
      if (target_admin) {
        const admins = target_admin.split(',').map(a => a.trim()).filter(Boolean);
        for (const adm of admins) {
          try {
            const resAdmin = await sendPersonalMessage(adm, message, { imageUrl, videoUrl });
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
            if (admins.length > 1) {
              const { sleep } = require('../utils/helpers');
              await sleep(1500);
            }
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
      
      IgPostModel.updateStatus(post.id, status, errorMsg.trim());
      if (status === 'failed') {
        res.json({ success: false, error: `Pengiriman gagal: ${errorMsg.trim()}` });
      } else {
        res.json({ success: true, message: 'Kirim ulang berhasil dikirim via WhatsApp!' });
      }
      
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Nuelink Social Repost Endpoints
  // ============================================

  router.get('/nuelink/status', async (req, res) => {
    try {
      const cfg = getNuelinkConfig();
      const statusRes = await testNuelinkConnection(cfg.apiKey);
      res.json({
        success: statusRes.success,
        config: {
          enabled: cfg.enabled,
          brandId: cfg.brandId,
          collectionId: cfg.collectionId,
          publishMode: cfg.publishMode,
          reelsOnly: cfg.reelsOnly,
          targetAccounts: cfg.targetAccounts,
        },
        data: statusRes,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/nuelink/test-post', async (req, res) => {
    try {
      const { caption, publishMode } = req.body;
      const result = await postToNuelink({
        caption: caption || 'Uji coba koneksi Nuelink dari Auto Notif Pengaduan',
        publishMode: publishMode || 'DRAFT',
      });
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-posts/:id/send-nuelink', async (req, res) => {
    try {
      const { IgPostModel } = require('../database/models');
      const post = IgPostModel.getById(parseInt(req.params.id));
      if (!post) {
        return res.status(404).json({ success: false, error: 'Postingan tidak ditemukan' });
      }

      let imageUrl = post.image_url || '';
      let videoUrl = post.video_url || '';

      // If videoUrl is missing for a reel, try fetching it
      if (!videoUrl && post.link && post.link.includes('/reel/')) {
        try {
          const { launchBrowser } = require('../scraper/browser');
          const browser = await launchBrowser();
          const pPage = await browser.newPage();
          try {
            await pPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
            const pageHtml = await pPage.content();
            const mVid = pageHtml.match(/"video_versions":\[\{"type":\d+,"url":"([^"]+)"/) ||
                         pageHtml.match(/"video_url":"([^"]+)"/);
            if (mVid) {
              videoUrl = mVid[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            }
          } finally {
            await pPage.close();
          }
        } catch (fErr) {
          log.warn(`Could not fetch fresh reel video URL: ${fErr.message}`);
        }
      }

      const isReel = Boolean(videoUrl || (post.link && post.link.includes('/reel/')) || post.video_url || post.category === 'reels');
      const cfg = getNuelinkConfig();
      if (cfg.reelsOnly && !isReel) {
        return res.status(400).json({
          success: false,
          error: 'Pengaturan Nuelink saat ini khusus Reels. Postingan ini adalah foto/feed biasa.',
        });
      }

      const publishMode = req.body.publishMode || 'QUEUE';
      const result = await postToNuelink({
        caption: post.caption,
        videoUrl: videoUrl,
        imageUrl: imageUrl,
        link: post.link,
        username: post.account_username || 'kementerian.atrbpn',
        shortcode: post.shortcode,
        publishMode: publishMode,
      });

      res.json({
        success: true,
        message: `Berhasil dikirim ke Nuelink (Collection Repost)! Post ID: ${result.postId}`,
        data: result,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-posts/batch-push-nuelink', async (req, res) => {
    try {
      const { ids, publishMode } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal satu postingan untuk di-push ke Nuelink.' });
      }

      const { IgPostModel } = require('../database/models');
      const numIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
      const cfg = getNuelinkConfig();
      
      let successful = [];
      let failed = [];

      for (const id of numIds) {
        const post = IgPostModel.getById(id);
        if (!post) {
          failed.push({ id, error: 'Post tidak ditemukan' });
          continue;
        }

        let imageUrl = post.image_url || '';
        let videoUrl = post.video_url || '';

        // If videoUrl is missing for a reel, try fetching it
        if (!videoUrl && post.link && post.link.includes('/reel/')) {
          try {
            const { launchBrowser } = require('../scraper/browser');
            const browser = await launchBrowser();
            const pPage = await browser.newPage();
            try {
              await pPage.goto(post.link, { waitUntil: 'domcontentloaded', timeout: 20000 });
              const pageHtml = await pPage.content();
              const mVid = pageHtml.match(/"video_versions":\[\{"type":\d+,"url":"([^"]+)"/) ||
                           pageHtml.match(/"video_url":"([^"]+)"/);
              if (mVid) {
                videoUrl = mVid[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
              }
            } finally {
              await pPage.close();
            }
          } catch (fErr) {
            log.warn(`Could not fetch fresh reel video URL: ${fErr.message}`);
          }
        }

        const isReel = Boolean(videoUrl || (post.link && post.link.includes('/reel/')) || post.video_url || post.category === 'reels');
        if (cfg.reelsOnly && !isReel) {
          failed.push({ id, shortcode: post.shortcode, error: 'Dilewati: Bukan Reels (Pengaturan khusus Reels aktif)' });
          continue;
        }

        try {
          const result = await postToNuelink({
            caption: post.caption,
            videoUrl: videoUrl,
            imageUrl: imageUrl,
            link: post.link,
            username: post.account_username || 'kementerian.atrbpn',
            shortcode: post.shortcode,
            publishMode: publishMode || 'QUEUE',
          });
          successful.push({ id, postId: result.postId, shortcode: post.shortcode });
        } catch (err) {
          failed.push({ id, shortcode: post.shortcode, error: err.message });
        }
      }

      res.json({
        success: successful.length > 0,
        message: `${successful.length} dari ${numIds.length} postingan berhasil di-push ke Nuelink.`,
        successful,
        failed,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-scraper/ping-group', async (req, res) => {
    try {
      const { group } = req.body;
      if (!group) return res.status(400).json({ success: false, error: 'Group tidak boleh kosong' });
      
      const groups = group.split(',').map(g => g.trim()).filter(Boolean);
      let successList = [];
      let failList = [];
      const { sleep } = require('../utils/helpers');

      for (const grp of groups) {
        const result = await sendGroupMessage(grp, '🤖 *PING TEST* 🤖\n\nIni adalah pesan percobaan dari sistem Instagram Auto Notif.');
        if (result.success) {
          successList.push(grp);
        } else {
          failList.push(`${grp} (${result.error || 'Gagal'})`);
        }
        if (groups.length > 1) await sleep(1000);
      }

      if (failList.length === 0) {
        res.json({ success: true, message: `Ping berhasil dikirim ke ${successList.length} group: ${successList.join(', ')}` });
      } else if (successList.length > 0) {
        res.json({ success: true, message: `Berhasil ke: ${successList.join(', ')}. Gagal ke: ${failList.join(', ')}` });
      } else {
        res.status(500).json({ success: false, error: `Gagal kirim: ${failList.join(', ')}` });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/ig-scraper/ping-admin', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ success: false, error: 'Nomor HP tidak boleh kosong' });
      
      const phones = phone.split(',').map(p => p.trim()).filter(Boolean);
      let successList = [];
      let failList = [];
      const { sleep } = require('../utils/helpers');

      for (const p of phones) {
        const result = await sendPersonalMessage(p, '🤖 *PING TEST* 🤖\n\nIni adalah pesan percobaan dari sistem Instagram Auto Notif.');
        if (result.success) {
          successList.push(p);
        } else {
          failList.push(`${p} (${result.error || 'Gagal'})`);
        }
        if (phones.length > 1) await sleep(1000);
      }

      if (failList.length === 0) {
        res.json({ success: true, message: `Ping berhasil dikirim ke ${successList.length} nomor: ${successList.join(', ')}` });
      } else if (successList.length > 0) {
        res.json({ success: true, message: `Berhasil ke: ${successList.join(', ')}. Gagal ke: ${failList.join(', ')}` });
      } else {
        res.status(500).json({ success: false, error: `Gagal kirim: ${failList.join(', ')}` });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });


  router.post('/holidays/:id/send', async (req, res) => {
    try {
      const holiday = HolidayModel.getById(parseInt(req.params.id));
      if (!holiday) {
        return res.status(404).json({ success: false, error: 'Data Hari Besar tidak ditemukan' });
      }

      const { buildHolidayReminderMessage } = require('../notifier/message-builder');
      const message = buildHolidayReminderMessage(holiday, 'manual');
      
      const groupTarget = holiday.target_group || ConfigModel.get('holiday_wa_group_id') || config.starsender.defaultGroupId;
      const adminTarget = holiday.target_admins || ConfigModel.get('holiday_admin_number') || '';

      let successCount = 0;

      if (groupTarget) {
        const groupRes = await sendGroupMessage(groupTarget, message);
        if (groupRes && groupRes.success) successCount++;
      }

      if (adminTarget) {
        const { formatPhoneNumber } = require('../utils/helpers');
        const adminNumbers = adminTarget.split(',').map(n => n.trim()).filter(Boolean);
        for (const num of adminNumbers) {
          const cleanNum = formatPhoneNumber(num);
          if (cleanNum) {
            const adminRes = await sendPersonalMessage(cleanNum, message, { useIceBreaker: true, recipientName: 'Admin' });
            if (adminRes && adminRes.success) successCount++;
          }
        }
      }

      res.json({ success: true, message: `Berhasil mengirim ${successCount} pesan manual` });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Kirim pesan WhatsApp custom ke kontak admin kantor pertanahan / KTU
  router.post('/admins/:id/send-message', async (req, res) => {
    try {
      const adminId = parseInt(req.params.id);
      const { message, targetType = 'all' } = req.body;

      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Teks pesan tidak boleh kosong' });
      }

      const admin = AdminModel.getById(adminId);
      if (!admin) {
        return res.status(404).json({ success: false, error: 'Data admin tidak ditemukan' });
      }

      let sentCount = 0;
      const results = [];

      // Kirim ke Petugas Admin
      if ((targetType === 'all' || targetType === 'admin') && admin.no_hp) {
        const cleanPhone = formatPhoneNumber(admin.no_hp);
        if (cleanPhone) {
          const resAdmin = await sendPersonalMessage(cleanPhone, message.trim(), { useIceBreaker: true, recipientName: admin.nama });
          NotificationLogModel.create({
            ticketId: 'CUSTOM-MSG',
            targetType: 'custom_admin_msg',
            targetName: `${admin.nama || 'Admin'} (${admin.kantor_pertanahan})`,
            targetNumber: cleanPhone,
            message: message.trim(),
            status: resAdmin && resAdmin.success ? 'sent' : 'failed',
            response: JSON.stringify(resAdmin),
          });
          if (resAdmin && resAdmin.success) sentCount++;
          results.push({ target: 'Petugas Admin', name: admin.nama, phone: cleanPhone, result: resAdmin });
        }
      }

      // Kirim ke Kasubbag TU
      if ((targetType === 'all' || targetType === 'ktu') && admin.no_hp_ktu) {
        const cleanKtuPhone = formatPhoneNumber(admin.no_hp_ktu);
        if (cleanKtuPhone) {
          const resKtu = await sendPersonalMessage(cleanKtuPhone, message.trim(), { useIceBreaker: true, recipientName: admin.nama_ktu });
          NotificationLogModel.create({
            ticketId: 'CUSTOM-MSG',
            targetType: 'custom_ktu_msg',
            targetName: `${admin.nama_ktu || 'Kasubbag TU'} (${admin.kantor_pertanahan})`,
            targetNumber: cleanKtuPhone,
            message: message.trim(),
            status: resKtu && resKtu.success ? 'sent' : 'failed',
            response: JSON.stringify(resKtu),
          });
          if (resKtu && resKtu.success) sentCount++;
          results.push({ target: 'Kasubbag TU', name: admin.nama_ktu, phone: cleanKtuPhone, result: resKtu });
        }
      }

      if (sentCount > 0) {
        res.json({ success: true, message: `Pesan berhasil terkirim ke ${sentCount} kontak di ${admin.kantor_pertanahan}!`, details: results });
      } else {
        const errorDetails = results.map(r => `${r.target} (${r.phone}): ${r.result && r.result.error ? r.result.error : 'Gagal'}`).join(' | ');
        res.status(400).json({ 
          success: false, 
          error: errorDetails ? `Gagal mengirim ke StarSender API: ${errorDetails}` : `Tidak ada nomor telepon yang valid pada target yang dipilih untuk ${admin.kantor_pertanahan}.`, 
          details: results 
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Processed Tickets
  // ============================================

  router.get('/tickets', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const tickets = TicketModel.getRecent(limit);
      res.json({ success: true, data: tickets });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/tickets/refresh-live', async (req, res) => {
    try {
      if (typeof global.triggerManualScrape === 'function') {
        await global.triggerManualScrape();
        const limit = parseInt(req.query.limit) || 50;
        const tickets = TicketModel.getRecent(limit);
        res.json({ success: true, data: tickets, message: 'Data dan status tiket berhasil diperbarui secara live dari OCA!' });
      } else {
        res.status(503).json({ success: false, error: 'Sistem scraper belum siap' });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/tickets/export', (req, res) => {
    try {
      const tickets = TicketModel.getAll();
      const header = 'No,Ticket ID,Kantor Pertanahan,Customer,Priority,Status,Category,Subject,Created Date,Last Notified\n';
      const rows = tickets.map((t, idx) => {
        const clean = str => `"${(str || '').toString().replace(/"/g, '""')}"`;
        return `${idx + 1},${clean(t.ticket_id)},${clean(t.kantor_pertanahan)},${clean(t.customer)},${clean(t.priority)},${clean(t.status)},${clean(t.category)},${clean(t.subject)},${clean(t.created_date || t.created_at)},${clean(t.last_notified_at || t.notified_at)}`;
      }).join('\n');
      
      const csv = '\uFEFF' + header + rows; // Include BOM for Excel UTF-8 display
      const timestamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Laporan_Tiket_Pengaduan_${timestamp}.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/tickets/:ticketId/resend', async (req, res) => {
    try {
      const ticketId = req.params.ticketId;
      const allTickets = TicketModel.getAll();
      const ticket = allTickets.find(t => t.ticket_id === ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
      }

      const admins = AdminModel.findByKantor(ticket.kantor_pertanahan);
      const notifiedNumbers = new Set();
      let totalSent = 0;

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          const cleanPhone = formatPhoneNumber(admin.no_hp);
          if (cleanPhone && !notifiedNumbers.has(cleanPhone)) {
            const msg = renderTemplate('template_manual_resend', {
              ticketId: ticket.ticket_id,
              customer: ticket.customer,
              kantor: ticket.kantor_pertanahan,
              kategori: ticket.category,
              subjek: ticket.subject || ticket.category,
              tanggal: ticket.created_date || ticket.created_at,
              lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
              adminNama: admin.nama
            });
            const result = await sendPersonalMessage(cleanPhone, msg, { useIceBreaker: true, recipientName: admin.nama });
            notifiedNumbers.add(cleanPhone);
            totalSent++;
            NotificationLogModel.create({
              ticketId: ticket.ticket_id,
              targetType: 'personal_manual',
              targetName: admin.nama,
              targetNumber: cleanPhone,
              message: msg,
              status: result && result.success ? 'sent' : 'failed',
              response: JSON.stringify(result),
            });
          }

          const cleanKtuPhone = formatPhoneNumber(admin.no_hp_ktu);
          if (cleanKtuPhone && !notifiedNumbers.has(cleanKtuPhone)) {
            const ktuMsg = renderTemplate('template_manual_resend', {
              ticketId: ticket.ticket_id,
              customer: ticket.customer,
              kantor: ticket.kantor_pertanahan,
              kategori: ticket.category,
              subjek: ticket.subject || ticket.category,
              tanggal: ticket.created_date || ticket.created_at,
              lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
              adminNama: admin.nama_ktu || 'Kasubbag Tata Usaha'
            });
            const ktuResult = await sendPersonalMessage(cleanKtuPhone, ktuMsg, { useIceBreaker: true, recipientName: admin.nama_ktu });
            notifiedNumbers.add(cleanKtuPhone);
            totalSent++;
            NotificationLogModel.create({
              ticketId: ticket.ticket_id,
              targetType: 'personal_manual_ktu',
              targetName: admin.nama_ktu || 'Kasubbag TU',
              targetNumber: cleanKtuPhone,
              message: ktuMsg,
              status: ktuResult && ktuResult.success ? 'sent' : 'failed',
              response: JSON.stringify(ktuResult),
            });
          }
        }
      }

      // Pastikan terkirim juga ke Admin Utama (Kanwil dari .env)
      if (config.kanwil && config.kanwil.phone) {
        const cleanKanwilPhone = formatPhoneNumber(config.kanwil.phone);
        if (cleanKanwilPhone && !notifiedNumbers.has(cleanKanwilPhone)) {
          const kanwilMsg = renderTemplate('template_manual_resend', {
            ticketId: ticket.ticket_id,
            customer: ticket.customer,
            kantor: ticket.kantor_pertanahan,
            kategori: ticket.category,
            subjek: ticket.subject || ticket.category,
            tanggal: ticket.created_date || ticket.created_at,
            lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
            adminNama: 'Admin Utama (Kanwil)'
          });
          const kanwilResult = await sendPersonalMessage(cleanKanwilPhone, kanwilMsg);
          notifiedNumbers.add(cleanKanwilPhone);
          totalSent++;
          NotificationLogModel.create({
            ticketId: ticket.ticket_id,
            targetType: 'personal_manual_kanwil',
            targetName: 'Admin Utama (Kanwil)',
            targetNumber: cleanKanwilPhone,
            message: kanwilMsg,
            status: kanwilResult && kanwilResult.success ? 'sent' : 'failed',
            response: JSON.stringify(kanwilResult),
          });
        }
      }

      if (totalSent > 0) {
        res.json({ success: true, message: `Peringatan berhasil dikirim ke Admin tujuan (${ticket.kantor_pertanahan}) dan Admin Utama!` });
      } else {
        res.status(400).json({ success: false, error: `Belum ada admin atau nomor HP valid untuk kantor ${ticket.kantor_pertanahan}` });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Customizable Notification Templates
  // ============================================
  router.get('/templates', (req, res) => {
    try {
      const data = getAllTemplates();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/templates', (req, res) => {
    try {
      const templates = req.body || {};
      for (const [key, val] of Object.entries(templates)) {
        if (val !== undefined && val !== null) {
          ConfigModel.set(key, val.toString());
        }
      }
      res.json({ success: true, message: 'Template bahasa notifikasi berhasil diperbarui!' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Notification Logs
  // ============================================

  router.get('/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const logs = NotificationLogModel.getRecent(limit);
      res.json({ success: true, data: logs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Settings
  // ============================================

  router.post('/settings', (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) {
        return res.status(400).json({ success: false, error: 'Key is required' });
      }
      ConfigModel.set(key, String(value));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/settings', (req, res) => {
    try {
      const settings = ConfigModel.getAll();
      settings.wa_group_id = settings.wa_group_id || '';
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Test Notification
  // ============================================

  router.post('/test-notification', async (req, res) => {
    try {
      const { type, target } = req.body;
      const message = buildTestMessage();

      let result;
      if (type === 'group') {
        result = await sendGroupMessage(target || config.wa.groupName, message);
      } else if (type === 'personal') {
        if (!target) {
          return res.status(400).json({ success: false, error: 'Nomor HP tujuan diperlukan' });
        }
        result = await sendPersonalMessage(target, message);
      } else {
        return res.status(400).json({ success: false, error: 'Type harus "group" atau "personal"' });
      }

      // Log the test
      NotificationLogModel.create({
        ticketId: 'TEST',
        targetType: type,
        targetName: type === 'group' ? (target || config.wa.groupName) : 'Test',
        targetNumber: type === 'personal' ? target : '',
        message,
        status: result.success ? 'sent' : 'failed',
        response: JSON.stringify(result),
      });

      res.json({ success: result.success, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/test-kanwil', async (req, res) => {
    try {
      if (!config.kanwil.phone) {
        return res.status(400).json({ success: false, error: 'Nomor HP Admin Kanwil belum dikonfigurasi di .env (KANWIL_ADMIN_PHONE)' });
      }
      const message = `🔔 *TEST PING KANWIL*\n\nHalo ${config.kanwil.name || 'Admin Kanwil'},\nIni adalah pesan tes ping dari *Sistem Monitoring Humas Kanwil BPN Aceh*.\n\n_Jika pesan ini sampai, koneksi WhatsApp Bot untuk Admin Kanwil berfungsi normal._`;
      const result = await sendPersonalMessage(config.kanwil.phone, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/test-group', async (req, res) => {
    try {
      const waGroupId = ConfigModel.get('wa_group_id') || config.wa.groupName;
      if (!waGroupId) {
        return res.status(400).json({ success: false, error: 'ID atau Nama Group WhatsApp belum dikonfigurasi' });
      }
      const message = `🔔 *TEST PING GROUP*\n\nIni adalah pesan tes ping ke Group dari *Sistem Monitoring Humas Kanwil BPN Aceh*.\n\n_Jika pesan ini sampai, koneksi WhatsApp Bot ke group berfungsi normal._`;
      const result = await sendGroupMessage(waGroupId, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/settings/ping-holiday-group', async (req, res) => {
    try {
      const waGroupId = ConfigModel.get('holiday_wa_group_id');
      if (!waGroupId) {
        return res.status(400).json({ success: false, error: 'ID/Nama Group Hari Besar belum disetting di pengaturan.' });
      }
      const message = `🎉 *TEST PING HARI BESAR (GROUP)*\n\nIni adalah pesan tes ping ke Group Khusus Hari Besar.\n\n_Jika pesan ini sampai, konfigurasi notifikasi Hari Besar sudah berfungsi._`;
      const result = await sendGroupMessage(waGroupId, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/settings/ping-holiday-admin', async (req, res) => {
    try {
      const adminNumber = ConfigModel.get('holiday_admin_number');
      if (!adminNumber) {
        return res.status(400).json({ success: false, error: 'Nomor HP Admin Desain Hari Besar belum disetting di pengaturan.' });
      }
      const message = `🎉 *TEST PING HARI BESAR (ADMIN)*\n\nHalo Admin Desain,\nIni adalah pesan tes ping dari sistem *Pengingat Hari Besar*.\n\n_Jika pesan ini sampai, notifikasi japri Hari Besar siap digunakan._`;
      const result = await sendPersonalMessage(adminNumber, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/test-gowa', async (req, res) => {
    try {
      const { target } = req.body;
      if (!target) {
        return res.status(400).json({ success: false, error: 'Nomor HP tujuan diperlukan' });
      }
      const message = `🔔 *TEST PING GOWA FALLBACK*\n\nIni adalah pesan tes ping khusus menggunakan provider *GoWA*.\n\n_Pesan ini bisa sampai ke nomor yang belum pernah di-chat (cold number)._`;
      const result = await sendPersonalMessage(target, message, { forceProvider: 'gowa' });
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/force-check', async (req, res) => {
    try {
      if (typeof global.triggerManualScrape === 'function') {
        global.triggerManualScrape();
        res.json({ success: true, message: 'Pengecekan tiket & pengingat (reminder) sedang dijalankan di latar belakang!' });
      } else {
        res.status(503).json({ success: false, error: 'Sistem scraper belum siap' });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Auth & Interactive Login
  // ============================================

  // Check auth status
  router.get('/auth/status', async (req, res) => {
    try {
      const status = await getAuthStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start login
  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
      }
      const result = await startLoginInteractive(email, password);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Submit OTP
  router.post('/auth/otp', async (req, res) => {
    try {
      const { otp } = req.body;
      if (!otp) {
        return res.status(400).json({ success: false, error: 'OTP code required' });
      }
      const result = await submitOtpInteractive(otp);
      if (result.error) {
        return res.status(400).json({ success: false, error: result.error });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Level 6: Advanced SLA Analytics & Reports
  // ============================================

  router.get('/analytics/leaderboard', (req, res) => {
    try {
      const data = getSlaMetrics();
      res.json(data);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/analytics/report/html', (req, res) => {
    try {
      const html = generateHtmlReport();
      res.send(html);
    } catch (error) {
      res.status(500).send(`Error generating HTML report: ${error.message}`);
    }
  });

  router.get('/analytics/report/pdf', async (req, res) => {
    try {
      const result = await generatePdfReport();
      if (result.success && result.filePath) {
        res.download(result.filePath, 'Laporan_SLA_Pengawasan_BPN_Aceh.pdf');
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/analytics/report/csv', (req, res) => {
    try {
      const result = generateCsvReport();
      if (result.success) {
        res.header('Content-Type', 'text/csv');
        res.attachment('Laporan_SLA_Pengawasan_BPN_Aceh.csv');
        res.send(result.content);
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/analytics/report/send', async (req, res) => {
    try {
      const { phone } = req.body || {};
      const result = await sendExecutiveReportToKanwil(phone);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ==========================================
  // Web to WP Scraper Routes
  // ==========================================
  
  router.get('/web-articles', (req, res) => {
    try {
      const articles = WebArticleModel.getAll();
      res.json({ success: true, data: articles });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/web-scraper/fetch', async (req, res) => {
    try {
      const { fetchLatestLinks } = require('../scraper/web-scraper');
      // Async so we don't block
      fetchLatestLinks().catch(e => console.error(e));
      res.json({ success: true, message: 'Proses penarikan link sedang berjalan di latar belakang.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/web-scraper/post', async (req, res) => {
    try {
      const { postArticlesToWP } = require('../scraper/web-scraper');
      // Async so we don't block
      postArticlesToWP().catch(e => console.error(e));
      res.json({ success: true, message: 'Proses auto-post ke WordPress sedang berjalan di latar belakang.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/streamlit/status', async (req, res) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const testRes = await fetch('http://localhost:8501', { signal: controller.signal });
      clearTimeout(timeout);
      res.json({ success: true, running: testRes.ok || testRes.status < 500, url: 'http://localhost:8501' });
    } catch {
      res.json({ success: true, running: false, url: 'http://localhost:8501' });
    }
  });

  router.post('/streamlit/start', async (req, res) => {
    try {
      const path = require('path');
      const { spawn } = require('child_process');
      const streamlitBin = path.join(__dirname, '../../Website Scraping/venv/bin/streamlit');
      const workingDir = path.join(__dirname, '../../Website Scraping');
      
      const child = spawn(streamlitBin, ['run', 'app.py', '--server.port=8501', '--server.headless=true'], {
        cwd: workingDir,
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      res.json({ success: true, message: 'Server Streamlit berhasil dinyalakan di port 8501.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/ig-posts/batch-delete', async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal satu postingan untuk dihapus.' });
      }
      const { IgPostModel } = require('../database/models');
      const numIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
      IgPostModel.deleteMany(numIds);
      res.json({ success: true, message: `${numIds.length} postingan IG berhasil dihapus dari riwayat.` });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/ig-posts/:id', async (req, res) => {
    try {
      const { IgPostModel } = require('../database/models');
      IgPostModel.delete(parseInt(req.params.id));
      res.json({ success: true, message: 'Postingan IG berhasil dihapus dari riwayat.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/tickets/batch-delete', async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'Pilih minimal satu tiket untuk dihapus.' });
      }
      const { TicketModel } = require('../database/models');
      TicketModel.deleteMany(ids);
      res.json({ success: true, message: `${ids.length} tiket berhasil dihapus dari riwayat terpantau.` });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.delete('/tickets/:id', async (req, res) => {
    try {
      const { TicketModel } = require('../database/models');
      TicketModel.delete(req.params.id);
      res.json({ success: true, message: 'Tiket berhasil dihapus dari riwayat terpantau.' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createRoutes };
