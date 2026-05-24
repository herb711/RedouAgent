'use strict';

const { createRuntimeCapabilities } = require('../common/runtimeCapabilities.cjs');
const { createAvailabilityDescriptor } = require('../common/runtimeAvailability.cjs');
const { createRedouCodexAppServerClient, classifySpawnError } = require('./redouCodexAppServerClient.cjs');
const { buildInitializeRequest } = require('./redouCodexProtocol.cjs');
const {
  REDOU_CODEX_RUNTIME_NOT_FOUND,
  REDOU_CODEX_START_FAILED,
  buildRedouCodexClientOptions,
  redactRedouModelConfig,
} = require('./redouCodexRuntimeConfig.cjs');

function createRedouCodexCapabilities() {
  return createRuntimeCapabilities({
    supportsThread: true,
    supportsTurn: true,
    supportsPlan: true,
    supportsDiff: true,
    supportsApproval: true,
    supportsCommandExecution: true,
    supportsFileChange: true,
    supportsSteering: true,
    supportsInterrupt: true,
    supportsResume: true,
  });
}

async function checkRedouCodexAvailability(options = {}) {
  let clientOptions;
  try {
    clientOptions = buildRedouCodexClientOptions(options);
  } catch (error) {
    return createAvailabilityDescriptor({
      available: false,
      status: 'unavailable',
      lastError: {
        code: error.code || REDOU_CODEX_RUNTIME_NOT_FOUND,
        message: error.message || 'Project redou-codex runtime was not found.',
        details: error.details || null,
      },
    });
  }
  const client = createRedouCodexAppServerClient({
    ...clientOptions,
    timeoutMs: clientOptions.timeoutMs || 10000,
    initializeTimeoutMs: clientOptions.initializeTimeoutMs || 10000,
  });

  try {
    const init = buildInitializeRequest({
      clientInfo: options.clientInfo,
      experimentalApi: Boolean(options.experimentalApi),
    });
    const result = await client.initialize(init.params);
    await client.dispose();
    return createAvailabilityDescriptor({
      available: true,
      status: 'available',
      lastError: null,
      executablePath: clientOptions.actualExecutablePath || clientOptions.intendedExecutablePath || clientOptions.command,
      launchMode: clientOptions.launchMode,
      initialize: result,
      modelConfig: redactRedouModelConfig(clientOptions.modelConfig),
    });
  } catch (error) {
    await client.dispose().catch(() => {});
    const classified = classifySpawnError(error);
    return createAvailabilityDescriptor({
      available: false,
      status: 'unavailable',
      lastError: {
        code: classified.code || REDOU_CODEX_START_FAILED,
        message: 'redou-codex app-server failed to start.',
        details: error && error.message ? error.message : String(error),
      },
      executablePath: clientOptions.actualExecutablePath || clientOptions.intendedExecutablePath || clientOptions.command,
      launchMode: clientOptions.launchMode,
      modelConfig: redactRedouModelConfig(clientOptions.modelConfig),
    });
  }
}

module.exports = { createRedouCodexCapabilities, checkRedouCodexAvailability };
