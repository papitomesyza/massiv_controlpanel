import { api } from '../api';

// One deadline patch path, shared by the Dashboard timeline and the Projects
// timeline. Given a state setter for a project list, it returns an optimistic
// patcher: it updates the deadline in place, PATCHes through the existing project
// update endpoint (which re-syncs the calendar), and rolls back on failure. Both
// pages drag a bar and save the same way, so the calendar stays in sync from
// either page.
export function makeDeadlinePatcher(setProjects) {
  return async function patchDeadline(p, iso) {
    setProjects(list => list.map(x => x.id === p.id ? { ...x, deadline: iso } : x));
    try {
      await api.put(`/projects/${p.id}`, {
        client_id: p.client_id ?? null,
        title: p.title,
        category_id: p.category_id ?? null,
        status: p.status,
        client_budget: p.client_budget ?? 0,
        agreed_budget: p.agreed_budget ?? 0,
        notes: p.notes ?? null,
        shoot_date: p.shoot_date ?? null,
        shoot_days: p.shoot_days ?? 1,
        shoot_location: p.shoot_location ?? null,
        location_name: p.location_name ?? null,
        location_lat: p.location_lat ?? null,
        location_lng: p.location_lng ?? null,
        shoot_start_time: p.shoot_start_time ?? null,
        shoot_end_time: p.shoot_end_time ?? null,
        deadline: iso,
      });
    } catch (_) {
      setProjects(list => list.map(x => x.id === p.id ? { ...x, deadline: p.deadline } : x));
    }
  };
}
