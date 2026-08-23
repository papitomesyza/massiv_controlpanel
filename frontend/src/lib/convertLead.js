import { api } from '../api';

// Turn a lead into a real project without leaving the page. The Projects page
// keeps its richer wizard based conversion for the full form; this is the
// direct path used by the dashboard rail, where the whole point is to not
// navigate away. It creates a minimal project from what the lead already knows,
// then removes the lead through the existing convert endpoint, which returns
// the lead data and deletes it server side.
export async function convertLeadToProject(lead) {
  const title =
    (lead.client_name && lead.client_name.trim()) ||
    (lead.category_name && lead.category_name.trim()) ||
    'New Project';

  const project = await api.post('/projects', {
    title,
    client_id: lead.client_id || null,
    category_id: lead.category_id || null,
    agreed_budget: lead.value != null ? Number(lead.value) : 0,
  });

  try {
    await api.post(`/leads/${lead.id}/convert`, {});
  } catch (_) {
    /* lead already gone is fine */
  }

  return project; // { id, phases }
}
