const { getStore } = require('@netlify/blobs');
const twilio = require('twilio');

const store = getStore('midwest-express-orders');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

const calcPrice = ({ pricingModel, distanceMiles, orderTotal }) => {
  if (pricingModel === 'commission') {
    const total = Number(orderTotal || 0);
    return Math.max(0, +(total * 0.12).toFixed(2));
  }
  const miles = Math.max(0, Number(distanceMiles || 0));
  if (miles <= 1) return 3;
  return +(3 + Math.ceil(miles - 1) * 0.5).toFixed(2);
};

const sendSms = async (order) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.ALERT_TO_NUMBER;

  if (!sid || !token || !from || !to) {
    return { sent: false, reason: 'Missing Twilio environment variables.' };
  }

  const client = twilio(sid, token);
  const body = [
    'New Midwest Express order',
    `Restaurant: ${order.restaurantName}`,
    `Customer: ${order.customerName}`,
    `Phone: ${order.customerPhone}`,
    `Address: ${order.deliveryAddress}`,
    `Submitted: ${order.receivedAt}`,
    `Estimated payout: $${order.estimatedPayout}`
  ].join('\n');

  const message = await client.messages.create({
    body,
    from,
    to
  });

  return { sent: true, sid: message.sid };
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const entries = [];
      for await (const { key } of store.list()) {
        const value = await store.get(key, { type: 'json' });
        if (value) entries.push(value);
      }
      entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json(200, { orders: entries });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const payload = JSON.parse(event.body || '{}');
    const required = ['restaurantName', 'merchantContact', 'customerName', 'customerPhone', 'deliveryAddress'];
    const missing = required.filter((field) => !payload[field]);
    if (missing.length) {
      return json(400, { error: `Missing fields: ${missing.join(', ')}` });
    }

    const now = new Date();
    const orderId = `MWX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const order = {
      id: orderId,
      restaurantName: payload.restaurantName,
      restaurantPhone: payload.restaurantPhone || '',
      merchantContact: payload.merchantContact,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      deliveryAddress: payload.deliveryAddress,
      apartmentSuite: payload.apartmentSuite || '',
      notes: payload.notes || '',
      itemsSummary: payload.itemsSummary || '',
      distanceMiles: payload.distanceMiles || '',
      orderTotal: payload.orderTotal || '',
      pricingModel: payload.pricingModel || 'mileage',
      estimatedPayout: calcPrice(payload),
      status: 'Pending Pickup',
      receivedAt: now.toLocaleString(),
      completedAt: '',
      pickedUpAt: '',
      createdAt: now.toISOString(),
      pickupProof: null,
      dropoffProof: null,
      sms: { sent: false }
    };

    try {
      order.sms = await sendSms(order);
    } catch (smsError) {
      order.sms = { sent: false, reason: smsError.message };
    }

    await store.setJSON(order.id, order);
    return json(200, { ok: true, order });
  } catch (error) {
    return json(500, { error: error.message || 'Server error' });
  }
};
