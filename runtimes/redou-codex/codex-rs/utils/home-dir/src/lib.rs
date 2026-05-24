use codex_utils_absolute_path::AbsolutePathBuf;
use dirs::home_dir;
use std::path::Path;
use std::path::PathBuf;

const REDOU_CODEX_HOME_ENV: &str = "REDOU_CODEX_HOME";
const CODEX_HOME_ENV: &str = "CODEX_HOME";
const REDOU_PROJECT_ROOT_ENV: &str = "REDOU_PROJECT_ROOT";
const REDOU_CODEX_MANAGED_PACKAGE_ROOT_ENV: &str = "REDOU_CODEX_MANAGED_PACKAGE_ROOT";

/// Returns the path to the Redou-owned Codex configuration directory.
///
/// `REDOU_CODEX_HOME` is the explicit Redou override. `CODEX_HOME` is still
/// honored for tests and direct advanced invocations. If neither is set, Redou
/// resolves a project-local home under `.redou/redou-codex` instead of using
/// the upstream user-profile Codex directory.
///
/// - If `REDOU_CODEX_HOME` or `CODEX_HOME` is set, the value must exist and be
///   a directory. The value will be canonicalized and this function will Err
///   otherwise.
/// - If neither env var is set, this function returns the project-local default
///   without verifying that the directory exists.
pub fn find_codex_home() -> std::io::Result<AbsolutePathBuf> {
    let redou_codex_home_env = std::env::var(REDOU_CODEX_HOME_ENV)
        .ok()
        .filter(|val| !val.is_empty());
    let codex_home_env = std::env::var(CODEX_HOME_ENV)
        .ok()
        .filter(|val| !val.is_empty());
    find_codex_home_from_env(redou_codex_home_env.as_deref().or(codex_home_env.as_deref()))
}

fn find_codex_home_from_env(codex_home_env: Option<&str>) -> std::io::Result<AbsolutePathBuf> {
    // Honor explicit environment variables when set to allow tests and
    // advanced invocations to override the default location.
    match codex_home_env {
        Some(val) => {
            let path = PathBuf::from(val);
            let metadata = std::fs::metadata(&path).map_err(|err| match err.kind() {
                std::io::ErrorKind::NotFound => std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("Codex home points to {val:?}, but that path does not exist"),
                ),
                _ => std::io::Error::new(
                    err.kind(),
                    format!("failed to read Codex home {val:?}: {err}"),
                ),
            })?;

            if !metadata.is_dir() {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Codex home points to {val:?}, but that path is not a directory"),
                ))
            } else {
                let canonical = path.canonicalize().map_err(|err| {
                    std::io::Error::new(
                        err.kind(),
                        format!("failed to canonicalize Codex home {val:?}: {err}"),
                    )
                })?;
                AbsolutePathBuf::from_absolute_path(canonical)
            }
        }
        None => AbsolutePathBuf::from_absolute_path(default_redou_codex_home()?),
    }
}

fn default_redou_codex_home() -> std::io::Result<PathBuf> {
    if let Some(root) = non_empty_env(REDOU_PROJECT_ROOT_ENV) {
        return Ok(PathBuf::from(root).join(".redou").join("redou-codex"));
    }

    if let Some(runtime_root) = non_empty_env(REDOU_CODEX_MANAGED_PACKAGE_ROOT_ENV) {
        let runtime_root = PathBuf::from(runtime_root);
        if let Some(project_root) = runtime_root.parent().and_then(|parent| parent.parent()) {
            return Ok(project_root.join(".redou").join("redou-codex"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir()
        && let Some(project_root) = find_redou_project_root(&current_dir)
    {
        return Ok(project_root.join(".redou").join("redou-codex"));
    }

    Ok(home_dir()
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::NotFound, "Could not find home directory")
        })?
        .join(".redou")
        .join("redou-codex"))
}

fn find_redou_project_root(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        if ancestor.join("runtimes").join("redou-codex").is_dir() {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::find_codex_home_from_env;
    use super::find_redou_project_root;
    use codex_utils_absolute_path::AbsolutePathBuf;
    use pretty_assertions::assert_eq;
    use std::fs;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    #[test]
    fn find_codex_home_env_missing_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let missing = temp_home.path().join("missing-codex-home");
        let missing_str = missing
            .to_str()
            .expect("missing codex home path should be valid utf-8");

        let err = find_codex_home_from_env(Some(missing_str)).expect_err("missing CODEX_HOME");
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(
            err.to_string().contains("Codex home"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_codex_home_env_file_path_is_fatal() {
        let temp_home = TempDir::new().expect("temp home");
        let file_path = temp_home.path().join("codex-home.txt");
        fs::write(&file_path, "not a directory").expect("write temp file");
        let file_str = file_path
            .to_str()
            .expect("file codex home path should be valid utf-8");

        let err = find_codex_home_from_env(Some(file_str)).expect_err("file CODEX_HOME");
        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(
            err.to_string().contains("not a directory"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn find_codex_home_env_valid_directory_canonicalizes() {
        let temp_home = TempDir::new().expect("temp home");
        let temp_str = temp_home
            .path()
            .to_str()
            .expect("temp codex home path should be valid utf-8");

        let resolved = find_codex_home_from_env(Some(temp_str)).expect("valid CODEX_HOME");
        let expected = temp_home
            .path()
            .canonicalize()
            .expect("canonicalize temp home");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn find_codex_home_without_env_uses_redou_home_dir() {
        let resolved =
            find_codex_home_from_env(/*codex_home_env*/ None).expect("default CODEX_HOME");
        let expected = dirs::home_dir()
            .expect("home dir")
            .join(".redou")
            .join("redou-codex");
        let expected = AbsolutePathBuf::from_absolute_path(expected).expect("absolute home");
        assert_eq!(resolved, expected);
    }

    #[test]
    fn finds_redou_project_root_from_nested_runtime_path() {
        let temp = TempDir::new().expect("temp dir");
        let project = temp.path().join("RedouAgent");
        let nested = project.join("runtimes").join("redou-codex").join("codex-rs");
        fs::create_dir_all(&nested).expect("create nested runtime");

        assert_eq!(find_redou_project_root(&nested), Some(project));
    }
}
