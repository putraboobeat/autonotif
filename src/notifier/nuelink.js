const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { ConfigModel, NotificationLogModel } = require('../database/models');
const { sleep } = require('../utils/helpers');

const log = createLogger('NUELINK');

const NUELINK_BASE_URL = 'https://nuelink.com/api/public/v1';

/**
 * Retrieve active Nuelink configuration from Database or fallback to .env/config
 */
function getNuelinkConfig() {
  let enabled = '1';
  let apiKey = '';
  let brandId = '33800';
  let collectionId = '98435';
  let publishMode = 'QUEUE';
  let reelsOnly = '1';
  let targetAccounts = 'kementerian.atrbpn,kementerian_atrbpn';

  try {
    const dbEnabled = ConfigModel.get('nuelink_enabled');
    if (dbEnabled !== undefined && dbEnabled !== null) enabled = dbEnabled;

    const dbApiKey = ConfigModel.get('nuelink_api_key');
    if (dbApiKey) apiKey = dbApiKey;

    const dbBrandId = ConfigModel.get('nuelink_brand_id');
    if (dbBrandId) brandId = dbBrandId;

    const dbCollectionId = ConfigModel.get('nuelink_collection_id');
    if (dbCollectionId) collectionId = dbCollectionId;

    const dbPublishMode = ConfigModel.get('nuelink_publish_mode');
    if (dbPublishMode) publishMode = dbPublishMode;

    const dbReelsOnly = ConfigModel.get('nuelink_reels_only');
    if (dbReelsOnly !== undefined && dbReelsOnly !== null) reelsOnly = dbReelsOnly;

    const dbTarget = ConfigModel.get('nuelink_target_accounts');
    if (dbTarget !== undefined && dbTarget !== null) targetAccounts = dbTarget;
  } catch (err) {
    log.debug(`Failed reading Nuelink config from DB: ${err.message}`);
  }

  // Fallback to process.env or config
  if (!apiKey) {
    apiKey = process.env.NUELINK_API_KEY || config.nuelink?.apiKey || '';
  }
  if (!brandId) {
    brandId = process.env.NUELINK_BRAND_ID || config.nuelink?.brandId || '33800';
  }
  if (!collectionId) {
    collectionId = process.env.NUELINK_COLLECTION_ID || config.nuelink?.collectionId || '98435';
  }
  if (!publishMode) {
    publishMode = process.env.NUELINK_PUBLISH_MODE || config.nuelink?.publishMode || 'QUEUE';
  }

  return {
    enabled: enabled === '1' || enabled === 'true' || enabled === true,
    apiKey: apiKey.trim(),
    brandId: parseInt(brandId, 10) || 33800,
    collectionId: parseInt(collectionId, 10) || 98435,
    publishMode: (publishMode || 'QUEUE').toUpperCase(), // QUEUE, IMMEDIATE, DRAFT, SCHEDULE
    reelsOnly: reelsOnly === '1' || reelsOnly === 'true' || reelsOnly === true,
    targetAccounts: targetAccounts.split(',').map(a => a.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
  };
}

/**
 * Upload binary buffer directly to Nuelink Media Library
 */
async function uploadMediaBuffer(buffer, filename, mimeType, cfg = null) {
  const currentConfig = cfg || getNuelinkConfig();
  if (!currentConfig.apiKey) {
    throw new Error('Nuelink API key is not configured');
  }

  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('media', blob, filename);

  const url = `${NUELINK_BASE_URL}/brands/${currentConfig.brandId}/media`;
  log.info(`Uploading media to Nuelink: ${filename} (${buffer.length} bytes, ${mimeType})...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentConfig.apiKey}`,
      'Accept': 'application/json',
    },
    body: form,
  });

  const resJson = await response.json();
  if (!response.ok || resJson.status !== 'success') {
    const errorMsg = resJson.message || JSON.stringify(resJson.errors) || `HTTP ${response.status}`;
    throw new Error(`Nuelink media upload failed: ${errorMsg}`);
  }

  log.info(`✅ Nuelink media uploaded successfully: ID = ${resJson.data?.id}`);
  return resJson.data?.id;
}

/**
 * Download media from URL (with IG-compatible headers) and upload to Nuelink
 */
