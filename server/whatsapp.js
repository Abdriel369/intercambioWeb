'use strict';

const { whatsappDigits } = require('./phone');

const VALID_PROVIDERS = new Set(['none', 'meta', 'twilio']);

function getProvider() {
  const provider = String(process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error('WHATSAPP_PROVIDER debe ser none, meta o twilio.');
  }
  return provider;
}

function isAutomaticEnabled() {
  return getProvider() !== 'none';
}

/**
 * Adaptador de envío. Interfaz pública: sendMessage(phone, text, context).
 * - none: no envía; el panel usa enlaces wa.me.
 * - meta: WhatsApp Cloud API con plantilla aprobada de 3 variables:
 *   {{1}} nombre, {{2}} URL y {{3}} código.
 * - twilio: Content API con ContentSid y variables 1, 2 y 3.
 */
async function sendMessage(phone, text, context = {}) {
  const provider = getProvider();
  const digits = whatsappDigits(phone);
  if (!/^\d{11,15}$/.test(digits)) {
    throw new Error('El teléfono no está listo para WhatsApp.');
  }

  if (provider === 'none') {
    const error = new Error('El envío automático está desactivado.');
    error.statusCode = 400;
    throw error;
  }

  if (provider === 'meta') {
    const token = process.env.WHATSAPP_META_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_META_PHONE_NUMBER_ID;
    const templateName = process.env.WHATSAPP_META_TEMPLATE_NAME;
    const language = process.env.WHATSAPP_META_TEMPLATE_LANG || 'es_MX';
    if (!token || !phoneNumberId || !templateName) {
      throw new Error('Falta configurar las credenciales de WhatsApp Cloud API.');
    }
    if (!context.nombre || !context.url || !context.codigo) {
      throw new Error('La plantilla automática requiere nombre, URL y código.');
    }

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digits,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: context.nombre },
                  { type: 'text', text: context.url },
                  { type: 'text', text: context.codigo },
                ],
              },
            ],
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`WhatsApp Cloud API respondió con estado ${response.status}.`);
    }
    return { provider, ok: true };
  }

  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_WHATSAPP_FROM;
    const contentSid = process.env.TWILIO_CONTENT_SID;
    if (!accountSid || !authToken || !from || !contentSid) {
      throw new Error('Falta configurar las credenciales de Twilio.');
    }
    if (!context.nombre || !context.url || !context.codigo) {
      throw new Error('La plantilla automática requiere nombre, URL y código.');
    }

    const body = new URLSearchParams({
      To: `whatsapp:+${digits}`,
      From: from,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({
        1: context.nombre,
        2: context.url,
        3: context.codigo,
      }),
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    );

    if (!response.ok) {
      throw new Error(`Twilio respondió con estado ${response.status}.`);
    }
    return { provider, ok: true };
  }

  throw new Error('Proveedor de WhatsApp no soportado.');
}

module.exports = {
  getProvider,
  isAutomaticEnabled,
  sendMessage,
};
