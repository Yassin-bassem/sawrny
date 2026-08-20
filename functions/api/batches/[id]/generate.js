export async function onRequestPost(context) {
  try {
    const { env, params, request } = context;
    const batchId = params.id;
    
    let body = {};
    try {
      body = await request.json();
    } catch (e) {}

    const backgroundStyle = body.backgroundStyle || 'white';
    const apiKey = env.GEMINI_API_KEY;
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_KEY;
    const botToken = env.TELEGRAM_BOT_TOKEN;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing in Cloudflare Environment Variables' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

  // 1. Fetch batch items from Supabase
  let batch = null;
  if (supabaseUrl && supabaseKey) {
    try {
      const fetchRes = await fetch(`${supabaseUrl}/rest/v1/batches?id=eq.${batchId}`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const rows = await fetchRes.json();
      if (rows && rows.length > 0) batch = rows[0].data;
    } catch (e) {}
  }

  if (!batch) {
    return new Response(JSON.stringify({ error: 'Batch not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Helper for fast Base64 conversion without CPU bottleneck in Cloudflare Workers
  function bufferToBase64(arrayBuf) {
    const bytes = new Uint8Array(arrayBuf);
    let binary = '';
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000;
    for (let i = 0; i < len; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
  }

  // 2. Process each item in batch with Google Gemini REST API
  const results = [];
  for (const item of batch.items) {
    try {
      let bgPrompt = "standing upright on a clean high-key white studio wooden floor with soft daylight studio lighting";
      if (backgroundStyle === 'campaign') {
        bgPrompt = "standing in a cozy aesthetic nursery room with soft pastel backdrop walls, warm sunlight, eucalyptus greenery, and wooden decor";
      } else if (backgroundStyle === 'outdoor') {
        bgPrompt = "standing in a sunny lush garden with warm golden hour light and soft greenery background bokeh";
      }

      const isBackDesign = item.designPosition === 'back' || item.designOnBack === true;
      let viewPrompt = "FRONT VIEW: The child model is facing forward showing the front of the garment.";
      if (isBackDesign) {
        viewPrompt = "REAR VIEW / BACK VIEW OF CHILD MODEL: The print, logo, pattern, or main artwork design of this outfit is located ON THE BACK of the garment. Render a back view / rear view photo showing the child model facing away from the camera or turned around so the BACK of the outfit and its artwork are clearly displayed. CRITICAL MANDATE: DO NOT place the main artwork or design on the front of the garment; the front must remain plain/clean and the main design featured on the rear/back of the child model.";
      }

      const genderTerm = item.gender === 'Girl' ? 'cute young girl model' : item.gender === 'Boy' ? 'cute young boy model' : 'cute child model';
      const promptText = `RAW high resolution commercial fashion catalog photograph, a happy ${genderTerm} (${item.ageGroup || '2-5 yrs'}) ${bgPrompt}, actively WEARING THIS EXACT children clothing item on their body. ${viewPrompt} CRITICAL MANDATE: The photo MUST feature a real human child model wearing the garment. DO NOT show hangers or empty clothing displays. Sharp focus studio camera photography, 8k resolution commercial kids clothing catalog.`;

      let imagePart = null;
      if (item.originalUrl && item.originalUrl.startsWith('http')) {
        try {
          const imgRes = await fetch(item.originalUrl);
          const rawContentType = imgRes.headers.get('content-type') || 'image/jpeg';
          let validMime = 'image/jpeg';
          const cleanMime = rawContentType.split(';')[0].toLowerCase();
          if (cleanMime.startsWith('image/')) {
            validMime = cleanMime;
          }

          const arrayBuf = await imgRes.arrayBuffer();
          const base64Data = bufferToBase64(arrayBuf);
          imagePart = {
            inlineData: {
              mimeType: validMime,
              data: base64Data
            }
          };
        } catch (imgErr) {
          console.error('Fetch image error:', imgErr.message);
        }
      }

      // Call Google Gemini 2.5 Flash Image REST API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
      const payloadParts = [{ text: promptText }];
      if (imagePart) payloadParts.push(imagePart);

      const genRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: payloadParts }]
        })
      });

      const genData = await genRes.json();
      let generatedImgB64 = null;
      let imgMimeType = 'image/jpeg';

      if (genData.candidates && genData.candidates[0].content && genData.candidates[0].content.parts) {
        for (const p of genData.candidates[0].content.parts) {
          if (p.inlineData && p.inlineData.data) {
            generatedImgB64 = p.inlineData.data;
            imgMimeType = p.inlineData.mimeType || 'image/jpeg';
            break;
          }
        }
      }

      let finalResultUrl = item.originalUrl;
      if (generatedImgB64) {
        finalResultUrl = `data:${imgMimeType};base64,${generatedImgB64}`;
      } else {
        console.error('No generated image from Gemini:', JSON.stringify(genData));
      }

      item.resultUrl = finalResultUrl;
      results.push({ ...item, resultUrl: finalResultUrl, chatId: batch.chatId });
    } catch (ie) {
      console.error('Item processing error:', ie.message);
      results.push({ ...item, resultUrl: item.originalUrl, chatId: batch.chatId });
    }
  }

  // 3. Save results back to Supabase
  if (supabaseUrl && supabaseKey) {
    try {
      batch.results = results;
      batch.completedAt = new Date().toISOString();
      await fetch(`${supabaseUrl}/rest/v1/batches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id: batchId, data: batch })
      });
    } catch (e) {}
  }

  // 4. Send generated photos & message to Telegram user
  if (batch.chatId && botToken) {
    try {
      for (const resItem of results) {
        if (resItem.resultUrl && resItem.resultUrl.startsWith('data:image')) {
          const parts = resItem.resultUrl.split(',');
          const mimeMatch = parts[0].match(/:(.*?);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const b64 = parts[1];

          const binaryStr = atob(b64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const blob = new Blob([bytes.buffer], { type: mime });

          const formData = new FormData();
          formData.append('chat_id', batch.chatId);
          formData.append('photo', blob, `${resItem.productCode || 'photoshoot'}.jpg`);
          formData.append('caption', `✨ *Product Code:* ${resItem.productCode || ''}\n👶 *Age:* ${resItem.ageGroup || '2-5 yrs'} | *Gender:* ${resItem.gender || 'Unisex'}`);
          formData.append('parse_mode', 'Markdown');

          await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
        }
      }

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: batch.chatId,
          text: `🎉 *Batch #${batchId} Photoshoot Completed!* Photos sent above.\n\n👉 [Click here to open Sawrny Dashboard](https://sawrny.pages.dev/#batch/${batchId})`,
          parse_mode: 'Markdown'
        })
      });
    } catch (e) {}
  }

  return new Response(JSON.stringify({ success: true, results, chatId: batch.chatId }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
