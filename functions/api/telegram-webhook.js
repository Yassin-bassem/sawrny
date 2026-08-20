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
          const batchId = `BATCH-${Math.floor(100000 + Math.random() * 900000)}`;

          // Create new batch object
          const batch = {
            id: batchId,
            chatId: chatId,
            createdAt: new Date().toISOString(),
            logoPosition: 'top-right',
            items: [
              {
                id: `item_${Date.now()}_1`,
                filename: `${fileId}.jpg`,
                originalUrl: fileLink, // 100% Free Telegram Cloud CDN URL
                ageGroup: 'Kids (4-6 yrs)',
                gender: 'Unisex',
                productCode: `MM-101`,
                campaignMode: 'model'
              }
            ]
          };

          // Save batch directly to Supabase
          if (supabaseUrl && supabaseKey) {
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
          }

          // Reply to Telegram with live Cloudflare Pages link
          const webAppUrl = `https://sawrny.pages.dev/#batch/${batchId}`;
          const caption = `📸 *Received garment photo for Batch #${batchId}!*\n\n` +
            `👉 *Click here to open your Sawrny Mobile Dashboard:*\n${webAppUrl}`;

          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'Markdown' })
          });
        }
      }
    }
  } catch (e) {
    console.error('Webhook error:', e.message);
  }

  return new Response('OK', { status: 200 });
}
