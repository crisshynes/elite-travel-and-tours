import { sb } from './supabase.js';

export async function mountProfile() {
  const root = document.getElementById('profileRoot');
  if (!root) return;

  root.innerHTML = `
    <section class="tiktok card">
      <div class="cover">
        <img src="/public/assets/profile/cover.jpg" alt="cover">
        <div class="avatar"><img src="/public/assets/profile/avatar.jpg" alt="avatar"></div>
      </div>
      <div class="bio">
        <h3 id="profileName">@elite_travel</h3>
        <p id="profileEmail">Premium travel and visa assistance • Accra, Ghana</p>
        <div class="actions">
          <button class="btn brand" id="followBtn"><i class="fa-solid fa-plus"></i> Follow</button>
          <a class="btn outline" href="/views/pages/editor.html"><i class="fa-solid fa-wrench"></i> Open editor</a>
        </div>
      </div>
      <div class="grid-feed" id="profileFeed"></div>
    </section>

    <section class="card"><div class="body">
      <h3>Payments</h3>
      <ul class="list" id="paymentList"></ul>
      <button class="btn" id="makePaymentBtn"><i class="fa-regular fa-credit-card"></i> Make payment</button>
    </div></section>

    <section class="card"><div class="body">
      <h3>Notifications</h3>
      <ul class="list" id="notifUserList"></ul>
    </div></section>
  `;

  // --- POSTS (static demo feed)
  const posts = [
    { src:'/public/assets/services/visa.jpg', title:'Visa tips' },
    { src:'/public/assets/services/workpay.jpg', title:'Work & Pay spotlight' },
    { src:'/public/assets/screenshots/airport-terminal.jpg', title:'Flight booking updates' },
  ];
  document.getElementById('profileFeed').innerHTML = posts.map(p=>`
    <div class="post"><img src="${p.src}" alt="${p.title}"></div>
  `).join('');

  // --- Load user profile info
  const { data: { user } } = await sb.auth.getUser();
  if (user) {
    const { data, error } = await sb.from('users').select('*').eq('id', user.id).single();
    if (!error && data) {
      document.getElementById('profileName').textContent = data.name || '@elite_travel';
      document.getElementById('profileEmail').textContent = user.email; // locked: always show auth email
    }
  }

  // --- PAYMENTS
  async function loadPayments() {
    const { data, error } = await sb.from('payments')
      .select('ref,amount,status,created_at')
      .eq('user_id', user.id)
      .order('created_at',{ascending:false})
      .limit(20);
    if (error) { console.error(error); return; }
    const list = document.getElementById('paymentList');
    list.innerHTML = (data||[]).map(p=>`
      <li class="card"><div class="body toolbar">
        <span><strong>${p.ref}</strong></span>
        <span>GHS ${p.amount}</span>
        <span class="badge">${p.status}</span>
        <span>${new Date(p.created_at).toLocaleString()}</span>
      </div></li>
    `).join('');
  }
  await loadPayments();

  // --- NOTIFICATIONS
  async function loadNotifications() {
    const { data, error } = await sb.from('notifications')
      .select('title,message,created_at')
      .eq('user_id', user.id)
      .order('created_at',{ascending:false})
      .limit(20);
    if (error) { console.error(error); return; }
    const list = document.getElementById('notifUserList');
    list.innerHTML = (data||[]).map(n=>`
      <li class="card"><div class="body">
        <strong>${n.title}</strong>
        <div class="muted">${n.message}</div>
        <span class="badge">${new Date(n.created_at).toLocaleString()}</span>
      </div></li>
    `).join('');
  }
  await loadNotifications();

  // Realtime notifications
  sb.channel(`profile-notifs-${user.id}`)
    .on('postgres_changes',{
      event:'INSERT',
      schema:'public',
      table:'notifications',
      filter:`user_id=eq.${user.id}`
    },payload=>{
      const n = payload.new;
      const list = document.getElementById('notifUserList');
      const el = document.createElement('li');
      el.className = 'card';
      el.innerHTML = `
        <div class="body">
          <strong>${n.title}</strong>
          <div class="muted">${n.message}</div>
          <span class="badge">${new Date(n.created_at).toLocaleString()}</span>
        </div>`;
      list.prepend(el);
    })
    .subscribe();

  // --- FOLLOW button
  document.getElementById('followBtn').addEventListener('click', async ()=>{
    if (!user) { alert('Please log in to follow.'); return; }
    const eliteId = 'UUID_OF_ELITE_ACCOUNT'; // replace with actual Elite account UUID
    const { error } = await sb.from('followers').insert({
      follower_id: user.id,
      following_id: eliteId
    });
    if (error) alert(error.message); else alert('Followed successfully!');
  });

  // --- MAKE PAYMENT button
  document.getElementById('makePaymentBtn').addEventListener('click', async ()=>{
    if (!user) { alert('Please log in to make a payment.'); return; }
    const ref = 'REF' + Math.floor(Math.random()*1000000);
    const { error } = await sb.from('payments').insert({
      user_id: user.id,
      ref,
      amount: 100.00,
      status: 'pending'
    });
    if (error) alert(error.message);
    else { alert('Payment created. Redirect to gateway here.'); await loadPayments(); }
  });
}
