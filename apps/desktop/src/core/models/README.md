# Models

Models define small CommonJS factories and normalizers for Redou entities.

Add one file per entity. Keep files data-shaped and boring: defaults, normalization, field comments, and exported constants are allowed.

Do not add persistence, IPC handlers, runtime calls, or business workflows here. Model files should stay far below 300 lines.
