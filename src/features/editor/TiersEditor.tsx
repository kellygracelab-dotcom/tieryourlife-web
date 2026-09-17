import { useState, type CSSProperties } from "react";
import { fill, strings } from "../../strings";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { LIMITS, TIER_PRESETS, type EditorAction, type EditorTier } from "./model";

interface TiersEditorProps {
  tiers: readonly EditorTier[];
  dispatch: (action: EditorAction) => void;
}

function TierRow({
  tier,
  index,
  count,
  dispatch,
  paletteOpen,
  onPalette,
}: {
  tier: EditorTier;
  index: number;
  count: number;
  dispatch: (action: EditorAction) => void;
  paletteOpen: boolean;
  onPalette: () => void;
}) {
  const name = tier.label.trim().length > 0 ? tier.label : strings.new.tierUnnamed;
  const rename = (label: string, caption: string) =>
    dispatch({ type: "renameTier", key: tier.key, label, caption });
  return (
    <li className="tiers__row" style={{ "--band": tier.colorLight } as CSSProperties}>
      <div className="tiers__main">
        <button
          type="button"
          className="tiers__swatch"
          aria-label={fill(strings.new.colourOf, { name })}
          aria-expanded={paletteOpen}
          onClick={onPalette}
        />
        <input
          className="tiers__label"
          aria-label={fill(strings.new.labelOf, { n: index + 1 })}
          value={tier.label}
          maxLength={LIMITS.label}
          onChange={(event) => rename(event.target.value, tier.caption ?? "")}
        />
        <input
          className="tiers__caption"
          aria-label={fill(strings.new.captionOf, { name })}
          placeholder={strings.new.captionPlaceholder}
          value={tier.caption ?? ""}
          maxLength={LIMITS.caption}
          onChange={(event) => rename(tier.label, event.target.value)}
        />
        <span className="tiers__tools">
          <button
            type="button"
            className="tiers__tool"
            aria-label={fill(strings.new.moveUp, { name })}
            disabled={index === 0}
            onClick={() => dispatch({ type: "moveTier", key: tier.key, by: -1 })}
          >
            <Icon name="arrow_upward" />
          </button>
          <button
            type="button"
            className="tiers__tool"
            aria-label={fill(strings.new.moveDown, { name })}
            disabled={index === count - 1}
            onClick={() => dispatch({ type: "moveTier", key: tier.key, by: 1 })}
          >
            <Icon name="arrow_downward" />
          </button>
          <button
            type="button"
            className="tiers__tool"
            aria-label={fill(strings.new.removeTier, { name })}
            disabled={count <= 1}
            onClick={() => dispatch({ type: "removeTier", key: tier.key })}
          >
            <Icon name="delete" />
          </button>
        </span>
      </div>
      {paletteOpen && (
        <div className="tiers__palette" role="group" aria-label={strings.new.palette}>
          {TIER_PRESETS.map((preset) => (
            <button
              key={preset.light}
              type="button"
              className="tiers__preset"
              style={{ background: preset.light }}
              aria-label={preset.light}
              aria-pressed={preset.light.toLowerCase() === tier.colorLight.toLowerCase()}
              onClick={() => {
                dispatch({
                  type: "recolourTier",
                  key: tier.key,
                  colorLight: preset.light,
                  colorDark: preset.dark,
                });
                onPalette();
              }}
            />
          ))}
        </div>
      )}
    </li>
  );
}

export function TiersEditor({ tiers, dispatch }: TiersEditorProps) {
  const [palette, setPalette] = useState<string | null>(null);
  return (
    <section className="tiers" aria-labelledby="tiers-title">
      <div className="editor__heading">
        <h2 id="tiers-title">{strings.new.tiers}</h2>
        <Button
          icon="add"
          onClick={() => dispatch({ type: "addTier" })}
          disabled={tiers.length >= LIMITS.tiers}
        >
          {strings.new.addTier}
        </Button>
      </div>
      <ol className="tiers__list" aria-label={strings.new.tiers}>
        {tiers.map((tier, index) => (
          <TierRow
            key={tier.key}
            tier={tier}
            index={index}
            count={tiers.length}
            dispatch={dispatch}
            paletteOpen={palette === tier.key}
            onPalette={() => setPalette((open) => (open === tier.key ? null : tier.key))}
          />
        ))}
      </ol>
      <p className="editor__hint">{strings.new.tiersHint}</p>
    </section>
  );
}
