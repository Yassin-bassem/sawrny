export async function onRequestPost(context) {
  const { env, params, request } = context;
  const batchId = params.id;
  const body = await request.json();

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'Supabase credentials missing' }), { status: 500 });
  }

  try {
    // 1. Fetch current batch from Supabase
    const fetchRes = await fetch(`${supabaseUrl}/rest/v1/batches?id=eq.${batchId}`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    const rows = await fetchRes.json();
    let batch = (rows && rows.length > 0) ? rows[0].data : { id: batchId, items: [] };

    if (body.items) batch.items = body.items;
    if (body.logoPosition) batch.logoPosition = body.logoPosition;

    // 2. Save updated batch back to Supabase
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

    return new Response(JSON.stringify({ success: true, batch }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
