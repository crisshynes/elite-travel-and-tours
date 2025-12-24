/* ============================================================
   GLOBAL NOTIFICATION SYSTEM — Elite Travel & Tour
   Production-ready, role-aware (admin vs user), performant
   Requirements:
     - Supabase client exported as "sb" from /src/js/supabase.js
     - DOM elements:
         #bellBtn, #bellCount, #notifFeed, #notifList,
         #markAllReadBtn, #clearAllNotifBtn
   Goals:
     - Admins receive notifications for ALL users’ new requests in realtime,
       persisted per-admin and shown in admin’s drawer.
     - Users receive only their own notifications (viewer-scoped).
     - Newest at top, unread highlighted, role-aware action links.
     - Mark/Clear operations are viewer-scoped (affect only this viewer’s feed).
   ============================================================ */

import { sb } from "/src/js/supabase.js";

/* ------------------------------------------------------------
   DOM refs
------------------------------------------------------------- */
const bellBtn = document.getElementById("bellBtn");
const bellCount = document.getElementById("bellCount");
const notifFeed = document.getElementById("notifFeed");
const notifList = document.getElementById("notifList");
const markAllReadBtn = document.getElementById("markAllReadBtn");
const clearAllNotifBtn = document.getElementById("clearAllNotifBtn");

/* ------------------------------------------------------------
   State
------------------------------------------------------------- */
let notifHistory = [];          // viewer-scoped notifications (admin or user)
let rtViewerChannel = null;     // subscription for notifications rows for viewer
let rtAdminIntakeChannels = []; // subscriptions for admin intake on core tables
let currentUserId = null;
let currentUserEmail = null;
let currentUserRole = "user";   // "user" or "admin"
let isDrawerOpen = false;

