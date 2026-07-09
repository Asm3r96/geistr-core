import { Brain, ChevronDown, ChevronLeft, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DesktopModelOption, DesktopModelSelection } from "../shared/desktop-api";
import type { GeistrThinkingLevel } from "@geistr/core";

interface ModelPickerProps {
  selected: DesktopModelSelection | null;
  options: DesktopModelOption[];
  favoriteModelKeys: ReadonlySet<string>;
  onSelectModel: (provider: string, modelId: string, thinkingLevel?: GeistrThinkingLevel) => void;
  onToggleFavorite: (key: string) => void;
  onSelectThinkingLevel: (thinkingLevel: GeistrThinkingLevel) => void;
}

type ViewState =
  | { view: "providers" }
  | { view: "models"; provider: string; providerName: string };

export function ModelPicker({
  selected,
  options,
  favoriteModelKeys,
  onSelectModel,
  onToggleFavorite,
  onSelectThinkingLevel,
}: ModelPickerProps) {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isThinkingMenuOpen, setIsThinkingMenuOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const modelAnchorRef = useRef<HTMLDivElement>(null);
  const thinkingAnchorRef = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState<ViewState>({ view: "providers" });
  const providerSearchRef = useRef<HTMLInputElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (modelAnchorRef.current?.contains(target) || thinkingAnchorRef.current?.contains(target)) return;
      closeModelMenu();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Focus search input when opening the menu or switching views
  useEffect(() => {
    if (isModelMenuOpen) {
      const input = viewState.view === "models" ? modelSearchRef.current : providerSearchRef.current;
      const timer = setTimeout(() => input?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isModelMenuOpen, viewState]);

  function closeModelMenu() {
    setIsModelMenuOpen(false);
    setModelSearch("");
    setViewState({ view: "providers" });
  }

  const connectedModelOptions = useMemo(() => options.filter((option) => option.configured), [options]);

  const selectedModelKey = selected ? `${selected.provider}/${selected.modelId}` : "";
  const selectedModelLabel = options.find(
    (option) => `${option.provider}/${option.modelId}` === selectedModelKey,
  );

  // ── Provider-level data ──
  const providerInfos = useMemo(() => {
    const map = new Map<
      string,
      { provider: string; providerName: string; modelCount: number; favoriteCount: number }
    >();
    for (const option of connectedModelOptions) {
      const existing = map.get(option.provider) ?? {
        provider: option.provider,
        providerName: option.providerName,
        modelCount: 0,
        favoriteCount: 0,
      };
      existing.modelCount++;
      if (favoriteModelKeys.has(modelOptionKey(option))) existing.favoriteCount++;
      map.set(option.provider, existing);
    }
    return [...map.values()].sort((a, b) =>
      a.providerName.localeCompare(b.providerName),
    );
  }, [connectedModelOptions, favoriteModelKeys]);

  // ── Filtered data based on search ──
  const query = modelSearch.trim().toLowerCase();

  const filteredProviders = useMemo(() => {
    if (!query) return providerInfos;
    return providerInfos.filter(
      (p) =>
        p.providerName.toLowerCase().includes(query) || p.provider.toLowerCase().includes(query),
    );
  }, [providerInfos, query]);

  const filteredMatchingModels = useMemo(() => {
    if (!query) return [];
    return connectedModelOptions.filter((option) =>
      `${option.modelName} ${option.modelId} ${option.providerName} ${option.provider}`.toLowerCase().includes(query),
    );
  }, [connectedModelOptions, query]);

  // ── Models for the selected provider detail view ──
  const currentProviderModels = useMemo(() => {
    if (viewState.view !== "models") return [];
    return connectedModelOptions
      .filter((option) => option.provider === viewState.provider)
      .sort((a, b) => a.modelName.localeCompare(b.modelName));
  }, [connectedModelOptions, viewState]);

  // Search within model detail view
  const filteredCurrentModels = useMemo(() => {
    if (!query) return currentProviderModels;
    return currentProviderModels.filter((option) =>
      `${option.modelName} ${option.modelId}`.toLowerCase().includes(query),
    );
  }, [currentProviderModels, query]);

  // ── Favorites shown in provider view ──
  const favoriteModels = useMemo(() => {
    return connectedModelOptions.filter((option) => favoriteModelKeys.has(modelOptionKey(option)));
  }, [connectedModelOptions, favoriteModelKeys]);

  function handleSelectModel(value: string) {
    if (!value) return;
    const option = options.find(
      (candidate) => `${candidate.provider}/${candidate.modelId}` === value,
    );
    if (!option) return;
    const currentThinkingLevel = selected?.thinkingLevel;
    const thinkingLevel =
      currentThinkingLevel && option.thinkingLevels.includes(currentThinkingLevel)
        ? currentThinkingLevel
        : option.thinkingLevels.at(-1);
    onSelectModel(option.provider, option.modelId, thinkingLevel);
    closeModelMenu();
  }

  function handleOpenProvider(provider: string, providerName: string) {
    setViewState({ view: "models", provider, providerName });
    setModelSearch("");
  }

  const handleBackToProviders = useCallback(() => {
    setViewState({ view: "providers" });
    setModelSearch("");
  }, []);

  const isModelView = viewState.view === "models";

  return (
    <>
      <div className="modelMenuAnchor" ref={modelAnchorRef}>
        <button
          className="modelAction"
          type="button"
          aria-label="Choose model"
          aria-expanded={isModelMenuOpen}
          onClick={() => {
            setIsModelMenuOpen((open) => {
              if (open) {
                closeModelMenu();
                return false;
              }
              return true;
            });
          }}
        >
          <Brain size={18} />
          <span>{selectedModelLabel?.modelName ?? "Model"}</span>
          {selectedModelLabel ? <small className="modelActionProvider">{selectedModelLabel.providerName}</small> : null}
          <ChevronDown size={14} />
        </button>

        {isModelMenuOpen ? (
          <div className="modelMenu">
            <div className={`modelMenuViewport ${isModelView ? "showingModels" : ""}`}>
              {/* ═══════════════ PROVIDER VIEW ═══════════════ */}
              <div className="modelProviderView">
                <input
                  ref={providerSearchRef}
                  className="modelSearchInput"
                  aria-label="Search providers or models"
                  placeholder="Search providers or models…"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                />

                {options.length === 0 ? (
                  <div className="modelMenuEmpty">No Pi models found</div>
                ) : null}
                {options.length > 0 && connectedModelOptions.length === 0 ? (
                  <div className="modelMenuEmpty">Connect a provider in Settings to choose its models.</div>
                ) : null}

                {/* Favorites at top of provider view */}
                {!query && favoriteModels.length > 0 ? (
                  <section className="modelProviderGroup favoriteModelGroup" aria-label="Favorite models">
                    <div className="modelProviderTitle">Favorites</div>
                    {favoriteModels.map((option) =>
                      renderModelMenuItem(
                        option,
                        selectedModelKey,
                        favoriteModelKeys,
                        handleSelectModel,
                        onToggleFavorite,
                      ),
                    )}
                  </section>
                ) : null}

                {/* Empty state when searching and nothing matches */}
                {query && filteredProviders.length === 0 && filteredMatchingModels.length === 0 ? (
                  <div className="modelMenuEmpty">No matching models</div>
                ) : null}

                {/* Provider cards */}
                {filteredProviders.length > 0 ? (
                  <section className="modelProviderGroup providerGroup" aria-label="Providers">
                    {query ? <div className="modelProviderTitle">Providers</div> : null}
                    {filteredProviders.map((info) => (
                      <button
                        key={info.provider}
                        className="modelProviderCard"
                        type="button"
                        onClick={() => handleOpenProvider(info.provider, info.providerName)}
                      >
                        <span className="modelProviderCardName">{info.providerName}</span>
                        <span className="modelProviderCardCount">
                          {info.modelCount} model{info.modelCount !== 1 ? "s" : ""}
                        </span>
                        {info.favoriteCount > 0 ? (
                          <span className="modelProviderCardFavs" aria-label={`${info.favoriteCount} favorited`}>
                            <Star size={12} fill="currentColor" />
                            {info.favoriteCount}
                          </span>
                        ) : null}
                        <ChevronLeft size={14} className="modelProviderCardChevron" />
                      </button>
                    ))}
                  </section>
                ) : null}

                {/* Models that matched search (shown below provider results) */}
                {query && filteredMatchingModels.length > 0 ? (
                  <section className="modelProviderGroup" aria-label="Matching models">
                    <div className="modelProviderTitle">Models</div>
                    {filteredMatchingModels.map((option) =>
                      renderModelMenuItem(
                        option,
                        selectedModelKey,
                        favoriteModelKeys,
                        handleSelectModel,
                        onToggleFavorite,
                        true, // showProvider
                      ),
                    )}
                  </section>
                ) : null}
              </div>

              {/* ═══════════════ MODEL DETAIL VIEW ═══════════════ */}
              <div className="modelDetailView">
                <div className="modelDetailHeader">
                  <button
                    type="button"
                    className="modelDetailBack"
                    onClick={handleBackToProviders}
                    aria-label="Back to providers"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="modelDetailProviderName">
                    {viewState.view === "models" ? viewState.providerName : ""}
                  </span>
                </div>

                <input
                  ref={modelSearchRef}
                  className="modelSearchInput"
                  aria-label="Search models"
                  placeholder="Search models…"
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                />

                {filteredCurrentModels.length === 0 ? (
                  <div className="modelMenuEmpty">No matching models</div>
                ) : null}

                {/* Favorite models within this provider (when not searching) */}
                {!query && (
                  <>
                    {filteredCurrentModels.filter((m) => favoriteModelKeys.has(modelOptionKey(m))).length > 0 ? (
                      <section className="modelProviderGroup favoriteModelGroup" aria-label="Favorite models">
                        <div className="modelProviderTitle">Favorites</div>
                        {filteredCurrentModels
                          .filter((m) => favoriteModelKeys.has(modelOptionKey(m)))
                          .map((option) =>
                            renderModelMenuItem(
                              option,
                              selectedModelKey,
                              favoriteModelKeys,
                              handleSelectModel,
                              onToggleFavorite,
                            ),
                          )}
                      </section>
                    ) : null}
                    {filteredCurrentModels.filter((m) => !favoriteModelKeys.has(modelOptionKey(m))).length > 0 ? (
                      <section className="modelProviderGroup" aria-label="All models">
                        <div className="modelProviderTitle">All Models</div>
                        {filteredCurrentModels
                          .filter((m) => !favoriteModelKeys.has(modelOptionKey(m)))
                          .map((option) =>
                            renderModelMenuItem(
                              option,
                              selectedModelKey,
                              favoriteModelKeys,
                              handleSelectModel,
                              onToggleFavorite,
                            ),
                          )}
                      </section>
                    ) : null}
                  </>
                )}

                {/* Searching in model view: just flat results */}
                {query && filteredCurrentModels.length > 0 ? (
                  <section className="modelProviderGroup" aria-label="Matching models">
                    <div className="modelProviderTitle">Models</div>
                    {filteredCurrentModels.map((option) =>
                      renderModelMenuItem(
                        option,
                        selectedModelKey,
                        favoriteModelKeys,
                        handleSelectModel,
                        onToggleFavorite,
                      ),
                    )}
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {selectedModelLabel && selectedModelLabel.thinkingLevels.length > 0 ? (
        <div className="thinkingMenuAnchor" ref={thinkingAnchorRef}>
          <button
            className="thinkingAction"
            type="button"
            aria-label="Thinking level"
            aria-expanded={isThinkingMenuOpen}
            onClick={() => setIsThinkingMenuOpen((open) => !open)}
          >
            {selected?.thinkingLevel ?? selectedModelLabel.thinkingLevels.at(-1)}
            <ChevronDown size={13} />
          </button>
          {isThinkingMenuOpen ? (
            <div className="thinkingMenu" role="menu" aria-label="Thinking options">
              {selectedModelLabel.thinkingLevels.map((level) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={level === (selected?.thinkingLevel ?? selectedModelLabel.thinkingLevels.at(-1))}
                  className={
                    level === (selected?.thinkingLevel ?? selectedModelLabel.thinkingLevels.at(-1))
                      ? "thinkingMenuItem selected"
                      : "thinkingMenuItem"
                  }
                  key={level}
                  onClick={() => {
                    onSelectThinkingLevel(level);
                    setIsThinkingMenuOpen(false);
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// ── Shared model menu item renderer ──

function renderModelMenuItem(
  option: DesktopModelOption,
  selectedModelKey: string,
  favoriteModelKeys: ReadonlySet<string>,
  selectModel: (value: string) => void,
  toggleFavoriteModel: (key: string) => void,
  showProvider?: boolean,
) {
  const key = modelOptionKey(option);
  const isFavorite = favoriteModelKeys.has(key);
  return (
    <div className={key === selectedModelKey ? "modelMenuItem selected" : "modelMenuItem"} key={key}>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={key === selectedModelKey}
        className="modelMenuSelect"
        onClick={() => selectModel(key)}
      >
        <span>
          {option.modelName}
          {showProvider ? <span className="modelProviderTag"> · {option.providerName}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className={isFavorite ? "modelFavoriteButton active" : "modelFavoriteButton"}
        aria-label={isFavorite ? `Remove ${option.modelName} from favorites` : `Add ${option.modelName} to favorites`}
        aria-pressed={isFavorite}
        onClick={() => toggleFavoriteModel(key)}
      >
        <Star size={14} fill="currentColor" />
      </button>
    </div>
  );
}

// ── Helpers ──

function modelOptionKey(option: Pick<DesktopModelOption, "provider" | "modelId">): string {
  return `${option.provider}/${option.modelId}`;
}
