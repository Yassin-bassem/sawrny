const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'public', 'output');
const ASSETS_DIR = path.join(__dirname, 'public', 'assets');
const DATA_FILE = path.join(__dirname, 'data_store.json');

[UPLOADS_DIR, OUTPUT_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `garment_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`);
  }
});
const upload = multer({ storage });

// In-Memory Data Store (Persisted to disk)
let dataStore = {
  logoPath: path.join(ASSETS_DIR, 'minime_logo_transparent.png'),
  batches: {}
};

if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    dataStore = { ...dataStore, ...JSON.parse(raw) };
  } catch (e) {
    console.error('Error loading data_store.json:', e.message);
  }
}

function saveDataStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataStore, null, 2));
  } catch (e) {
    console.error('Failed to save data_store:', e);
  }
}

// ----------------------------------------------------
// TELEGRAM BOT SETUP
// ----------------------------------------------------
let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot is running...');

    // User session photos buffer
    const userSessions = {};

    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;

      if (msg.text === '/start') {
        return bot.sendMessage(chatId, 
          `🌸 *Welcome to Sawrny Studio (صورني)!* 🌸\n\n` +
          `Send me photos of your children's wear collection (one or multiple images).\n` +
          `I will prepare a batch for you and send you a link to quickly configure age, product codes, and generate professional photoshoot images!`,
          { parse_mode: 'Markdown' }
        );
      }

      if (msg.photo) {
        if (!userSessions[chatId]) {
          const batchId = `BATCH-${Math.floor(100000 + Math.random() * 900000)}`;
          userSessions[chatId] = {
            batchId,
            chatId,
            items: [],
            timer: null
          };
        }

        const session = userSessions[chatId];
        const photo = msg.photo[msg.photo.length - 1]; // highest resolution
        const fileLink = await bot.getFileLink(photo.file_id);

        // Download photo
        const fileName = `garment_tg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}.jpg`;
        const filePath = path.join(UPLOADS_DIR, fileName);

        const response = await fetch(fileLink);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

        session.items.push({
          id: `item_${Date.now()}_${session.items.length + 1}`,
          filename: fileName,
          originalUrl: `/uploads/${fileName}`,
          ageGroup: 'Kids (4-6 yrs)',
          gender: 'Unisex',
          productCode: `MM-${100 + session.items.length + 1}`,
          campaignMode: 'model'
        });

        // Clear existing timer and set a 3-second buffer to collect batch photos
        if (session.timer) clearTimeout(session.timer);

        session.timer = setTimeout(() => {
          // Finalize batch
          const batchId = session.batchId;
          dataStore.batches[batchId] = {
            id: batchId,
            chatId,
            createdAt: new Date().toISOString(),
            logoPosition: 'top-right',
            items: session.items
          };
          saveDataStore();

          const baseUrl = process.env.PUBLIC_URL || 'https://sawrny.pages.dev';
          const webAppUrl = `${baseUrl}/#batch/${batchId}`;
          bot.sendMessage(chatId,
            `📸 *Received ${session.items.length} garment photos for Batch #${batchId}!*\n\n` +
            `👉 *Click here to open your Sawrny Mobile Dashboard:*\n${webAppUrl}`,
            { parse_mode: 'Markdown' }
          );

          delete userSessions[chatId];
        }, 3000);
      }
    });

  } catch (err) {
    console.error('Failed to start Telegram bot:', err.message);
  }
}

