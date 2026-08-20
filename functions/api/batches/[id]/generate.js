export async function onRequestPost(context) {
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

  // Helper for chunked Base64 conversion
  function bufferToBase64(arrayBuf) {
    const bytes = new Uint8Array(arrayBuf);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // 2. Process each item in batch with Google Gemini 2.5 Image REST API
  const results = [];
  for (const item of batch.items) {
    try {
      let bgPrompt = "standing upright on a clean high-key white studio wooden floor with soft studio daylight lighting";
      if (backgroundStyle === 'campaign') {
        bgPrompt = "standing in a cozy aesthetic nursery room with soft pastel backdrop walls, warm sunlight, eucalyptus greenery, and wooden decor";
      } else if (backgroundStyle === 'outdoor') {
        bgPrompt = "standing in a sunny lush garden with warm golden hour light and soft greenery bokeh";
      }

      const genderTerm = item.gender === 'Girl' ? 'cute young girl model' : item.gender === 'Boy' ? 'cute young boy model' : 'cute child model';
      const promptText = `A full-body commercial catalog photograph of a happy ${genderTerm} (${item.ageGroup || '2-5 yrs'}) ${bgPrompt}, actively WEARING THIS EXACT children clothing item on their body. CRITICAL MANDATE: The photo MUST feature a real human child model wearing the garment. DO NOT show hangers or empty clothing displays. Authentic camera photography, 8k resolution.`;

      let imagePart = null;
      if (item.originalUrl && item.originalUrl.startsWith('http')) {
        try {
          const imgRes = await fetch(item.originalUrl);
          const arrayBuf = await imgRes.arrayBuffer();
          const base64Data = bufferToBase64(arrayBuf);
          imagePart = {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Data
            }
          };
        } catch (e) {}
      }

      // Call Google Gemini 2.5 Image REST API
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

      if (genData.candidates && genData.candidates[0].content && genData.candidates[0].content.parts) {
        for (const p of genData.candidates[0].content.parts) {
          if (p.inlineData) {
            generatedImgB64 = p.inlineData.data;
            break;
          }
        }
      }

      let finalResultUrl = item.originalUrl;
      if (generatedImgB64) {
        finalResultUrl = `data:image/jpeg;base64,${generatedImgB64}`;

        // Send Photo directly to Telegram if bot token and chatId exist
        if (botToken && batch.chatId) {
          try {
            const byteCharacters = atob(generatedImgB64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'image/jpeg' });

            const formData = new FormData();
            formData.append('chat_id', batch.chatId);
            formData.append('photo', blob, `${item.productCode}_photoshoot.jpg`);
            formData.append('caption', `✨ *Product Code:* ${item.productCode}\n👶 *Age:* ${item.ageGroup || '2-5 yrs'} | *Gender:* ${item.gender || 'Unisex'}`);
            formData.append('parse_mode', 'Markdown');

            await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
              method: 'POST',
              body: formData
            });
          } catch (tgErr) {}
        }
      }

      item.resultUrl = finalResultUrl;
      results.push({ ...item, resultUrl: finalResultUrl });
    } catch (ie) {
      results.push({ ...item, resultUrl: item.originalUrl });
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

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
