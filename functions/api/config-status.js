export async function onRequestGet(context) {
  const { env } = context;
  return new Response(JSON.stringify({
    hasGeminiKey: !!env.GEMINI_API_KEY,
    hasTelegramBot: !!env.TELEGRAM_BOT_TOKEN,
    hasSupabase: !!env.SUPABASE_URL
  }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
