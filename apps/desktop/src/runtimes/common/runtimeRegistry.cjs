'use strict';

function getAdapterId(adapterOrDescriptor) {
  return typeof adapterOrDescriptor.getId === 'function' ? adapterOrDescriptor.getId() : adapterOrDescriptor.id;
}

function createUnavailableRuntime(id, reason) {
  return {
    runtime: null,
    runtimeId: id,
    status: 'unavailable',
    available: false,
    reason,
  };
}

function registerDefaultRuntimes(registry, dependencies = {}) {
  const { createRedouCodexRuntimeAdapter } = require('../redou-codex/redouCodexRuntimeAdapter.cjs');
  const { createHermesRuntimeAdapter } = require('../hermes/hermesRuntimeAdapter.cjs');
  const { createPiRuntimeAdapter } = require('../pi/piRuntimeAdapter.cjs');
  const { createCustomRuntimeAdapter } = require('../custom/customRuntimeAdapter.cjs');
  registry.registerRuntime(dependencies.redouCodexAdapter || createRedouCodexRuntimeAdapter(dependencies.redouCodex || dependencies));
  registry.registerRuntime(dependencies.hermesAdapter || createHermesRuntimeAdapter(dependencies.hermes || {}));
  registry.registerRuntime(dependencies.piAdapter || createPiRuntimeAdapter(dependencies.pi || {}));
  registry.registerRuntime(dependencies.customAdapter || createCustomRuntimeAdapter(dependencies.custom || {}));
}

function createRuntimeRegistry(options = {}) {
  const { REDOU_CODEX_RUNTIME_ID, REDOU_CODEX_DISPLAY_NAME } = require('../redou-codex/redouCodexRuntimeConfig.cjs');
  const runtimes = new Map();
  const availabilityCache = new Map();
  const availabilityCacheTtlMs = options.availabilityCacheTtlMs || 5000;
  const settings = { defaultRuntime: REDOU_CODEX_RUNTIME_ID, ...(options.settings || {}) };

  const registry = {
    registerRuntime(adapterOrDescriptor) {
      const id = getAdapterId(adapterOrDescriptor);
      if (!id) throw new Error('Runtime id is required');
      runtimes.set(id, adapterOrDescriptor);
      return adapterOrDescriptor;
    },
    getRuntime(id) {
      return runtimes.get(id) || null;
    },
    listRuntimes() {
      return Array.from(runtimes.values());
    },
    async listRuntimeDescriptors() {
      const descriptors = [];
      for (const runtime of runtimes.values()) {
        const id = getAdapterId(runtime);
        const availability = await this.getRuntimeAvailability(id);
        descriptors.push({
          id,
          name: id === REDOU_CODEX_RUNTIME_ID ? REDOU_CODEX_DISPLAY_NAME : id,
          kind: id,
          enabled: true,
          isDefault: this.getDefaultRuntimeId() === id,
          capabilities: typeof runtime.getCapabilities === 'function' ? runtime.getCapabilities() : runtime.capabilities || {},
          available: availability.available,
          status: availability.status,
          lastError: availability.lastError || null,
        });
      }
      return descriptors;
    },
    async getRuntimeAvailability(id, options = {}) {
      const runtime = runtimes.get(id);
      if (!runtime) {
        return { available: false, status: 'unavailable', lastError: { code: 'RUNTIME_NOT_FOUND', message: `Runtime ${id} is not registered.` } };
      }
      const cached = availabilityCache.get(id);
      if (!options.force && cached && Date.now() - cached.checkedAt < availabilityCacheTtlMs) {
        return cached.availability;
      }
      let availability;
      if (typeof runtime.getAvailability === 'function') {
        try {
          availability = await runtime.getAvailability();
        } catch (error) {
          availability = {
            available: false,
            status: 'unavailable',
            lastError: {
              code: error && error.code ? error.code : 'RUNTIME_AVAILABILITY_ERROR',
              message: error && error.message ? error.message : String(error),
              details: error && error.details ? error.details : null,
            },
          };
        }
      } else if (id === 'hermes') {
        availability = { available: false, status: 'legacy', lastError: { code: 'LEGACY_RUNTIME', message: 'Hermes is a legacy runtime descriptor only in the rewrite path.' } };
      } else {
        availability = { available: false, status: 'scaffold', lastError: { code: 'SCAFFOLD_RUNTIME', message: `${id} runtime is scaffold-only.` } };
      }
      availabilityCache.set(id, { availability, checkedAt: Date.now() });
      return availability;
    },
    getDefaultRuntimeId() {
      return settings.defaultRuntime || REDOU_CODEX_RUNTIME_ID;
    },
    setDefaultRuntime(id) {
      if (!runtimes.has(id)) throw new Error(`Runtime ${id} is not registered`);
      settings.defaultRuntime = id;
      return id;
    },
    async resolveRuntime(task = {}, project = {}, overrideSettings = settings) {
      const runtimeId = task.runtime || project.defaultRuntime || overrideSettings.defaultRuntime || REDOU_CODEX_RUNTIME_ID;
      const runtime = runtimes.get(runtimeId);
      if (!runtime) return createUnavailableRuntime(runtimeId, `Runtime ${runtimeId} is not registered.`);
      const availability = await this.getRuntimeAvailability(runtimeId);
      if (runtimeId === REDOU_CODEX_RUNTIME_ID && !availability.available) {
        return createUnavailableRuntime(runtimeId, availability.lastError || 'redou-codex is unavailable.');
      }
      if (!availability.available && runtimeId !== 'hermes') {
        return createUnavailableRuntime(runtimeId, availability.lastError || `${runtimeId} is unavailable.`);
      }
      return {
        runtime,
        runtimeId,
        status: availability.available ? 'available' : availability.status,
        available: availability.available,
        availability,
      };
    },
    async getDefaultRuntime() {
      const resolved = await this.resolveRuntime({}, {}, settings);
      return resolved.runtime;
    },
  };

  if (options.autoRegisterDefaults !== false) {
    registerDefaultRuntimes(registry, options.dependencies || options);
  }

  return registry;
}

module.exports = { createRuntimeRegistry };