async function downloadAndUploadMedia(mediaUrl, defaultFilename = 'media.mp4', defaultMime = 'video/mp4', cfg = null) {
  try {
    log.info(`Downloading media stream from URL: ${mediaUrl.substring(0, 80)}...`);
    const res = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.instagram.com/',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch media file from source: HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || defaultMime;
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    if (buffer.length < 100) {
      throw new Error('Downloaded media buffer is too small or invalid');
    }

    let filename = defaultFilename;
    if (contentType.includes('image/jpeg')) filename = 'slide.jpg';
    else if (contentType.includes('image/png')) filename = 'slide.png';
    else if (contentType.includes('video/mp4')) filename = 'reel.mp4';

    return await uploadMediaBuffer(buffer, filename, contentType, cfg);
  } catch (err) {
    log.warn(`Could not download & upload media directly: ${err.message}`);
    return null;
  }
}

/**
 * Check if an IG post is eligible to be forwarded to Nuelink
 */
function isEligibleForNuelink(post, username = '') {
  const cfg = getNuelinkConfig();
  if (!cfg.enabled) {
    log.debug('Nuelink auto-repost is disabled.');
    return { eligible: false, reason: 'Nuelink is disabled' };
  }

  if (!cfg.apiKey) {
    return { eligible: false, reason: 'Nuelink API Key is missing' };
  }

  const cleanUser = (username || post.account_username || '').toLowerCase().replace(/^@/, '').trim();

  // Check username match
  if (cfg.targetAccounts.length > 0 && !cfg.targetAccounts.includes('*')) {
    const isMatched = cfg.targetAccounts.some(target => {
      const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanInput = cleanUser.replace(/[^a-z0-9]/g, '');
      return cleanTarget === cleanInput || cleanInput.includes(cleanTarget) || cleanTarget.includes(cleanInput);
    });

    if (!isMatched) {
      return {
        eligible: false,
        reason: `Account @${cleanUser} does not match Nuelink target accounts [${cfg.targetAccounts.join(', ')}]`,
      };
    }
  }

  // Check reels only requirement
  const isVideo = Boolean(
    post.videoUrl || 
    post.video_url || 
    (post.link && post.link.includes('/reel/')) || 
    post.category === 'reels'
  );
  if (cfg.reelsOnly && !isVideo) {
    return { eligible: false, reason: 'Post is not a Reel / Video (reels_only is active)' };
  }

  return { eligible: true, config: cfg };
}

/**
 * Create a Post on Nuelink Collection (e.g. "Repost")
 */
