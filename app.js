const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const orderForm = document.getElementById('orderForm');
const orderStatus = document.getElementById('orderStatus');
const orderList = document.getElementById('orderList');
const refreshBtn = document.getElementById('refreshOrders');
const template = document.getElementById('orderCardTemplate');
const dashboardPinInput = document.getElementById('dashboardPin');

let currentOrders = [];

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'dispatch') loadOrders();
  });
});

const calcPreview = (data) => {
  if (data.pricingModel === 'commission') {
    const total = Number(data.orderTotal || 0);
    return `$${(total * 0.12).toFixed(2)} estimated`; 
  }
  const miles = Number(data.distanceMiles || 0);
  if (miles <= 1) return '$3.00 estimated';
  return `$${(3 + Math.ceil(miles - 1) * 0.5).toFixed(2)} estimated`;
};

orderForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(orderForm).entries());
  orderStatus.textContent = 'Submitting order...';
  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Order could not be submitted.');
    orderStatus.textContent = `Order sent successfully. ${calcPreview(data)} SMS ${result.order.sms?.sent ? 'sent' : 'saved without SMS'}.`;
    orderForm.reset();
  } catch (error) {
    orderStatus.textContent = error.message;
  }
});

refreshBtn?.addEventListener('click', loadOrders);

async function loadOrders() {
  orderList.innerHTML = '<div class="empty-state">Loading orders...</div>';
  try {
    const res = await fetch('/api/orders');
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Could not load orders.');
    currentOrders = result.orders || [];
    renderOrders();
  } catch (error) {
    orderList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

function renderOrders() {
  if (!currentOrders.length) {
    orderList.innerHTML = '<div class="empty-state">No orders yet. New merchant requests will appear here.</div>';
    return;
  }
  orderList.innerHTML = '';
  currentOrders.forEach((order) => {
    const node = template.content.cloneNode(true);
    node.querySelector('.order-id').textContent = order.id;
    node.querySelector('.restaurant-name').textContent = order.restaurantName;
    node.querySelector('.customer-meta').textContent = `${order.customerName} • ${order.customerPhone}`;
    const badge = node.querySelector('.status-badge');
    badge.textContent = order.status;
    badge.className = `status-badge ${statusClass(order.status)}`;
    node.querySelector('.delivery-address').textContent = [order.deliveryAddress, order.apartmentSuite].filter(Boolean).join(', ');
    node.querySelector('.received-at').textContent = order.receivedAt || '—';
    node.querySelector('.picked-up-at').textContent = order.pickedUpAt || '—';
    node.querySelector('.completed-at').textContent = order.completedAt || '—';
    node.querySelector('.pricing-line').textContent = `${order.pricingModel === 'commission' ? '12% commission' : 'Mileage rate'} • $${Number(order.estimatedPayout || 0).toFixed(2)}`;
    node.querySelector('.sms-line').textContent = order.sms?.sent ? 'Sent to phone' : (order.sms?.reason || 'Not sent');
    node.querySelector('.notes-block').textContent = [order.itemsSummary, order.notes].filter(Boolean).join(' • ') || 'No additional notes.';

    const pickupPreview = node.querySelector('.pickup-preview');
    const dropoffPreview = node.querySelector('.dropoff-preview');
    if (order.pickupProof?.imageData) pickupPreview.innerHTML = `<img src="${order.pickupProof.imageData}" alt="Pickup proof" />`;
    if (order.dropoffProof?.imageData) dropoffPreview.innerHTML = `<img src="${order.dropoffProof.imageData}" alt="Dropoff proof" />`;

    const pickupInput = node.querySelector('.pickup-input');
    const dropoffInput = node.querySelector('.dropoff-input');
    const message = node.querySelector('.card-message');

    node.querySelector('.pickup-mark').addEventListener('click', () => updateOrder(order.id, 'mark-picked-up', null, message));
    node.querySelector('.deliver-mark').addEventListener('click', () => updateOrder(order.id, 'mark-delivered', null, message));
    node.querySelector('.cancel-mark').addEventListener('click', () => updateOrder(order.id, 'mark-cancelled', null, message));
    node.querySelector('.pickup-upload').addEventListener('click', async () => {
      const file = pickupInput.files?.[0];
      if (!file) return message.textContent = 'Choose a pickup photo first.';
      const imageData = await compressImage(file);
      updateOrder(order.id, 'attach-pickup-proof', { imageData, fileName: file.name }, message);
    });
    node.querySelector('.dropoff-upload').addEventListener('click', async () => {
      const file = dropoffInput.files?.[0];
      if (!file) return message.textContent = 'Choose a dropoff photo first.';
      const imageData = await compressImage(file);
      updateOrder(order.id, 'attach-dropoff-proof', { imageData, fileName: file.name }, message);
    });

    orderList.appendChild(node);
  });
}

function statusClass(status) {
  if (status === 'Pending Pickup') return 'pending';
  if (status === 'Picked Up') return 'picked';
  return 'delivered';
}

async function updateOrder(id, action, extra, messageEl) {
  messageEl.textContent = 'Saving update...';
  try {
    const payload = {
      id,
      action,
      dashboardPin: dashboardPinInput.value,
      ...(extra || {})
    };
    const res = await fetch('/api/order-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Update failed.');
    messageEl.textContent = 'Saved.';
    await loadOrders();
  } catch (error) {
    messageEl.textContent = error.message;
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1280;
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
