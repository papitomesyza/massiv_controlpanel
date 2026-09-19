import { api } from '../api';

const slug = name => String(name || '').toLowerCase().replace(/ /g, '-');

// Advance a project so the phase at targetIndex (0-based over the ordered phase
// list) becomes the active one. This runs through the existing project update
// path, so both side effects a normal edit produces still fire: the phase
// complete / reactivate endpoints record each transition in the status history,
// and the project PUT re-syncs the calendar. No API response shape changes.
//
// Forward moves complete each intervening phase in turn, mirroring the project
// detail page. A backward move reactivates the target phase; it is destructive
// to the phase record, so the caller confirms it first.
//
// Returns a small summary of the resulting state so the caller can reconcile its
// optimistic update: { newStatus, completedPhases, currentPhase }.
export async function advanceToPhase(project, targetIndex) {
  const data = await api.get(`/projects/${project.id}`);
  const phases = (data.phases || []).slice().sort((a, b) => a.order_index - b.order_index);
  if (!phases.length || targetIndex < 0 || targetIndex >= phases.length) return null;

  let activeIdx = phases.findIndex(p => p.status === 'active');
  if (activeIdx === -1) activeIdx = phases.length; // fully completed: nothing active
  if (targetIndex === activeIdx) return null;

  if (targetIndex > activeIdx) {
    // Forward: complete each phase from the current active one up to the target,
    // leaving the target phase active.
    for (let i = activeIdx; i < targetIndex && i < phases.length; i++) {
      await api.put(`/projects/${project.id}/phases/${phases[i].id}/complete`, {});
    }
  } else {
    // Backward: reactivate the target phase directly.
    await api.put(`/projects/${project.id}/phases/${phases[targetIndex].id}/reactivate`, {});
  }

  const targetPhase = phases[targetIndex];
  const newStatus = slug(targetPhase.phase_name);

  // Re-run the standard project update so the calendar re-syncs exactly as an
  // edit would. The status is already set by the phase endpoints above, so this
  // records no duplicate history row.
  const p = data.project;
  await api.put(`/projects/${project.id}`, {
    client_id: p.client_id ?? null,
    title: p.title,
    category_id: p.category_id ?? null,
    status: newStatus,
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
    deadline: p.deadline ?? null,
  });

  return { newStatus, completedPhases: targetIndex, currentPhase: targetPhase.phase_name };
}