/* ------------------------------------------------------------
   Utils
------------------------------------------------------------- */
function safeMeta(m){ return m && typeof m === "object" ? m : {}; }
function isUnread(n){ return !safeMeta(n.metadata).seen; }
function withSeenTrue(metadata){ const b=safeMeta(metadata); return { ...b, seen: true }; }
function nowIso(){ return new Date().toISOString(); }
function sortNewestFirst(list){
  return list.slice().sort((a,b)=>{
    const ta = new Date(a.created_at || a.client_inserted_at || 0).getTime();
    const tb = new Date(b.created_at || b.client_inserted_at || 0).getTime();
    return tb - ta;
  });
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function showToast(message, ms=2500){
  const t=document.getElementById("toast"), tt=document.getElementById("toastText");
  if(!t||!tt) return; tt.textContent=message; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"), ms);
}
function updateBellCounter(){
  const unread = notifHistory.filter(isUnread).length;
  if(!bellCount) return;
  if(unread>0){ bellCount.textContent=String(unread); bellCount.classList.remove("hidden"); }
  else { bellCount.textContent="0"; bellCount.classList.add("hidden"); }
}

/* ------------------------------------------------------------
   Role-aware links
------------------------------------------------------------- */
function adminLinkForNotification(n){
  const meta=safeMeta(n.metadata);
  const type=(meta.type||meta.category||"").toLowerCase();
  if(type==="appointment"||meta.appointment_id) {
    const id=meta.appointment_id||meta.id;
    return id ? `/views/admin/appointments.html?id=${encodeURIComponent(id)}` : `/views/admin/appointments.html`;
  }
  if(type==="application"||meta.application_id){
    const id=meta.application_id||meta.id;
    return id ? `/views/admin/applications.html?id=${encodeURIComponent(id)}` : `/views/admin/applications.html`;
  }
  if(type==="payment"||meta.payment_id){
    const id=meta.payment_id||meta.id;
    return id ? `/views/admin/payments.html?id=${encodeURIComponent(id)}` : `/views/admin/payments.html`;
  }
  return `/views/admin/index.html`;
}
function userLinkForNotification(n){
  const meta=safeMeta(n.metadata);
  const type=(meta.type||meta.category||"").toLowerCase();
  if(type==="application"||meta.application_id){
    const tracking=meta.tracking_id||meta.latest_tracking_id||null;
    return tracking ? `/views/pages/tracking.html?tracking=${encodeURIComponent(tracking)}` : null;
  }
  if(type==="tracking"||meta.tracking_id){
    const tr=meta.tracking_id; return tr ? `/views/pages/tracking.html?tracking=${encodeURIComponent(tr)}` : null;
  }
  if(type==="payment"||meta.payment_id){
    const tr=meta.tracking_id; return tr ? `/views/pages/tracking.html?tracking=${encodeURIComponent(tr)}` : null;
  }
  if(type==="appointment"||meta.appointment_id){
    const id=meta.appointment_id; return id ? `/views/pages/appointment.html?id=${encodeURIComponent(id)}` : null;
  }
  return null;
}

/* ------------------------------------------------------------
   Render
------------------------------------------------------------- */
function renderNotificationItem(n){
  const role=currentUserRole;
  const meta=safeMeta(n.metadata);
  const createdStr = n.created_at ? new Date(n.created_at).toLocaleString() : new Date().toLocaleString();
  const unread=isUnread(n);

  const el=document.createElement("div");
  el.className="notif-item";
  el.style.padding="10px 12px";
  el.style.borderBottom="1px solid rgba(148,163,184,.3)";
  el.style.display="grid";
  el.style.gap="6px";
  el.style.transition="background .15s ease";
  if(unread) el.style.background="var(--brand)"; // light blue

  const title=n.title||meta.title||"Notification";
  const actorEmail=meta.user_email || n.user_email || meta.email || "";
  const headerText = role==="admin" && actorEmail ? `${title} — ${actorEmail}` : title;

  const titleEl=document.createElement("div");
  titleEl.className="title"; titleEl.style.fontWeight="700"; titleEl.style.fontSize=".96rem";
  titleEl.textContent=headerText;

  const bodyEl=document.createElement("div");
  bodyEl.className="body"; bodyEl.style.color="var(--gray-200)"; bodyEl.style.fontSize=".88rem";
  bodyEl.textContent=n.message || n.text || meta.message || "";

  const metaRow=document.createElement("div");
  metaRow.className="notif-meta";
  metaRow.style.display="flex"; metaRow.style.justifyContent="space-between"; metaRow.style.alignItems="center"; metaRow.style.fontSize=".82rem";
  metaRow.innerHTML=`
    <span>${createdStr}</span>
    <span class="notif-chip" style="display:inline-flex;align-items:center;gap:.35rem;">
      ${unread ? '<i class="fa fa-circle-dot"></i> New' : '<i class="fa fa-circle-check"></i> Read'}
    </span>
  `;

  const href = role==="admin" ? adminLinkForNotification(n) : userLinkForNotification(n);
  if(href){
    const linkBtn=document.createElement("button");
    linkBtn.className="notif-link";
    linkBtn.textContent= role==="admin" ? "Open admin page" : "Open tracking";
    linkBtn.style.display="inline-flex"; linkBtn.style.alignItems="center"; linkBtn.style.gap=".4rem";
    linkBtn.style.padding=".35rem .6rem"; linkBtn.style.borderRadius="999px";
    linkBtn.style.border="1px solid rgba(148,163,184,.7)"; linkBtn.style.background="#020617"; linkBtn.style.color="#e5e7eb";
    linkBtn.style.cursor="pointer";
    linkBtn.addEventListener("click",(e)=>{ e.stopPropagation(); window.location.href=href; });
    const right=document.createElement("div"); right.style.display="flex"; right.style.alignItems="center"; right.style.gap=".5rem";
    right.appendChild(linkBtn);
    metaRow.replaceChildren(metaRow.firstChild, right);
  }

  el.addEventListener("click", async ()=>{
    if(!unread) return;
    try{
      await sb.from("notifications").update({ metadata: withSeenTrue(meta) }).eq("id", n.id).eq("user_id", currentUserId);
      n.metadata=withSeenTrue(meta);
      renderNotificationFeed();
    }catch(e){ console.warn("Failed to mark read:", e); }
  });

  el.appendChild(titleEl);
  el.appendChild(bodyEl);
  el.appendChild(metaRow);
  return el;
}

function renderNotificationFeed(){
  if(!notifList) return;
  notifList.innerHTML="";
  if(!notifHistory.length){
    notifList.innerHTML=`<div class="muted small-text">No notifications yet.</div>`;
    updateBellCounter(); return;
  }
  const sorted=sortNewestFirst(notifHistory);
  sorted.forEach(n=> notifList.appendChild(renderNotificationItem(n)));
  updateBellCounter();
}

/* ------------------------------------------------------------
   Fetch viewer-scoped notifications
------------------------------------------------------------- */
async function loadInitialNotifications(userId){
  try{
    const { data, error } = await sb
      .from("notifications")
      .select("id,title,message,text,created_at,metadata,link,user_id,user_email,category")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(300);
    if(error) throw error;
    notifHistory=(data||[]).map(n=>({ ...n, metadata: safeMeta(n.metadata) }));
    renderNotificationFeed();
  }catch(e){ console.error("Failed to load notifications:", e); }
}

/* ------------------------------------------------------------
   Subscribe to viewer notifications
------------------------------------------------------------- */
async function subscribeViewerNotifications(userId){
  if(rtViewerChannel){ try{ await sb.removeChannel(rtViewerChannel); }catch(_){ } rtViewerChannel=null; }
  rtViewerChannel = sb
    .channel(`notifs-${userId}`)
    .on("postgres_changes",
      { event:"INSERT", schema:"public", table:"notifications", filter:`user_id=eq.${userId}` },
      (payload)=>{
        const n={ ...payload.new, metadata: safeMeta(payload.new.metadata), client_inserted_at: nowIso() };
        notifHistory.unshift(n); renderNotificationFeed(); if(!isDrawerOpen) showToast(n.title||"New notification");
      })
    .on("postgres_changes",
      { event:"UPDATE", schema:"public", table:"notifications", filter:`user_id=eq.${userId}` },
      (payload)=>{
        const u={ ...payload.new, metadata: safeMeta(payload.new.metadata) };
        const idx=notifHistory.findIndex(x=>x.id===u.id);
        if(idx>-1){ notifHistory[idx]=u; } else { notifHistory.unshift(u); }
        renderNotificationFeed();
      })
    .on("postgres_changes",
      { event:"DELETE", schema:"public", table:"notifications", filter:`user_id=eq.${userId}` },
      (payload)=>{
        const id=payload.old?.id; if(id) notifHistory=notifHistory.filter(x=>x.id!==id); renderNotificationFeed();
      })
    .subscribe();
}

/* ------------------------------------------------------------
   Admin intake (persist per-admin)
   Admin receives inserts from ALL users for core tables
------------------------------------------------------------- */
function extractActorEmail(row){
  const m=safeMeta(row.metadata);
  return row.user_email || row.email || m.user_email || m.payer_email || null;
}
function buildAdminNotifPayload(type, row, adminUserId, adminEmail){
  const createdAt=row.created_at || nowIso();
  const actorEmail=extractActorEmail(row);
  const meta={ scope:"admin", type, user_email:actorEmail, action_required:true };
  // identifiers
  if(type==="appointment"){ meta.appointment_id=row.id; }
  if(type==="application"){ meta.application_id=row.id; }
  if(type==="payment"){
    meta.payment_id=row.id;
    const pm=safeMeta(row.metadata);
    if(pm.application_id) meta.application_id=pm.application_id;
    if(pm.tracking_id) meta.tracking_id=pm.tracking_id;
  }
  const title = type==="appointment" ? "New appointment request"
               : type==="application" ? "New application submitted"
               : "New payment attempt";
  const message = actorEmail
    ? `User (${actorEmail}) initiated a ${type}. Review and take action.`
    : `A ${type} was created. Review and take action.`;
  return {
    user_id: adminUserId,          // persisted to THIS admin only
    user_email: adminEmail || null,
    title, message,
    category: "admin",
    importance: "high",
    metadata: meta,
    created_at: createdAt,
    link: adminLinkForNotification({ metadata: meta })
  };
}
async function insertAdminNotif(type, row){
  try{
    const payload = buildAdminNotifPayload(type, row, currentUserId, currentUserEmail);
    const { data, error } = await sb
      .from("notifications")
      .insert(payload)
      .select("id,title,message,text,created_at,metadata,link,user_id,user_email")
      .single();
    if(error) throw error;
    const n={ ...data, metadata: safeMeta(data.metadata), client_inserted_at: nowIso() };
    notifHistory.unshift(n); renderNotificationFeed(); if(!isDrawerOpen) showToast(n.title||"New notification");
  }catch(e){ console.warn("Admin intake insert failed:", e); }
}
async function subscribeAdminIntake(){
  // Clean up existing admin channels
  for(const ch of rtAdminIntakeChannels){ try{ await sb.removeChannel(ch); }catch(_){ } }
  rtAdminIntakeChannels=[];

  // Subscribe to INSERTs on core tables
  const chApplications = sb
    .channel("admin-intake-applications")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"applications" }, (payload)=> insertAdminNotif("application", payload.new))
    .subscribe();

  const chAppointments = sb
    .channel("admin-intake-appointments")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"appointments" }, (payload)=> insertAdminNotif("appointment", payload.new))
    .subscribe();

  const chPayments = sb
    .channel("admin-intake-payments")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"payments" }, (payload)=> insertAdminNotif("payment", payload.new))
    .subscribe();

  rtAdminIntakeChannels.push(chApplications, chAppointments, chPayments);
}

