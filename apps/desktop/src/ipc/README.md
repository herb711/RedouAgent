# IPC

IPC modules expose Redou Workbench operations to the renderer.

`index.cjs` only registers grouped modules. Put channel constants and register functions in the domain IPC files.

Do not put runtime orchestration, persistence, or platform implementation in IPC index files. IPC files should route to services/orchestrators and stay small.