async function postToNuelink(postData) {
  const cfg = getNuelinkConfig();
  if (!cfg.apiKey) {
    throw new Error('Nuelink API Key belum diatur di .env atau Pengaturan.');
  }

  const {
    caption = '',
    videoUrl = '',
    imageUrl = '',
    link = '',
    username = '',
    shortcode = '',
    publishMode = cfg.publishMode,
  } = postData;

  // Safety guard: if reelsOnly is active, reject non-video/reels posts
  const isVideo = Boolean(videoUrl || (link && link.includes('/reel/')));
  if (cfg.reelsOnly && !isVideo) {
    log.info(`[NUELINK] Skipped post ${shortcode}: Post is not a Reel/Video and reelsOnly is active.`);
    throw new Error('Nuelink saat ini dikonfigurasi khusus Reels. Postingan foto/feed tidak dikirim.');
  }

  log.info(`[NUELINK] Preparing to post IG ${shortcode || 'content'} from @${username} to Collection ${cfg.collectionId}...`);

  // Build clean caption for social repost
  let postCaption = caption || '';
  // Clean placeholder text
  postCaption = postCaption.replace(/^📸\s*\*POSTINGAN TERBARU INSTAGRAM\*[\s\S]*?\n\n/i, '');
  postCaption = postCaption.replace(/^🎬\s*\*REELS \/ VIDEO TERBARU INSTAGRAM\*[\s\S]*?\n\n/i, '');

  // Truncate caption if too long (max 3000 chars per Nuelink specs)
  if (postCaption.length > 2800) {
    postCaption = postCaption.substring(0, 2800) + '...';
  }
  if (!postCaption.trim()) {
    postCaption = `Repost from @${username || 'kementerian.atrbpn'} on Instagram: ${link || ''}`.trim();
  }

  // Media processing
  const mediaItems = [];
  let mediaId = null;

  if (videoUrl) {
    // 1. Try uploading video buffer directly to Nuelink Media Library
    try {
      mediaId = await downloadAndUploadMedia(videoUrl, `reel_${shortcode || Date.now()}.mp4`, 'video/mp4', cfg);
    } catch (e) {
      log.warn(`Failed direct buffer upload for video: ${e.message}`);
    }

    if (mediaId) {
      mediaItems.push({ id: mediaId });
    } else if (videoUrl.startsWith('http')) {
      // Fallback: pass direct video URL
      mediaItems.push({ url: videoUrl });
    }
  } else if (imageUrl) {
    // 1. Try uploading image buffer directly
    try {
      mediaId = await downloadAndUploadMedia(imageUrl, `image_${shortcode || Date.now()}.jpg`, 'image/jpeg', cfg);
    } catch (e) {
      log.warn(`Failed direct buffer upload for image: ${e.message}`);
    }

    if (mediaId) {
      mediaItems.push({ id: mediaId });
    } else if (imageUrl.startsWith('http')) {
      mediaItems.push({ url: imageUrl });
    }
  }

  const payload = {
    publishMode: publishMode || 'QUEUE',
    caption: postCaption,
  };

  if (mediaItems.length > 0) {
    payload.media = mediaItems;
  }

  const endpoint = `${NUELINK_BASE_URL}/brands/${cfg.brandId}/collections/${cfg.collectionId}/posts`;
  log.info(`[NUELINK] Sending request to POST ${endpoint}... (publishMode: ${payload.publishMode}, media: ${mediaItems.length})`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const resJson = await response.json();
  log.info(`[NUELINK] Response status ${response.status}:`, resJson);

  if (!response.ok || resJson.status !== 'success') {
    const errorMsg = resJson.message || JSON.stringify(resJson.errors) || `HTTP ${response.status}`;
    const err = new Error(`Nuelink post creation failed: ${errorMsg}`);
    err.details = resJson;
    throw err;
  }

  const result = {
    success: true,
    postId: resJson.data?.id,
    message: resJson.data?.message || 'Post created successfully in Nuelink',
    collectionId: cfg.collectionId,
    brandId: cfg.brandId,
    publishMode: payload.publishMode,
  };

  // Log to NotificationLogModel for dashboard auditing
  try {
    NotificationLogModel.create({
      ticketId: `NUELINK-${shortcode || Date.now()}`,
      targetType: 'nuelink',
      targetName: `Collection: Repost (ID: ${cfg.collectionId})`,
      targetNumber: `@${username || 'kementerian.atrbpn'}`,
      message: `[NUELINK ${payload.publishMode}] ${postCaption.substring(0, 100)}...`,
      status: 'sent',
      response: JSON.stringify(result),
    });
  } catch (logErr) {
    log.debug(`Failed saving Nuelink notification log: ${logErr.message}`);
  }

  return result;
}

/**
 * Test Nuelink API Key, retrieve Brands and Collections list
 */
async function testNuelinkConnection(customApiKey = null) {
  const apiKey = (customApiKey || getNuelinkConfig().apiKey || '').trim();
  if (!apiKey) {
    return { success: false, error: 'API Key kosong.' };
  }

  try {
    // 1. Get Brands
    const brandRes = await fetch(`${NUELINK_BASE_URL}/brands`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!brandRes.ok) {
      return { success: false, error: `Gagal otentikasi Nuelink (HTTP ${brandRes.status}). Pastikan API Key benar.` };
    }

    const brandData = await brandRes.json();
    const brands = brandData.data || [];

    if (brands.length === 0) {
      return { success: false, error: 'Tidak ditemukan Brand di akun Nuelink ini.' };
    }

    const activeBrand = brands[0];

    // 2. Get Collections
    const colRes = await fetch(`${NUELINK_BASE_URL}/brands/${activeBrand.id}/collections`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    const colData = await colRes.json();
    const collections = colData.data || [];

    return {
      success: true,
      brand: activeBrand,
      collections: collections.map(c => ({
        id: c.id,
        title: c.title,
        channelsCount: c.channels?.length || 0,
        channels: (c.channels || []).map(ch => `${ch.type}: ${ch.name}`),
      })),
    };
  } catch (err) {
    return { success: false, error: `Koneksi gagal: ${err.message}` };
  }
}

module.exports = {
  getNuelinkConfig,
  isEligibleForNuelink,
  postToNuelink,
  uploadMediaBuffer,
  downloadAndUploadMedia,
  testNuelinkConnection,
};
