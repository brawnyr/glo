import { CassetteSprite } from "../assets/pixel-sprites";

type Props = {
  suggestedPath: string;
  onAccept: (path: string) => void;
  onPickCustom: () => void;
  busy: boolean;
};

export default function FirstRunModal({ suggestedPath, onAccept, onPickCustom, busy }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-roast-900/80 backdrop-blur-sm">
      <div className="panel max-w-lg w-[90vw] p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <CassetteSprite size={40} />
          <div>
            <div className="font-display text-cream-100 text-xl leading-tight">welcome to glo</div>
            <div className="font-mono text-xs text-cream-400">pour something good</div>
          </div>
        </div>

        <div className="font-mono text-sm text-cream-200 leading-relaxed">
          When you press <kbd className="px-1 bg-roast-800 border border-roast-900">[</kbd> or{" "}
          <kbd className="px-1 bg-roast-800 border border-roast-900">]</kbd> while a station is playing,
          glo saves the last 30 or 60 seconds as a WAV. Where should those clips live?
        </div>

        <div className="px-3 py-2 bg-roast-900 border border-roast-800 font-mono text-xs text-cream-300 break-all">
          {suggestedPath}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => onAccept(suggestedPath)}
            disabled={busy}
            className="btn-pixel btn-crema flex-1 disabled:opacity-50"
          >
            use this folder
          </button>
          <button
            onClick={onPickCustom}
            disabled={busy}
            className="btn-pixel flex-1 disabled:opacity-50"
          >
            choose different folder
          </button>
        </div>

        <div className="font-mono text-[10px] text-cream-400/70 text-center">
          you can change this anytime from the clip library.
        </div>
      </div>
    </div>
  );
}
