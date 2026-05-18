const { runMigrations } = require("./migrations.cjs");
const { ArtifactRepository } = require("./repositories/artifactRepo.cjs");
const { LogRepository } = require("./repositories/logRepo.cjs");
const { RunRepository } = require("./repositories/runRepo.cjs");
const { SettingsRepository } = require("./repositories/settingsRepo.cjs");
const { TaskRepository } = require("./repositories/taskRepo.cjs");

function createLocalDatabase({ paths, activeRuns }) {
  const repositories = {
    tasks: new TaskRepository({
      projectJsonPath: paths.projectJsonPath,
      projectsDir: paths.projectsDir,
    }),
    runs: new RunRepository({ activeRuns }),
    artifacts: new ArtifactRepository(),
    logs: new LogRepository(),
    settings: new SettingsRepository({ statePath: paths.statePath }),
  };

  return {
    repositories,
    migrate() {
      runMigrations({
        appDataRoot: paths.appDataRoot(),
        globalDir: paths.globalDir(),
        projectsDir: paths.projectsDir(),
        statePath: paths.statePath(),
      });
    },
  };
}

module.exports = {
  createLocalDatabase,
};
