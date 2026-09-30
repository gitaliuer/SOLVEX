"use strict";

const profileFields = ["headline", "description", "industry", "location", "team_size", "website", "experience", "contact"];
let profileImage = "", profileGeneration = 0, photoBusy = false;
function profilePayload() {
  const payload = {name: $("team-name").value.trim()};
  for (const key of profileFields) payload[key] = $("profile-" + key).value.trim();
  for (const key of ["skills", "technologies", "interests"]) payload[key] = $("team-" + key).value.split(",").map(v => v.trim()).filter(Boolean);
  return payload;
}
function organizationCard(profile, compact = false) {
  const card = el("div", null, "organization-card" + (compact ? " compact" : ""));
  const header = el("div", null, "organization-header"), photo = el("div", null, "profile-photo"), title = el("div");
  if (profile.image_url) { const img = el("img"); img.src = profile.image_url; img.alt = ""; photo.append(img); }
  else SolvexI18n.set(photo,(profile.name || "S").slice(0, 2).toUpperCase());
  title.append(el("h3", profile.name || SolvexI18n.text("Ваше название")), el("p", profile.headline || SolvexI18n.text("Ваша история начинается здесь"), "hint"));
  header.append(photo, title); card.append(header);
  const meta = [profile.industry, profile.location, profile.team_size].filter(Boolean);
  if (meta.length) card.append(el("p", meta.join(" · "), "organization-meta"));
  if (profile.description) card.append(el("p", profile.description, "organization-description"));
  const tags = el("div", null, "matching-tags");
  for (const skill of (profile.skills || []).slice(0, 8)) tags.append(el("span", skill, "matching-tag"));
  if (tags.childElementCount) card.append(tags);
  if (profile.experience) {
    const details = el("details"), summary = el("summary", SolvexI18n.text("Проекты и опыт"));
    details.append(summary, el("p", profile.experience, "organization-description")); card.append(details);
  }
  if (profile.website) {
    try {
      const url = new URL(profile.website);
      if (["https:", "http:"].includes(url.protocol)) {
        const link = el("a", SolvexI18n.text("Сайт и портфолио ↗")); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link);
      }
    } catch {}
  }
  if (profile.contact) card.append(el("p", profile.contact, "organization-contact"));
  return card;
}
function updateProfilePreview() {
  const payload = {...profilePayload(), image_url: profileImage};
  $("profile-card-preview").replaceChildren(...organizationCard(payload).childNodes);
  const photo = $("profile-image"); photo.replaceChildren();
  if (profileImage) { const img = el("img"); img.src = profileImage; img.alt = ""; photo.append(img); }
  else SolvexI18n.set(photo,(payload.name || "S").slice(0, 2).toUpperCase());
  $("profile-remove-photo").hidden = !profileImage;
}
async function loadProfile() {
  const isTeam = state.user.role === "TEAM";
  $("profile-team-fields").hidden = !isTeam; $("team-skills").required = isTeam;
  if (state.profileDirty) { updateProfilePreview(); return; }
  const generation = ++profileGeneration;
  try {
    const {profile} = await api("/api/me/profile");
    if (generation !== profileGeneration || state.profileDirty) return;
    $("team-name").value = profile.name || "";
    for (const key of profileFields) $("profile-" + key).value = profile[key] || "";
    for (const key of ["skills", "technologies", "interests"]) $("team-" + key).value = (profile[key] || []).join(", ");
    profileImage = profile.image_url || "";
    SolvexI18n.set($("team-points"),isTeam ? SolvexI18n.combine(SolvexI18n.text("Баллы за подтверждённые этапы: "),profile.points || 0) : "");
    SolvexI18n.set($("profile-save-status"),"");
    updateProfilePreview();
  } catch (error) { message(error.message, true); }
}
$("team-profile-form").addEventListener("input", event => {
  if (event.target.type === "file") return;
  state.profileDirty = true; profileGeneration++;
  SolvexI18n.set($("profile-save-status"),SolvexI18n.text("Есть несохранённые изменения")); updateProfilePreview();
});
$("team-profile-form").addEventListener("submit", event => {
  event.preventDefault();
  action(event.currentTarget.querySelector('button[type="submit"]'), async () => {
    const payload = profilePayload();
    if (payload.name.length < 2) throw new Error(SolvexI18n.text("Название должно содержать не менее двух символов."));
    for (const key of ["skills", "technologies", "interests"]) if (payload[key].length > 16 || payload[key].some(v => v.length > 80)) throw new Error(SolvexI18n.text("До 16 пунктов, каждый — не длиннее 80 символов."));
    if (state.user.role === "TEAM" && !payload.skills.length) throw new Error(SolvexI18n.text("Добавьте хотя бы один навык."));
    const {profile} = await api("/api/me/profile", "PUT", payload);
    state.profileDirty = false; profileImage = profile.image_url; updateProfilePreview();
    SolvexI18n.set($("profile-save-status"),SolvexI18n.text("✓ Профиль сохранён")); message(SolvexI18n.text("Профиль сохранён. Он доступен другим участникам."));
  });
});
async function photoRequest(file) {
  if (photoBusy) return;
  if (file && (file.size > 3 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
    message(SolvexI18n.text("Выберите фото JPEG, PNG или WebP до 3 МБ."), true); return;
  }
  photoBusy = true; $("profile-file").disabled = $("profile-remove-photo").disabled = true;
  SolvexI18n.set($("photo-status"),SolvexI18n.text("Сохраняем фото…"));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/me/profile/image", {method:file ? "POST" : "DELETE", credentials:"same-origin",
      headers:{"X-CSRF-Token":state.csrf, ...(file ? {"Content-Type":file.type} : {})}, body:file || undefined, signal:controller.signal});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) SolvexAuth.open("login");
      throw new Error(SolvexI18n.failure(data.error));
    }
    profileImage = data.image_url; updateProfilePreview();
    SolvexI18n.set($("photo-status"),file ? SolvexI18n.text("✓ Фото сохранено") : SolvexI18n.text("Фото удалено"));
  } catch (error) { SolvexI18n.set($("photo-status"),""); message(error.name === "AbortError" ? SolvexI18n.text("Время ожидания истекло. Попробуйте ещё раз.") : error.message, true); }
  finally { clearTimeout(timer); photoBusy = false; $("profile-file").disabled = $("profile-remove-photo").disabled = false; $("profile-file").value = ""; }
}
$("profile-file").addEventListener("change", event => { if (event.target.files[0]) photoRequest(event.target.files[0]); });
$("profile-remove-photo").addEventListener("click", () => photoRequest(null));