// ----------------------------------------------------
// WATERMARKING & BRANDING ENGINE (SHARP)
// ----------------------------------------------------
async function applyBrandingOverlay(baseImagePath, logoPath, productCode, logoPosition = 'top-right') {
  try {
    const base = sharp(baseImagePath);
    const metadata = await base.metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    const compositeOps = [];

    // 1. Process Logo Overlay
    if (fs.existsSync(logoPath)) {
      const logoWidth = Math.round(width * 0.22); // 22% of image width
      const logoMargin = Math.round(width * 0.04); // 4% margin

      const resizedLogoBuffer = await sharp(logoPath)
        .resize({ width: logoWidth, fit: 'contain' })
        .toBuffer();

      const logoMeta = await sharp(resizedLogoBuffer).metadata();
      const logoHeight = logoMeta.height || logoWidth;

      let left = width - logoWidth - logoMargin;
      let top = logoMargin;

      if (logoPosition === 'top-left') {
        left = logoMargin;
        top = logoMargin;
      } else if (logoPosition === 'bottom-right') {
        left = width - logoWidth - logoMargin;
        top = height - logoHeight - logoMargin - 70; // above product code
      } else if (logoPosition === 'bottom-left') {
        left = logoMargin;
        top = height - logoHeight - logoMargin - 70;
      }

      compositeOps.push({
        input: resizedLogoBuffer,
        top: Math.max(0, top),
        left: Math.max(0, left)
      });
    }

    // 2. Process Product Code Tag Overlay (SVG Canvas) - Dynamic Width Fix for long codes (e.g. 102011)
    if (productCode && productCode.trim()) {
      const rawCode = productCode.trim().toUpperCase();
      const fullText = rawCode.startsWith('CODE:') ? rawCode : `CODE: ${rawCode}`;
      const fontSize = Math.max(16, Math.round(width * 0.032));
      const badgePaddingX = 24;
      const badgePaddingY = 12;
      
      // Calculate exact badge width dynamically based on full text length
      const badgeW = Math.max(200, Math.round(fullText.length * fontSize * 0.68 + badgePaddingX * 2));
      const badgeH = Math.round(fontSize + badgePaddingY * 2 + 6);

      const svgBadge = `
        <svg width="${badgeW}" height="${badgeH}">
          <rect x="0" y="0" width="${badgeW}" height="${badgeH}" rx="10" ry="10" fill="#0D1117" fill-opacity="0.88" stroke="#00D2C8" stroke-width="2"/>
          <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="bold" letter-spacing="1.2">
            ${fullText}
          </text>
        </svg>
      `;

      const badgeMargin = Math.round(width * 0.04);
      compositeOps.push({
        input: Buffer.from(svgBadge),
        top: height - badgeH - badgeMargin,
        left: width - badgeW - badgeMargin
      });
    }

    const outputBuffer = await base.composite(compositeOps).toBuffer();
    return outputBuffer;
  } catch (err) {
    console.error('Error applying branding overlay:', err);
    return fs.readFileSync(baseImagePath);
  }
}

