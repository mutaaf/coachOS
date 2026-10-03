/**
 * A WhatsApp group invite link, as WhatsApp's "Invite via link" gives it.
 * The database checks the same shape (programs.whatsapp_group_url).
 */
export const WHATSAPP_GROUP = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+\/?(\?.*)?$/;
