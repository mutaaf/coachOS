-- Add whatsapp_bot_url config entry
INSERT INTO config (category, key, value, label, description, field_type, sort_order)
VALUES (
  'messaging',
  'whatsapp_bot_url',
  '',
  'WhatsApp Bot URL',
  'The URL of your deployed WhatsApp bot service (e.g. https://your-bot.railway.app)',
  'text',
  100
)
ON CONFLICT (key) DO NOTHING;
