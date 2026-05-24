# Platform

Platform modules isolate Electron, filesystem, git, logging, process, and config capabilities.

Add host-specific APIs under the matching platform subdirectory. Runtimes and orchestrators should call platform wrappers instead of scattering `fs`, `path`, `child_process`, or git shell logic.

Do not put domain state, Codex protocol logic, renderer components, or long-running workflow orchestration here.