// ----------------------------------------------------
// AI PHOTOSHOOT GENERATION CONTROLLER
// ----------------------------------------------------
async function generateGarmentPhotoshoot(item, logoPath, logoPosition, isCampaignExtra = false, backgroundStyle = 'white') {
  const originalPath = path.join(UPLOADS_DIR, item.filename);
  let resultFilename = `output_${item.id}_${Date.now()}.jpg`;
  let resultPath = path.join(OUTPUT_DIR, resultFilename);

  try {
    let garmentDescription = "children clothing item";
    const apiKey = process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey });

    // Read original garment image bytes
    const imageBytes = fs.readFileSync(originalPath);
    const b64Garment = imageBytes.toString('base64');
    const imagePart = {
      inlineData: {
        data: b64Garment,
        mimeType: 'image/jpeg'
      }
    };

    // 1. Gemini Vision Analysis for detailed garment context
    try {
      const promptText = `Analyze this children's apparel photo. Describe:
1. Garment type & style (hooded cape, jogger pants, pajama set, onesie, jacket).
2. Primary colors & patterns.
3. Specific graphics & prints.
4. Fabric texture and details.
Provide a concise 2-sentence description for fashion photoshoot prompt.`;

      const visionResult = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            parts: [
              { text: promptText },
              imagePart
            ]
          }
        ]
      });

      if (visionResult.candidates && visionResult.candidates[0].content && visionResult.candidates[0].content.parts) {
        garmentDescription = visionResult.candidates[0].content.parts[0].text.replace(/\n/g, ' ').trim();
      }
      console.log(`[Paid Gemini Vision Analysis for ${item.productCode}]:`, garmentDescription);
    } catch (ve) {
      console.error('Vision analysis error:', ve.message);
    }

    // 2. Determine Background Scene Backdrop Prompt
    let bgPrompt = "standing upright on a clean high-key minimalist white studio wooden floor with soft daylight studio lighting";
    if (backgroundStyle === 'campaign') {
      bgPrompt = "standing in a cozy aesthetic nursery room with soft pastel backdrop walls, warm sunlight, eucalyptus greenery, and wooden decor, high-end children apparel collection drop campaign";
    } else if (backgroundStyle === 'outdoor') {
      bgPrompt = "standing in a sunny lush garden with warm golden hour light and soft greenery background bokeh, outdoor children apparel collection drop campaign";
    }

    // 3. Synthesize Multimodal Image-to-Image Try-On Prompt with Strict Child Model Mandate
    const genderTerm = item.gender === 'Girl' ? 'cute young girl model' : item.gender === 'Boy' ? 'cute young boy model' : 'cute child model';
    const ageDetail = item.ageGroup || '2-5 years old';

    const promptTextForGen = `A full-body commercial catalog photograph of a happy ${genderTerm} (${ageDetail}) ${bgPrompt}, actively WEARING THIS EXACT children apparel item on their body: ${garmentDescription}. CRITICAL MANDATE: The photo MUST feature a real human child model wearing the garment on their body. DO NOT generate hangers, wall shelves, wooden pegs, mannequins, or empty clothing displays. Show a real smiling child model wearing the outfit. Authentic camera photography, 8k resolution commercial kids clothing catalog.`;

    console.log(`[Official Multimodal Gemini Image API Prompt for ${item.productCode} (${backgroundStyle})]:`, promptTextForGen);

    // 4. Official Google Gemini Multimodal Image-to-Image Try-On API Call
    const imageRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [
        {
          parts: [
            { text: promptTextForGen },
            imagePart
          ]
        }
      ]
    });

    const tempGenPath = path.join(OUTPUT_DIR, `raw_${resultFilename}`);
    let gotImage = false;

    if (imageRes.candidates && imageRes.candidates[0].content && imageRes.candidates[0].content.parts) {
      for (const p of imageRes.candidates[0].content.parts) {
        if (p.inlineData) {
          fs.writeFileSync(tempGenPath, Buffer.from(p.inlineData.data, 'base64'));
          gotImage = true;
          break;
        }
      }
    }

    if (!gotImage) {
      throw new Error("No image returned from Google Gemini API");
    }

    // 5. Apply Transparent Mini Me Logo & Product Code Badge Overlay
    const finalBuffer = await applyBrandingOverlay(tempGenPath, logoPath, item.productCode, logoPosition);
    fs.writeFileSync(resultPath, finalBuffer);

    // Clean temp
    if (fs.existsSync(tempGenPath)) fs.unlinkSync(tempGenPath);

    return `/output/${resultFilename}`;
  } catch (err) {
    console.error(`Official Gemini AI Generation Error for ${item.productCode}:`, err.message);
    const brandedBuffer = await applyBrandingOverlay(originalPath, logoPath, item.productCode, logoPosition);
    fs.writeFileSync(resultPath, brandedBuffer);
    return `/output/${resultFilename}`;
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// Upload Collection Photos
app.post('/api/upload-collection', upload.array('photos', 20), (req, res) => {
  const batchId = `BATCH-${Math.floor(100000 + Math.random() * 900000)}`;
  const files = req.files || [];

  const items = files.map((file, idx) => ({
    id: `item_${Date.now()}_${idx + 1}`,
    filename: file.filename,
    originalUrl: `/uploads/${file.filename}`,
    ageGroup: 'Kids (4-6 yrs)',
    gender: 'Unisex',
    productCode: `MM-${100 + idx + 1}`,
    campaignMode: 'model'
  }));

  dataStore.batches[batchId] = {
    id: batchId,
    createdAt: new Date().toISOString(),
    logoPosition: 'top-right',
    items
  };
  saveDataStore();

  res.json({ success: true, batchId, itemsCount: items.length });
});

// Upload Brand Logo
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  if (req.file) {
    // Process logo to ensure transparency if needed
    const destPath = path.join(ASSETS_DIR, 'custom_logo_transparent.png');
    fs.copyFileSync(req.file.path, destPath);
    dataStore.logoPath = destPath;
    saveDataStore();
    return res.json({ success: true, logoUrl: '/assets/custom_logo_transparent.png' });
  }
  res.status(400).json({ error: 'No logo file provided' });
});

