// Adapter for the current Desktop renderer. Use Codey's existing scope discovery,
// then the same native signal that the Desktop Fast picker reads and writes.
// Fail closed when the Desktop build/shape changes; never guess another signal.
const install = `async () => {
  if (window.__remNativeFast?.valid()) return;
  const entry = document.scripts[0]?.src;
  const text = await fetch(entry).then(r => r.text());
  const asset = text.match(/app-initial-[a-f0-9]+\\.js/)?.[0];
  if (asset !== 'app-initial-92cbfeba4f7c.js') throw new Error('Desktop settings adapter needs review for this Desktop build');
  const mod = await import(new URL(asset, entry).href);
  if (typeof window.__codeyAppServerManagerFromReact !== 'function' || typeof mod.$4t !== 'function') throw new Error('Codey native scope discovery unavailable');
  let scope;
  window.__codeyAppServerManagerFromReact((candidate, host) => {
    const manager = mod.$4t(candidate, host);
    if (typeof manager?.resumeConversation === 'function') scope = candidate;
    return manager;
  });
  if (!scope?.node?.familyBindings) throw new Error('Desktop root settings scope unavailable');
  const valid = v => v && (
    (v.type === 'fromConfig' || v.type === 'standard') && Object.keys(v).length === 1 ||
    v.type === 'custom' && typeof v.serviceTier === 'string' && Object.keys(v).length === 2
  );
  const matches = [];
  for (const [family, bindings] of scope.node.familyBindings) {
    const signal = bindings.get('local')?.value;
    if (family.kind !== 'signal-family' || typeof signal?.get !== 'function' || typeof signal?.set !== 'function') continue;
    if (valid(signal.get())) matches.push(signal);
  }
  if (matches.length !== 1) throw new Error('Desktop Fast signal is missing or ambiguous');
  const signal = matches[0];
  window.__remNativeFast = {
    valid: () => valid(signal.get()),
    read: () => signal.get(),
    set: value => { if (!valid(value)) throw new Error('Invalid Fast selection'); signal.set(value); return signal.get(); },
  };
}`;

export class DesktopSettings {
  constructor(bridge) { this.bridge = bridge; }
  async read() {
    await this.bridge.cdp.evaluate(`(${install})()`);
    return this.bridge.cdp.evaluate('window.__remNativeFast.read()');
  }
  async restore(value) {
    await this.bridge.cdp.evaluate(`(${install})()`);
    return this.bridge.cdp.evaluate(`window.__remNativeFast.set(${JSON.stringify(value)})`);
  }
  async setTier(tier) {
    return this.restore(tier == null || tier === 'default' ? { type: 'standard' } : { type: 'custom', serviceTier: tier });
  }
  async tier(config) {
    const selection = await this.read();
    return selection.type === 'custom' ? selection.serviceTier : selection.type === 'standard' ? 'default' : config.service_tier ?? null;
  }
}
