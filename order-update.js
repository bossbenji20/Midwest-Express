const { getStore } = require('@netlify/blobs');

const store = getStore('midwest-express-orders');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const payload = JSON.parse(event.body || '{}');
    const { id, action, imageData, fileName, dashboardPin } = payload;

    if (!id || !action) {
      return json(400, { error: 'Missing id or action.' });
    }

    if ((process.env.DASHBOARD_PIN || '').trim()) {
      if ((dashboardPin || '').trim() !== (process.env.DASHBOARD_PIN || '').trim()) {
        return json(401, { error: 'Invalid dashboard PIN.' });
      }
    }

    const order = await store.get(id, { type: 'json' });
    if (!order) {
      return json(404, { error: 'Order not found.' });
    }

    const now = new Date().toLocaleString();

    if (action === 'mark-picked-up') {
      order.status = 'Picked Up';
      order.pickedUpAt = now;
    } else if (action === 'mark-delivered') {
      order.status = 'Delivered';
      order.completedAt = now;
    } else if (action === 'attach-pickup-proof') {
      order.pickupProof = {
        imageData,
        fileName: fileName || 'pickup-proof.jpg',
        uploadedAt: now
      };
    } else if (action === 'attach-dropoff-proof') {
      order.dropoffProof = {
        imageData,
        fileName: fileName || 'dropoff-proof.jpg',
        uploadedAt: now
      };
    } else if (action === 'mark-cancelled') {
      order.status = 'Cancelled';
    } else {
      return json(400, { error: 'Unknown action.' });
    }

    await store.setJSON(order.id, order);
    return json(200, { ok: true, order });
  } catch (error) {
    return json(500, { error: error.message || 'Server error' });
  }
};