// Get Batch Details
app.get('/api/batches/:batchId', (req, res) => {
  const batch = dataStore.batches[req.params.batchId];
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

// Update Batch Item Settings
app.post('/api/batches/:batchId/update', (req, res) => {
  const batch = dataStore.batches[req.params.batchId];
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const { items, logoPosition } = req.body;
  if (items) batch.items = items;
  if (logoPosition) batch.logoPosition = logoPosition;

  saveDataStore();
  res.json({ success: true, batch });
});

// Generate All Photos in Batch
app.post('/api/batches/:batchId/generate', async (req, res) => {
  let batch = dataStore.batches[req.params.batchId];
  
  if (!batch && req.params.batchId === 'DEMO') {
    batch = {
      id: 'DEMO',
      createdAt: new Date().toISOString(),
      logoPosition: 'top-right',
      items: [
        {
          id: 'sample_1',
          filename: 'sample_jacket.jpg',
          originalUrl: '/assets/sample_jacket.jpg',
          ageGroup: 'Baby (0-1 yr)',
          gender: 'Girl',
          productCode: 'MM-801',
          campaignMode: 'model'
        },
        {
          id: 'sample_2',
          filename: 'sample_set.jpg',
          originalUrl: '/assets/sample_set.jpg',
          ageGroup: 'Kids (4-6 yrs)',
          gender: 'Unisex',
          productCode: 'MM-802',
          campaignMode: 'model'
        }
      ]
    };
    dataStore.batches['DEMO'] = batch;
  }

  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const { isCampaignExtra, backgroundStyle } = req.body;
  const logoPath = dataStore.logoPath;

  console.log(`🚀 Starting generation for Batch #${batch.id}...`);

  const results = [];
  for (let i = 0; i < batch.items.length; i++) {
    const item = batch.items[i];
    console.log(`Processing item ${i + 1}/${batch.items.length} [Code: ${item.productCode}]...`);
    const outputUrl = await generateGarmentPhotoshoot(item, logoPath, batch.logoPosition, isCampaignExtra, backgroundStyle || batch.backgroundStyle || 'white');
    item.resultUrl = outputUrl;
    results.push({ ...item, resultUrl: outputUrl });
  }

  batch.completedAt = new Date().toISOString();
  saveDataStore();

  // If created via Telegram, push final images back to chat
  if (batch.chatId && bot) {
    try {
      bot.sendMessage(batch.chatId, `🎉 *Batch #${batch.id} Finished Processing!* Sending your high-res photos:`, { parse_mode: 'Markdown' });
      for (const item of batch.items) {
        if (item.resultUrl) {
          const imgPath = path.join(__dirname, 'public', item.resultUrl);
          if (fs.existsSync(imgPath)) {
            await bot.sendPhoto(batch.chatId, imgPath, {
              caption: `✨ *Product Code:* ${item.productCode}\n👶 *Age:* ${item.ageGroup} | *Gender:* ${item.gender}`
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to send photos to Telegram:', e.message);
    }
  }

  res.json({ success: true, results });
});

// Get Config Status
app.get('/api/config-status', (req, res) => {
  res.json({
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('YOUR_')),
    hasTelegramBot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    logoUrl: '/assets/minime_logo_transparent.png'
  });
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🌟 SAWNY KIDS AI STUDIO (صورني) SERVER IS RUNNING 🌟`);
  console.log(`👉 Access Web Dashboard: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