/* ------------------------------------------------------------
   Actions: mark all read / clear all (viewer-only)
------------------------------------------------------------- */
async function markAllNotificationsRead(){
  if(!currentUserId) return;
  try{
    const ids=notifHistory.map(n=>n.id).filter(Boolean);
    if(!ids.length) return;
    const { data: rows } = await sb
      .from("notifications")
      .select("id,metadata")
      .in("id", ids)
      .eq("user_id", currentUserId);
    for(const row of rows||[]){
      const newMeta=withSeenTrue(row.metadata);
      await sb.from("notifications").update({ metadata:newMeta }).eq("id", row.id).eq("user_id", currentUserId);
    }
    notifHistory=notifHistory.map(n=>({ ...n, metadata: withSeenTrue(n.metadata) }));
    renderNotificationFeed();
  }catch(e){ console.warn("Failed to mark all read:", e); }
}
async function clearAllNotifications(){
  if(!currentUserId) return;
  try{
    await sb.from("notifications").delete().eq("user_id", currentUserId);
    notifHistory=[]; renderNotificationFeed();
  }catch(e){ console.warn("Failed to clear notifications:", e); }
}

/* ------------------------------------------------------------
   Drawer toggle and interactions
------------------------------------------------------------- */
function openDrawer(){
  if(!notifFeed) return;
  notifFeed.classList.add("open"); isDrawerOpen=true;
}
function closeDrawer(){
  if(!notifFeed) return;
  notifFeed.classList.remove("open"); isDrawerOpen=false;
}
bellBtn?.addEventListener("click", ()=>{
  if(isDrawerOpen) closeDrawer(); else openDrawer();
});
markAllReadBtn?.addEventListener("click", markAllNotificationsRead);
clearAllNotifBtn?.addEventListener("click", async ()=>{
  if(!confirm("Clear all notifications for this account?")) return;
  await clearAllNotifications();
});

/* Click-outside to close */
document.addEventListener("click",(e)=>{
  if(!notifFeed) return;
  const inFeed=e.target.closest("#notifFeed");
  const isBell=e.target.closest("#bellBtn");
  if(isBell) return; // handled by bellBtn
  if(!inFeed) closeDrawer();
});

/* ------------------------------------------------------------
   Initialization
------------------------------------------------------------- */
(async function initNotifications(){
  try{
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user;
    if(!user) return;

    currentUserId = user.id;
    currentUserEmail = user.email || null;

    try{
      const { data: userRow } = await sb.from("users").select("role,email").eq("id", currentUserId).single();
      currentUserRole = userRow?.role || "user";
    }catch(_){ currentUserRole = "user"; }

    // Load viewer-scoped notifications
    await loadInitialNotifications(currentUserId);
    await subscribeViewerNotifications(currentUserId);

    // Admin intake: listen to ALL inserts and persist admin notifications
    if(currentUserRole === "admin"){
      await subscribeAdminIntake();
    }
  }catch(e){
    console.error("Notifications init failed:", e);
  }
})();
