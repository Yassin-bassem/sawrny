document.addEventListener('DOMContentLoaded', () => {
  
  // Relative API Base URL for Cloudflare Functions & Local server
  const API_BASE = '';

  // App State
  let currentBatch = {
    id: null,
    logoPosition: 'top-right',
    items: []
  };

  const sampleItems = [
    {
      id: 'sample_1',
      filename: 'sample_jacket.jpg',
      originalUrl: '/assets/sample_jacket.jpg',
      ageGroup: 'Baby (0-1 yr)',
      gender: 'Girl',
      productCode: 'MM-801',
      campaignMode: 'model',
      designPosition: 'front'
    },
    {
      id: 'sample_2',
      filename: 'sample_set.jpg',
      originalUrl: '/assets/sample_set.jpg',
      ageGroup: 'Kids (4-6 yrs)',
      gender: 'Unisex',
      productCode: 'MM-802',
      campaignMode: 'model',
      designPosition: 'front'
    }
  ];

  // DOM Elements
  const navLogo = document.getElementById('nav-logo');
  const brandLogoPreview = document.getElementById('brand-logo-preview');
  const logoUploadInput = document.getElementById('logo-upload-input');
  const garmentUploadInput = document.getElementById('garment-upload-input');
  const itemsContainer = document.getElementById('items-container');
  const emptyState = document.getElementById('empty-state');
  const batchHeading = document.getElementById('batch-heading');
  const batchSubheading = document.getElementById('batch-subheading');
  const btnLoadDemo = document.getElementById('btn-load-demo');
  const btnAutoSku = document.getElementById('btn-auto-sku');
  const btnGenerateAll = document.getElementById('btn-generate-all');
  const campaignExtraToggle = document.getElementById('campaign-extra-toggle');
  
  // Modals
  const progressModal = document.getElementById('progress-modal');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStatusText = document.getElementById('progress-status-text');
  const galleryModal = document.getElementById('gallery-modal');
  const galleryGrid = document.getElementById('gallery-grid');
  const btnCloseGallery = document.getElementById('btn-close-gallery');
  const btnDownloadAll = document.getElementById('btn-download-all');

  // Status Indicators
  const geminiStatus = document.getElementById('gemini-status');
  const telegramStatus = document.getElementById('telegram-status');

  // 1. Fetch Config Status
  async function checkConfigStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/config-status`);
      const data = await res.json();
      
      if (data.hasGeminiKey) {
        geminiStatus.classList.remove('offline');
        geminiStatus.classList.add('online');
        geminiStatus.title = "Gemini AI API Key Connected";
      }
      if (data.hasTelegramBot) {
        telegramStatus.classList.remove('offline');
        telegramStatus.classList.add('online');
        telegramStatus.title = "Telegram Bot Active";
      }
    } catch (e) {
      console.warn('Could not fetch config status:', e);
    }
  }
  checkConfigStatus();

  // 2. Hash Routing for Batch Loading (e.g. #batch/BATCH-1234)
  async function handleHashRoute() {
    const hash = window.location.hash;
    if (hash.startsWith('#batch/')) {
      const batchId = hash.split('/')[1];
      await loadBatch(batchId);
    } else {
      // Default to demo samples if empty
      loadDemoData();
    }
  }

  async function loadBatch(batchId) {
    try {
      const res = await fetch(`${API_BASE}/api/batches/${batchId}`);
      if (res.ok) {
        const batch = await res.json();
        currentBatch = batch;
        batchHeading.textContent = `Batch #${batch.id}`;
        batchSubheading.textContent = `${batch.items.length} Collection Photos Loaded`;
        renderItems();
      } else {
        loadDemoData();
      }
    } catch (e) {
      console.error('Error loading batch:', e);
      loadDemoData();
    }
  }

  function loadDemoData() {
    currentBatch = {
      id: 'DEMO-' + Math.floor(1000 + Math.random() * 9000),
      logoPosition: 'top-right',
      items: JSON.parse(JSON.stringify(sampleItems))
    };
    batchHeading.textContent = `Sample Collection Demo`;
    batchSubheading.textContent = `2 Factory Sample Items Loaded (Click 'Generate All' to test)`;
    renderItems();
  }

  // 3. Logo Position Buttons
  document.querySelectorAll('.pos-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.pos-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentBatch.logoPosition = btn.dataset.pos;
      renderItems(); // Re-render preview overlays
    });
  });

  // 4. Logo Upload Handler
  logoUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
      const res = await fetch(`${API_BASE}/api/upload-logo`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        brandLogoPreview.src = data.logoUrl + '?t=' + Date.now();
        navLogo.src = data.logoUrl + '?t=' + Date.now();
        renderItems();
      }
    } catch (err) {
      alert('Failed to upload logo: ' + err.message);
    }
  });

  // 5. Garment Photos Upload Handler
  garmentUploadInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('photos', files[i]);
    }

    try {
      const res = await fetch(`${API_BASE}/api/upload-collection`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        window.location.hash = `#batch/${data.batchId}`;
        await loadBatch(data.batchId);
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
  });

  btnLoadDemo.addEventListener('click', () => {
    window.location.hash = '';
    loadDemoData();
  });

  // 6. Auto-Assign SKUs
  btnAutoSku.addEventListener('click', () => {
    currentBatch.items.forEach((item, idx) => {
      item.productCode = `MM-${801 + idx}`;
    });
    renderItems();
  });

  // 7. Render Items Cards Matrix
  function renderItems() {
    itemsContainer.innerHTML = '';

    if (!currentBatch.items || currentBatch.items.length === 0) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    currentBatch.items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'card glass-card item-card';

      // Logo overlay positioning calculation for live preview
      let logoPosStyle = 'top:12px; right:12px;';
      if (currentBatch.logoPosition === 'top-left') logoPosStyle = 'top:12px; left:12px;';
      if (currentBatch.logoPosition === 'bottom-right') logoPosStyle = 'bottom:45px; right:12px;';
      if (currentBatch.logoPosition === 'bottom-left') logoPosStyle = 'bottom:45px; left:12px;';

      const isBack = item.designPosition === 'back';

      card.innerHTML = `
        <div class="item-photo-wrapper">
          <img src="${item.originalUrl}" alt="Garment Photo">
          <img src="${brandLogoPreview.src}" class="watermark-badge-preview" style="${logoPosStyle}" alt="Watermark Badge">
          ${isBack ? '<div class="back-design-badge">🔄 Back Design</div>' : ''}
          <div class="code-overlay-badge">CODE: ${item.productCode || 'MM-' + (index + 1)}</div>
        </div>

        <div class="item-control-group">
          <label class="input-label">Product SKU / Code</label>
          <input type="text" class="sku-input" value="${item.productCode || ''}" data-idx="${index}" placeholder="e.g. MM-801">
        </div>

        <div class="item-control-group">
          <label class="input-label">Child Model Age</label>
          <div class="pill-group">
            ${['Baby (0-1 yr)', 'Toddler (2-3 yrs)', 'Kids (4-6 yrs)', 'Kids (7-10 yrs)'].map(age => `
              <button type="button" class="pill-btn age-pill ${item.ageGroup === age ? 'active' : ''}" data-idx="${index}" data-val="${age}">${age}</button>
            `).join('')}
          </div>
        </div>

        <div class="item-control-group">
          <label class="input-label">Gender Category</label>
          <div class="pill-group">
            ${[
              { label: 'Girl 👧', val: 'Girl' },
              { label: 'Boy 👦', val: 'Boy' },
              { label: 'Unisex 👶', val: 'Unisex' }
            ].map(g => `
              <button type="button" class="pill-btn gender-pill ${item.gender === g.val ? 'active' : ''}" data-idx="${index}" data-val="${g.val}">${g.label}</button>
            `).join('')}
          </div>
        </div>

        <div class="item-control-group">
          <label class="input-label">Artwork / Design Position</label>
          <div class="pill-group">
            ${[
              { label: '👕 Front (Default)', val: 'front' },
              { label: '🔄 Back of Child (Rear)', val: 'back' }
            ].map(d => `
              <button type="button" class="pill-btn design-pill ${(item.designPosition === d.val || (!item.designPosition && d.val === 'front')) ? 'active' : ''}" data-idx="${index}" data-val="${d.val}">${d.label}</button>
            `).join('')}
          </div>
        </div>

        <div class="item-control-group">
          <label class="input-label">Photoshoot Mode</label>
          <div class="pill-group">
            ${[
              { label: '👦 Model Wear', val: 'model' },
              { label: '📸 Studio Flatlay', val: 'studio' },
              { label: '👨‍👩‍👧 Group Photo', val: 'group' }
            ].map(m => `
              <button type="button" class="pill-btn mode-pill ${item.campaignMode === m.val ? 'active' : ''}" data-idx="${index}" data-val="${m.val}">${m.label}</button>
            `).join('')}
          </div>
        </div>
      `;

      itemsContainer.appendChild(card);
    });

    // Attach Event Listeners to inputs inside cards
    document.querySelectorAll('.sku-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = e.target.dataset.idx;
        currentBatch.items[idx].productCode = e.target.value.toUpperCase();
        // Update badge text
        const card = e.target.closest('.item-card');
        card.querySelector('.code-overlay-badge').textContent = `CODE: ${e.target.value.toUpperCase() || 'MM'}`;
      });
    });

    document.querySelectorAll('.age-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.dataset.idx;
        currentBatch.items[idx].ageGroup = btn.dataset.val;
        renderItems();
      });
    });

    document.querySelectorAll('.gender-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.dataset.idx;
        currentBatch.items[idx].gender = btn.dataset.val;
        renderItems();
      });
    });

    document.querySelectorAll('.design-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.dataset.idx;
        currentBatch.items[idx].designPosition = btn.dataset.val;
        renderItems();
      });
    });

    document.querySelectorAll('.mode-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.dataset.idx;
        currentBatch.items[idx].campaignMode = btn.dataset.val;
        renderItems();
      });
    });
  }

  let selectedScene = 'white';

  document.querySelectorAll('.scene-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedScene = btn.dataset.scene;
    });
  });

  // 8. Generate All Photoshoot Pictures
  btnGenerateAll.addEventListener('click', async () => {
    if (!currentBatch.items || currentBatch.items.length === 0) return;

    // Show Progress Modal
    progressModal.style.display = 'flex';
    progressBarFill.style.width = '10%';
    progressStatusText.textContent = `0 / ${currentBatch.items.length} completed`;

    const isCampaignExtra = campaignExtraToggle.checked;

    try {
      // First save batch settings to server
      if (currentBatch.id && !currentBatch.id.startsWith('DEMO-')) {
        await fetch(`${API_BASE}/api/batches/${currentBatch.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: currentBatch.items, logoPosition: currentBatch.logoPosition })
        });
      }

      progressBarFill.style.width = '40%';

      // Trigger generation endpoint with backgroundStyle
      const res = await fetch(`${API_BASE}/api/batches/${currentBatch.id || 'DEMO'}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCampaignExtra, backgroundStyle: selectedScene })
      });

      const responseText = await res.text();
      let data = {};
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        throw new Error(`Server returned invalid response (Status ${res.status}): ${responseText.substring(0, 100)}`);
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || `Server error (${res.status})`);
      }

      progressBarFill.style.width = '100%';

      setTimeout(() => {
        progressModal.style.display = 'none';
        showGallery(data.results || []);
      }, 500);

    } catch (err) {
      alert('Generation error: ' + err.message);
      progressModal.style.display = 'none';
    }
  });

  // 9. Client-Side HTML5 Canvas Watermarking Engine
  async function applyClientBranding(imageUrl, productCode, logoPosition = 'top-right') {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // 1. Draw Transparent Logo
        const logo = new Image();
        logo.crossOrigin = 'anonymous';
        logo.onload = () => {
          const logoW = Math.round(canvas.width * 0.22);
          const logoH = Math.round(logoW * (logo.height / logo.width));
          const margin = Math.round(canvas.width * 0.04);

          let lx = canvas.width - logoW - margin;
          let ly = margin;
          if (logoPosition === 'top-left') { lx = margin; ly = margin; }
          else if (logoPosition === 'bottom-right') { lx = canvas.width - logoW - margin; ly = canvas.height - logoH - margin - 70; }
          else if (logoPosition === 'bottom-left') { lx = margin; ly = canvas.height - logoH - margin - 70; }

          ctx.drawImage(logo, lx, ly, logoW, logoH);
          drawBadge();
        };
        logo.onerror = () => drawBadge();
        logo.src = brandLogoPreview ? brandLogoPreview.src : '/assets/minime_logo_transparent.png';

        // 2. Draw Product Code Badge
        function drawBadge() {
          if (productCode) {
            const rawCode = productCode.trim().toUpperCase();
            const fullText = rawCode.startsWith('CODE:') ? rawCode : `CODE: ${rawCode}`;
            const fontSize = Math.max(18, Math.round(canvas.width * 0.034));
            const paddingX = 24;
            const paddingY = 12;

            ctx.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
            const textMetrics = ctx.measureText(fullText);
            const textW = textMetrics.width;

            const badgeW = Math.max(200, Math.round(textW + paddingX * 2));
            const badgeH = Math.round(fontSize + paddingY * 2 + 4);
            const margin = Math.round(canvas.width * 0.04);

            const bx = canvas.width - badgeW - margin;
            const by = canvas.height - badgeH - margin;

            // Draw dark rounded rect badge background
            ctx.fillStyle = 'rgba(13, 17, 23, 0.92)';
            ctx.strokeStyle = '#00D2C8';
            ctx.lineWidth = 2;

            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(bx, by, badgeW, badgeH, 10);
            } else {
              ctx.rect(bx, by, badgeW, badgeH);
            }
            ctx.fill();
            ctx.stroke();

            // Draw white text
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fullText, bx + badgeW / 2, by + badgeH / 2 + 1);
          }

          resolve(canvas.toDataURL('image/jpeg', 0.95));
        }
      };
      img.onerror = () => resolve(imageUrl);
      img.src = imageUrl;
    });
  }

  let activeBotToken = null;

  // 1. Fetch Config Status
  async function checkConfigStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/config-status`);
      const data = await res.json();
      
      if (data.botToken) {
        activeBotToken = data.botToken;
      }
      if (data.hasGeminiKey) {
        geminiStatus.classList.remove('offline');
        geminiStatus.classList.add('online');
        geminiStatus.title = "Gemini AI API Key Connected";
      }
      if (data.hasTelegramBot) {
        telegramStatus.classList.remove('offline');
        telegramStatus.classList.add('online');
        telegramStatus.title = "Telegram Bot Active";
      }
    } catch (e) {
      console.warn('Could not fetch config status:', e);
    }
  }

  // 10. Show Gallery Modal & Send Branded Photos to Telegram
  async function showGallery(results, chatId = null) {
    galleryGrid.innerHTML = '';
    const targetChatId = chatId || currentBatch.chatId;

    for (const res of results) {
      const brandedUrl = await applyClientBranding(res.resultUrl, res.productCode, currentBatch.logoPosition);
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <img src="${brandedUrl}" alt="Final Photoshoot Result">
        <div class="gallery-info">
          <span class="sku-tag">CODE: ${res.productCode}</span>
          <a href="${brandedUrl}" download="${res.productCode}_photoshoot.jpg" class="btn btn-secondary btn-sm">
            📥 Download
          </a>
        </div>
      `;
      galleryGrid.appendChild(card);

      // Automatically Send Branded Photo to Telegram
      if (activeBotToken && targetChatId) {
        try {
          const blobRes = await fetch(brandedUrl);
          const blob = await blobRes.blob();
          const formData = new FormData();
          formData.append('chat_id', targetChatId);
          formData.append('photo', blob, `${res.productCode}_photoshoot.jpg`);
          formData.append('caption', `✨ *Product Code:* ${res.productCode}\n👶 *Age:* ${res.ageGroup || '2-5 yrs'} | *Gender:* ${res.gender || 'Unisex'}`);
          formData.append('parse_mode', 'Markdown');

          fetch(`https://api.telegram.org/bot${activeBotToken}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
        } catch (tgErr) {
          console.error('Telegram send branded photo error:', tgErr);
        }
      }
    }

    galleryModal.style.display = 'flex';
  }

  btnCloseGallery.addEventListener('click', () => {
    galleryModal.style.display = 'none';
  });

  btnDownloadAll.addEventListener('click', () => {
    // Trigger download for each item in gallery
    document.querySelectorAll('.gallery-info a').forEach(link => link.click());
  });

  // Initial load
  handleHashRoute();
  window.addEventListener('hashchange', handleHashRoute);
});
