document.addEventListener("DOMContentLoaded", () => {
  upgradeToTailAdmin({ pageId: "participants", title: "Participantes", subtitle: "CRUD completo com permissões e criação de contas" });
  ensureAuth();
  loadConfigFields();
  setNavActive("participants");
  const tbody = document.querySelector("#participants-table tbody");

  const resetForm = () => {
    state.mode = "create";
    state.currentId = null;
    document.getElementById("form-title").textContent = "Novo participante";
    ["p-id","p-reg","p-name","p-short"].forEach(id => {
      const el = document.getElementById(id);
      el.value = "";
      el.readOnly = false;
    });
    document.getElementById("p-status").value = "ACTIVE";
    document.getElementById("p-can-send").checked = true;
    document.getElementById("p-can-receive").checked = true;
    document.getElementById("p-can-init").checked = true;
    document.getElementById("p-can-query").checked = true;
    document.getElementById("p-acc-currency").value = "BRL";
    document.getElementById("p-acc-balance").value = 1000000;
    document.getElementById("p-result").textContent = "";
  };

  async function loadParticipants() {
    tbody.innerHTML = "<tr><td colspan='4'>Carregando...</td></tr>";
    try {
      const res = await apiFetch(`${state.dirUrl}/participants`, { headers: authHeader() });
      const data = await readBody(res);
      const list = Array.isArray(data) ? data : [];
      tbody.innerHTML = list.map(p =>
        `<tr data-id="${p.id}"><td>${p.id}</td><td>${p.status}</td><td>${p.regulatory_id}</td><td>${p.name}</td></tr>`
      ).join("");
      if (list.length === 0) tbody.innerHTML = "<tr><td colspan='4'>Nenhum participante</td></tr>";
      tbody.querySelectorAll("tr").forEach(tr => tr.addEventListener("click", () => loadParticipant(tr.dataset.id)));
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="4">Erro: ${e.message}</td></tr>`;
    }
  }

  async function loadParticipant(id) {
    state.mode = "edit";
    state.currentId = id;
    const out = document.getElementById("p-result");
    out.textContent = "Carregando...";
    document.getElementById("form-title").textContent = `Editar participante ${id}`;
    try {
      const [detailRes, permRes] = await Promise.all([
        apiFetch(`${state.dirUrl}/participants/${id}`, { headers: authHeader() }),
        apiFetch(`${state.dirUrl}/participants/${id}/permissions`, { headers: authHeader() }),
      ]);
      const detail = await readBody(detailRes);
      const perms = await readBody(permRes);
      document.getElementById("p-id").value = detail?.id || "";
      document.getElementById("p-id").readOnly = true;
      document.getElementById("p-reg").value = detail?.regulatory_id || "";
      document.getElementById("p-name").value = detail?.name || "";
      document.getElementById("p-short").value = detail?.short_name || "";
      document.getElementById("p-status").value = detail?.status || "ACTIVE";
      ["p-reg","p-name","p-short"].forEach(id => document.getElementById(id).readOnly = true);
      document.getElementById("p-can-send").checked = !!perms?.can_send;
      document.getElementById("p-can-receive").checked = !!perms?.can_receive;
      document.getElementById("p-can-init").checked = !!perms?.can_initiate;
      document.getElementById("p-can-query").checked = !!perms?.can_query;
      out.textContent = JSON.stringify({ detail, perms }, null, 2);
      logAudit("participant:load", { id });
    } catch (e) {
      out.textContent = e.message;
    }
  }

  async function saveParticipant() {
    const out = document.getElementById("p-result");
    const body = {
      id: document.getElementById("p-id").value.trim(),
      regulatory_id: document.getElementById("p-reg").value.trim(),
      name: document.getElementById("p-name").value.trim(),
      short_name: document.getElementById("p-short").value.trim(),
      status: document.getElementById("p-status").value,
    };
    const perms = {
      can_send: document.getElementById("p-can-send").checked,
      can_receive: document.getElementById("p-can-receive").checked,
      can_initiate: document.getElementById("p-can-init").checked,
      can_query: document.getElementById("p-can-query").checked,
    };
    const accCurrency = document.getElementById("p-acc-currency").value.trim();
    const accBalance = Number(document.getElementById("p-acc-balance").value);
    if (!body.id || !body.regulatory_id || !body.name) { out.textContent = "Campos obrigatórios: id, regulatory_id, name"; return; }
    try {
      if (state.mode === "create") {
        const res = await apiFetch(`${state.dirUrl}/participants`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
        const data = await readBody(res);
        if (!res.ok) { out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2); return; }
        logAudit("participant:create", { id: body.id });
      } else {
        const res = await apiFetch(`${state.dirUrl}/participants/${body.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ status: body.status }),
        });
        const data = await readBody(res);
        if (!res.ok) { out.textContent = JSON.stringify({ status: res.status, body: data }, null, 2); return; }
        logAudit("participant:update_status", { id: body.id, status: body.status });
      }
      const permRes = await apiFetch(`${state.dirUrl}/participants/${body.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(perms),
      });
      const permData = await readBody(permRes);
      if (!permRes.ok) { out.textContent = JSON.stringify({ status: permRes.status, body: permData }, null, 2); return; }
      let accountData = null;
      if (accCurrency) {
        const accPayload = { participant_id: body.id, currency: accCurrency, balance_cents: isNaN(accBalance) ? 0 : accBalance, status: "ACTIVE" };
        const accRes = await apiFetch(`${state.coreUrl}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(accPayload),
        });
        accountData = await readBody(accRes);
        logAudit("account:create", { participant: body.id, currency: accCurrency });
      }
      out.textContent = JSON.stringify({ ok: true, perms: permData, account: accountData }, null, 2);
      loadParticipants();
      logAudit("participant:save", { id: body.id });
    } catch (e) { out.textContent = e.message; }
  }

  document.getElementById("load-participants").onclick = loadParticipants;
  document.getElementById("new-participant").onclick = resetForm;
  document.getElementById("save-participant").onclick = saveParticipant;
  document.getElementById("cancel-participant").onclick = resetForm;

  loadParticipants();
  resetForm();
});
