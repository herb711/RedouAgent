import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  KeyRound,
  Link as LinkIcon,
  Search,
  Server,
  X,
} from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Input } from "@/components/ui/input";
import { api, type ModelSetupProvider } from "@/lib/api";

interface Props {
  onClose(): void;
  onSaved(): void;
}

export function ModelSetupDialog({ onClose, onSaved }: Props) {
  const [providers, setProviders] = useState<ModelSetupProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;
    api
      .getModelSetupCatalog()
      .then((payload) => {
        if (closedRef.current) return;
        const list = payload.providers ?? [];
        const current = payload.current;
        const currentProvider =
          list.find((p) => p.provider === current?.provider) ?? list[0];
        setProviders(list);
        if (currentProvider) {
          setSelectedProviderId(currentProvider.provider);
          setSelectedModel(
            current?.provider === currentProvider.provider && current?.model
              ? current.model
              : currentProvider.default_model || currentProvider.models[0] || "",
          );
          setBaseUrl(
            current?.provider === currentProvider.provider && current?.base_url
              ? current.base_url
              : currentProvider.base_url,
          );
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    return () => {
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.provider === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const needle = query.trim().toLowerCase();
  const filteredProviders = useMemo(() => {
    if (!needle) return providers;
    return providers.filter((provider) => {
      const haystack = [
        provider.label,
        provider.provider,
        provider.description,
        provider.region ?? "",
        ...(provider.tags ?? []),
        ...(provider.models ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [needle, providers]);

  const modelChoices = selectedProvider?.models ?? [];
  const apiKeyEnv = selectedProvider?.api_key_env ?? "";
  const needsApiKey =
    !!selectedProvider &&
    !selectedProvider.api_key_optional &&
    !selectedProvider.api_key_set &&
    !!apiKeyEnv;
  const canSave =
    !!selectedProvider &&
    !!selectedModel.trim() &&
    !!baseUrl.trim() &&
    (!needsApiKey || !!apiKey.trim()) &&
    !saving;

  const selectProvider = (provider: ModelSetupProvider) => {
    setSelectedProviderId(provider.provider);
    setSelectedModel(provider.default_model || provider.models[0] || "");
    setBaseUrl(provider.base_url);
    setApiKey("");
    setError(null);
  };

  const save = async () => {
    if (!selectedProvider || !canSave) return;
    setSaving(true);
    setError(null);
    const models = modelChoices.includes(selectedModel)
      ? modelChoices
      : [selectedModel, ...modelChoices];
    try {
      await api.setupMainModel({
        provider: selectedProvider.provider,
        model: selectedModel.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        api_key_env: selectedProvider.api_key_env,
        base_url_env: selectedProvider.base_url_env,
        api_mode: selectedProvider.api_mode,
        custom_provider_name: selectedProvider.custom_provider_name,
        models,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="model-setup-title"
    >
      <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col border border-border bg-card shadow-2xl">
        <Button
          ghost
          size="icon"
          onClick={onClose}
          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X />
        </Button>

        <header className="border-b border-border p-5 pb-4">
          <h2
            id="model-setup-title"
            className="font-display text-base uppercase tracking-wider"
          >
            Set Main Model
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a provider, choose a model, then save the API key for new sessions.
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[270px_minmax(0,1fr)]">
          <aside className="min-h-[220px] overflow-y-auto border-b border-border md:border-b-0 md:border-r">
            <div className="sticky top-0 z-10 border-b border-border bg-card p-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search providers..."
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                <Spinner className="text-xs" /> Loading models...
              </div>
            )}

            {!loading && filteredProviders.length === 0 && (
              <div className="p-4 text-xs italic text-muted-foreground">
                No matching providers.
              </div>
            )}

            <div className="divide-y divide-border/50">
              {filteredProviders.map((provider) => {
                const active = provider.provider === selectedProviderId;
                return (
                  <button
                    key={provider.provider}
                    type="button"
                    onClick={() => selectProvider(provider)}
                    className={`flex w-full items-start gap-2 border-l-2 px-3 py-3 text-left transition-colors hover:bg-muted/35 ${
                      active
                        ? "border-l-primary bg-muted/30"
                        : "border-l-transparent"
                    }`}
                  >
                    <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">
                          {provider.label}
                        </span>
                        {provider.region && (
                          <span className="shrink-0 border border-border px-1 py-0.5 text-[9px] uppercase text-muted-foreground">
                            {provider.region}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground">
                        {provider.provider}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto">
            {!selectedProvider && !loading ? (
              <div className="p-5 text-sm text-muted-foreground">
                Pick a provider.
              </div>
            ) : selectedProvider ? (
              <div className="space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">
                        {selectedProvider.label}
                      </h3>
                      {(selectedProvider.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedProvider.description}
                    </p>
                  </div>
                  {selectedProvider.docs_url && (
                    <a
                      href={selectedProvider.docs_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Docs <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Model
                  </label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {modelChoices.map((model) => {
                      const active = model === selectedModel;
                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => setSelectedModel(model)}
                          className={`flex min-h-9 items-center gap-2 border px-3 py-2 text-left font-mono text-xs transition-colors ${
                            active
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-card hover:bg-muted/35"
                          }`}
                        >
                          <Check
                            className={`h-3.5 w-3.5 shrink-0 ${
                              active ? "text-primary" : "text-transparent"
                            }`}
                          />
                          <span className="min-w-0 flex-1 break-all">{model}</span>
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                    placeholder="Model ID"
                    className="h-9 font-mono text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <KeyRound className="h-3 w-3" />
                      API Key
                    </label>
                    <Input
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        selectedProvider.api_key_set
                          ? `${apiKeyEnv} is saved`
                          : apiKeyEnv || "Optional"
                      }
                      type="password"
                      autoComplete="off"
                      className="h-9 font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {selectedProvider.api_key_optional
                        ? "Optional for local endpoints."
                        : apiKeyEnv
                          ? `Saved as ${apiKeyEnv}.`
                          : "No env var required."}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <LinkIcon className="h-3 w-3" />
                      Base URL
                    </label>
                    <Input
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://provider.example/v1"
                      className="h-9 font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {selectedProvider.base_url_env
                        ? `Also saved as ${selectedProvider.base_url_env}.`
                        : "Saved in config.yaml."}
                    </p>
                  </div>
                </div>

                {error && (
                  <div className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
          <span className="text-xs text-muted-foreground">
            Saves to config.yaml and .env.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button outlined onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!canSave} prefix={saving ? <Spinner /> : null}>
              Save
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
