/* ============================================================
   GLOBAL NOTIFICATION SYSTEM — Elite Travel & Tour
   Premium, production-ready, role-aware (admin vs user)
   Requirements:
     - Supabase client exported as "sb" from /src/js/supabase.js
     - DOM elements:
         #bellBtn, #bellCount, #notifFeed, #notifList,
         #markAllReadBtn, #clearAllNotifBtn
   Design:
     - Admins receive notifications for ALL users’ new inserts (applications,
       appointments, payments) in realtime. Each event is persisted as a row in
       notifications with user_id = admin.id (viewer-scoped feed).
     - Users receive notifications scoped to their own user_id only.
     - Newest at top, unread highlighted, role-aware action links.
     - Mark/Clear operations affect only the current viewer’s feed.
   Notes:
     - Ensure RLS policies allow users/admins to insert/read their own rows:
       users: select/insert own; admins: select all (optional), insert own.
     - Supports roles 'admin' and 'superadmin' as admins.
   ============================================================ */

import { sb } from "/src/js/supabase.js";

/* ------------------------------------------------------------
   DOM references
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
let notifHistory = [];          // viewer-scoped notifications (admin/user)
let rtViewerChannel = null;     // notifications rows subscription for viewer
let rtAdminIntakeChannels = []; // core tables intake (admin only)
let currentUserId = null;
let currentUserEmail = null;
let currentUserRole = "user";   // "user" | "admin" | "superadmin"
let isAdmin = false;
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
function logWarn(...args){ console.warn("[notifications]", ...args); }
function logInfo(...args){ console.info("[notifications]", ...args); }

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
  if(unread) el.style.background="var(--brand)"; // light blue on unread

  const title=n.title||meta.title||"Notification";
  const actorEmail=meta.user_email || n.user_email || meta.email || "";
  const headerText = (role==="admin" || role==="superadmin") && actorEmail ? `${title} — ${actorEmail}` : title;

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

  const href = (role==="admin" || role==="superadmin") ? adminLinkForNotification(n) : userLinkForNotification(n);
  if(href){
    const linkBtn=document.createElement("button");
    linkBtn.className="notif-link";
    linkBtn.textContent= (role==="admin" || role==="superadmin") ? "Open admin page" : "Open tracking";
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
      await sb.from("notifications")
        .update({ metadata: withSeenTrue(meta) })
        .eq("id", n.id)
        .eq("user_id", currentUserId);
      n.metadata=withSeenTrue(meta);
      renderNotificationFeed();
    }catch(e){ logWarn("Failed to mark read:", e?.message || e); }
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
   Viewer-scoped load
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
  }catch(e){ logWarn("Failed to load notifications:", e?.message || e); }
}

/* ------------------------------------------------------------
   Subscribe: viewer notifications
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
   Admin intake: subscribe to ALL inserts and persist per-admin
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
  }catch(e){ logWarn("Admin intake insert failed:", e?.message || e); }
}

/* Subscribe to inserts on core tables */
async function subscribeAdminIntake(){
  // Clean up previous
  for(const ch of rtAdminIntakeChannels){ try{ await sb.removeChannel(ch); }catch(_){ } }
  rtAdminIntakeChannels=[];

  // Applications
  const chApplications = sb
    .channel("admin-intake-applications")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"applications" },
      (payload)=> insertAdminNotif("application", payload.new))
    .subscribe();

  // Appointments
  const chAppointments = sb
    .channel("admin-intake-appointments")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"appointments" },
      (payload)=> insertAdminNotif("appointment", payload.new))
    .subscribe();

  // Payments
  const chPayments = sb
    .channel("admin-intake-payments")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"payments" },
      (payload)=> insertAdminNotif("payment", payload.new))
    .subscribe();

  rtAdminIntakeChannels.push(chApplications, chAppointments, chPayments);
  logInfo("Admin intake subscriptions active.");
}

/* ------------------------------------------------------------
   Actions: mark all read / clear all (viewer-only)
------------------------------------------------------------- */
async function markAllNotificationsRead(){
  if(!currentUserId) return;
  try{
    // Update local cache first
    notifHistory = notifHistory.map(n => ({ ...n, metadata: withSeenTrue(n.metadata) }));
    renderNotificationFeed();

    // Persist
    const ids = notifHistory.map(n=>n.id).filter(Boolean);
    if(!ids.length) return;

    const { data: rows, error: fetchErr } = await sb
      .from("notifications")
      .select("id,metadata")
      .in("id", ids)
      .eq("user_id", currentUserId);
    if(fetchErr){ logWarn("Fetch for markAllRead failed:", fetchErr?.message || fetchErr); return; }

    for(const row of rows||[]){
      const newMeta=withSeenTrue(row.metadata);
      const { error: updErr } = await sb
        .from("notifications")
        .update({ metadata: newMeta })
        .eq("id", row.id)
        .eq("user_id", currentUserId);
      if(updErr) logWarn("Failed to update notification metadata for id", row.id, updErr?.message || updErr);
    }
    updateBellCounter();
  }catch(e){ logWarn("markAllNotificationsRead failed", e?.message || e); }
}
async function clearAllNotifications(){
  if(!currentUserId) return;
  try{
    await sb
      .from("notifications")
      .delete()
      .eq("user_id", currentUserId);
    notifHistory=[]; renderNotificationFeed();
  }catch(e){ logWarn("Failed to clear notifications:", e?.message || e); }
}

/* ------------------------------------------------------------
   Drawer interactions
------------------------------------------------------------- */
function openDrawer(){ if(!notifFeed) return; notifFeed.classList.add("open"); isDrawerOpen=true; }
function closeDrawer(){ if(!notifFeed) return; notifFeed.classList.remove("open"); isDrawerOpen=false; }

bellBtn?.addEventListener("click", ()=>{
  if(isDrawerOpen) closeDrawer(); else openDrawer();
});
markAllReadBtn?.addEventListener("click", markAllNotificationsRead);
clearAllNotifBtn?.addEventListener("click", async ()=>{
  if(!confirm("Clear all notifications for this account?")) return;
  await clearAllNotifications();
});

document.addEventListener("click",(e)=>{
  if(!notifFeed) return;
  const inFeed=e.target.closest("#notifFeed");
  const isBell=e.target.closest("#bellBtn");
  if(isBell) return;
  if(!inFeed) closeDrawer();
});

/* ------------------------------------------------------------
   Init
------------------------------------------------------------- */
(async function initNotifications(){
  try{
    const { data, error } = await sb.auth.getSession();
    if(error){ logWarn("auth.getSession error:", error?.message || error); return; }
    const user = data?.session?.user;
    if(!user){ logWarn("No session user; notifications disabled."); return; }

    currentUserId = user.id;
    currentUserEmail = user.email || null;

    try{
      const { data: userRow, error: roleErr } = await sb
        .from("users")
        .select("role,email")
        .eq("id", currentUserId)
        .maybeSingle();
      if(roleErr){ logWarn("Fetch role failed:", roleErr?.message || roleErr); }
      currentUserRole = userRow?.role || "user";
      isAdmin = currentUserRole === "admin" || currentUserRole === "superadmin";
    }catch(e){ currentUserRole = "user"; isAdmin = false; }

    // Viewer-scoped notifications
    await loadInitialNotifications(currentUserId);
    await subscribeViewerNotifications(currentUserId);

    // Admin intake: receive ALL inserts and persist per-admin
    if(isAdmin){
      await subscribeAdminIntake();
    }
  }catch(e){
    logWarn("Notifications init failed:", e?.message || e);
  }
})();
