async function getBatchFromSupabase(supabaseUrl, supabaseKey, batchId) {
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/batches?id=eq.${batchId}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const rows = await res.json();
    if (rows && rows.length > 0) return rows[0].data;
  } catch (e) {}
  return null;
}

async function findRecentBatchForChat(supabaseUrl, supabaseKey, chatId) {
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/batches?order=created_at.desc&limit=5`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const rows = await res.json();
    if (rows && Array.isArray(rows)) {
      const now = Date.now();
      for (const row of rows) {
        const b = row.data;
        if (b && b.chatId === chatId) {
          const createdTime = new Date(b.createdAt).getTime();
          // If created within last 6 seconds
          if (now - createdTime < 6000) {
            return b;
          }
        }
      }
    }
  } catch (e) {}
  return null;
}

async function saveBatchToSupabase(supabaseUrl, supabaseKey, batchId, batchData) {
  if (!supabaseUrl || !supabaseKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ id: batchId, data: batchData })
    });
  } catch (e) {}
}

async function sendOrEditTelegramMessage(botToken, chatId, telegramMessageId, text) {
  if (telegramMessageId) {
    try {
      const editRes = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: telegramMessageId,
          text: text,
          parse_mode: 'Markdown'
        })
      });
      const editData = await editRes.json();
      if (editData.ok) return telegramMessageId;
    } catch (e) {}
  }

  try {
    const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      })
    });
    const sendData = await sendRes.json();
    if (sendData.ok && sendData.result && sendData.result.message_id) {
      return sendData.result.message_id;
    }
  } catch (e) {}

  return null;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_KEY;

  if (!botToken) {
    return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN missing' }), { status: 500 });
  }

  try {
    const update = await request.json();

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;

      if (msg.text === '/start') {
        const replyText = `🌸 *Welcome to Sawrny Studio (صورني)!* 🌸\n\n` +
          `Send me photos of your children's wear collection (one or multiple images).\n` +
          `I will prepare a batch for you and send you a link to quickly configure age, product codes, and generate professional photoshoot images!`;

        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: replyText, parse_mode: 'Markdown' })
        });
        return new Response('OK', { status: 200 });
      }

      if (msg.photo && msg.photo.length > 0) {
        const photo = msg.photo[msg.photo.length - 1]; // highest resolution
        const fileId = photo.file_id;

        // Fetch Telegram free file link
        const fileInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
        const fileInfo = await fileInfoRes.json();

        let fileLink = null;
        if (fileInfo.ok && fileInfo.result && fileInfo.result.file_path) {
          fileLink = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
        }

        if (fileLink) {
          let batchId = null;
          let batch = null;

          // 1. Determine Batch ID: Media Group ID or Recent Pending Batch for Chat
          if (msg.media_group_id) {
            batchId = `BATCH-${msg.media_group_id.slice(-6)}`;
          } else {
            const recent = await findRecentBatchForChat(supabaseUrl, supabaseKey, chatId);
            if (recent) {
              batchId = recent.id;
              batch = recent;
            }
          }

          if (!batchId) {
            batchId = `BATCH-${Math.floor(100000 + Math.random() * 900000)}`;
          }

          if (!batch && supabaseUrl && supabaseKey) {
            batch = await getBatchFromSupabase(supabaseUrl, supabaseKey, batchId);
          }

          if (!batch) {
            batch = {
              id: batchId,
              chatId: chatId,
              createdAt: new Date().toISOString(),
              logoPosition: 'top-right',
              items: [],
              telegramMessageId: null
            };
          }

          // Check if photo is already in batch items
          const targetFilename = `${fileId}.jpg`;
          const exists = batch.items.some(item => item.filename === targetFilename || item.originalUrl === fileLink);

          if (!exists) {
            batch.items.push({
              id: `item_${Date.now()}_${batch.items.length + 1}`,
              filename: targetFilename,
              originalUrl: fileLink, // 100% Free Telegram Cloud CDN URL
              ageGroup: 'Kids (4-6 yrs)',
              gender: 'Unisex',
              productCode: `MM-${100 + batch.items.length + 1}`,
              campaignMode: 'model'
            });

            // Save updated batch to Supabase
            await saveBatchToSupabase(supabaseUrl, supabaseKey, batchId, batch);
          }

          // Buffer 2.5s for concurrent photo requests
          await new Promise(resolve => setTimeout(resolve, 2500));

          // Re-fetch latest batch state from Supabase
          const latestBatch = await getBatchFromSupabase(supabaseUrl, supabaseKey, batchId) || batch;
          const lastItem = latestBatch.items[latestBatch.items.length - 1];

          // Only the LAST photo in the batch array triggers the message send or edit
          if (lastItem && (lastItem.filename === targetFilename || lastItem.originalUrl === fileLink)) {
            const webAppUrl = `https://sawrny.pages.dev/#batch/${batchId}`;
            const countStr = latestBatch.items.length === 1 ? '1 garment photo' : `${latestBatch.items.length} garment photos`;
            const caption = `📸 *Received ${countStr} for Batch #${batchId}!*\n\n` +
              `👉 *Click here to open your Sawrny Mobile Dashboard:*\n${webAppUrl}`;

            const newMsgId = await sendOrEditTelegramMessage(botToken, chatId, latestBatch.telegramMessageId, caption);
            if (newMsgId && !latestBatch.telegramMessageId) {
              latestBatch.telegramMessageId = newMsgId;
              await saveBatchToSupabase(supabaseUrl, supabaseKey, batchId, latestBatch);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Webhook error:', e.message);
  }

  return new Response('OK', { status: 200 });
}
