export function contextSettings(record) {
  if (record?.type !== 'turn_context') return null;
  const p = record.payload;
  const model = p.collaboration_mode?.settings?.model || p.model;
  const effort = p.collaboration_mode?.settings?.reasoning_effort ?? p.effort;
  if (!p.turn_id || !model) return null;
  return { turnId: p.turn_id, model, effort: effort ?? null };
}

export function settingsPatch(previous, current, agent) {
  if (!current || JSON.stringify(previous) === JSON.stringify(current)) return {};
  const patch = {};
  if (current.model !== agent.model) patch.model = current.model;
  // An omitted effort means the backend default, not the global UI preference.
  if (current.effort != null && current.effort !== agent.thinkingOptionId) patch.effort = current.effort;
  return patch;
}

export const isFast = tier => tier === 'fast' || tier === 'priority';
