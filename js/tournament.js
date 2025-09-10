function TournamentManager() {
  const defaultSettings = {
    title: "Big Tournament!",
    currency: "$",
    payoutPlaces: 5,
    startingChips: 1500,
    players: "",
    buyInValue: 1500,
    addonValue: 500,
    rebuyValue: 1000,
    roundTime: "15:00",
    breakTime: "10:00",
  };
  const [settings] = React.useState(() => {
    try {
      const stored = localStorage.getItem("tournamentSettings");
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const players = React.useMemo(() => {
    return settings.players
      .split(/\n|,/) // split on newlines or commas
      .map((p) => p.trim())
      .filter(Boolean);
  }, [settings.players]);

  const [rebuys, setRebuys] = React.useState({});
  const [addons, setAddons] = React.useState({});

  const totalRebuys = Object.values(rebuys).reduce((a, b) => a + b, 0);
  const totalAddons = Object.values(addons).reduce((a, b) => a + b, 0);

  function parseTime(str) {
    const [m = 0, s = 0] = (str || "").split(":").map(Number);
    return (m * 60 + s) * 1000;
  }

  const roundDuration = React.useMemo(() => parseTime(settings.roundTime), [settings.roundTime]);

  const levels = React.useMemo(
    () => [
      { name: 1, sb: 10, bb: 20, ante: 0, durationMs: roundDuration },
      { name: 2, sb: 15, bb: 30, ante: 0, durationMs: roundDuration },
      { name: 3, sb: 25, bb: 50, ante: 0, durationMs: roundDuration },
    ],
    [roundDuration]
  );

  const [levelIndex, setLevelIndex] = React.useState(0);
  const curLevel = levels[levelIndex] || {};
  const nextLevel = levels[levelIndex + 1] || {};

  const [remainingMs, setRemainingMs] = React.useState(curLevel.durationMs);
  const [running, setRunning] = React.useState(false);

  React.useEffect(() => {
    setRemainingMs(curLevel.durationMs);
  }, [levelIndex, curLevel.durationMs]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemainingMs((ms) => Math.max(0, ms - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const playersRemaining = players.length;
  const entries = React.useMemo(
    () => ({ buyIns: players.length + totalRebuys }),
    [players.length, totalRebuys]
  );
  const prizePool =
    players.length * (parseInt(settings.buyInValue, 10) || 0) +
    totalRebuys * (parseInt(settings.rebuyValue, 10) || 0) +
    totalAddons * (parseInt(settings.addonValue, 10) || 0);
  const totalChips =
    (players.length + totalRebuys + totalAddons) *
    (parseInt(settings.startingChips, 10) || 0);
  const nextBreakETA = "-";

  function handlePrevLevel() {
    setLevelIndex((i) => Math.max(0, i - 1));
  }
  function handleNextLevel() {
    setLevelIndex((i) => Math.min(levels.length - 1, i + 1));
  }
  function resetLevelTimer() {
    setRemainingMs(curLevel.durationMs);
  }

  const [showRebuy, setShowRebuy] = React.useState(false);
  function openRebuy() {
    setShowRebuy(true);
  }
  function handleRebuy(name) {
    setRebuys((r) => ({ ...r, [name]: (r[name] || 0) + 1 }));
    setShowRebuy(false);
  }

  return (
    <div className="p-3 sm:p-6">
      <DisplayBoard
        title={settings.title}
        level={curLevel}
        nextLevel={nextLevel}
        remainingMs={remainingMs}
        playersRemaining={playersRemaining}
        entries={entries}
        prizePool={prizePool}
        totalChips={totalChips}
        currency={settings.currency}
        nextBreakETA={nextBreakETA}
        running={running}
        onPause={() => setRunning(false)}
        onResume={() => setRunning(true)}
        onPrev={handlePrevLevel}
        onNext={handleNextLevel}
        onReset={resetLevelTimer}
        onRebuy={openRebuy}
        payoutPlaces={settings.payoutPlaces}
      />
      {showRebuy && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-white text-black p-4 rounded w-64">
            <h2 className="text-xl mb-2">Select player</h2>
            <ul className="flex flex-col gap-2 max-h-64 overflow-auto">
              {players.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => handleRebuy(p)}
                    className="w-full px-3 py-1 bg-emerald-600 text-white rounded"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setShowRebuy(false)}
              className="mt-3 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DisplayBoard({
  title,
  level,
  nextLevel,
  remainingMs,
  playersRemaining,
  entries,
  prizePool,
  totalChips,
  currency,
  nextBreakETA,
  running,
  onPause,
  onResume,
  onPrev,
  onNext,
  onReset,
  payoutPlaces,
  onRebuy,
}) {
  const isBreak = !!level.break;
  return (
    <div className="rounded-2xl shadow-xl p-4 sm:p-6 bg-black/70 text-white border border-white/10">
      <div className="flex items-center justify-between text-3xl font-bold">
        <div>{title}</div>
        <div className="flex items-center gap-4">
          <a href="config.html" className="text-base underline">Config</a>
          <div className="text-yellow-300">Players Remaining: {playersRemaining}</div>
        </div>
      </div>
      <div className="my-4 grid grid-cols-2 gap-2 text-lg">
        <InfoPill label="Round" value={level.name || "-"} />
        <InfoPill label="Next Break" value={nextBreakETA} />
        <InfoPill label="# Entries" value={`${entries.buyIns}`} />
      </div>
      <div className="bg-black rounded-xl py-6 text-center">
        <div className="text-[16vw] leading-none font-black">{fmtMS(remainingMs)}</div>
      </div>
      <div className="text-center mt-4 text-2xl font-semibold">
        {isBreak ? "Break" : "No Limit Texas Hold 'Em"}
      </div>
      <div className="text-center mt-1 text-4xl font-extrabold">
        {isBreak ? "—" : `Blinds: ${currency}${level.sb} - ${currency}${level.bb}`}
      </div>
      <div className="text-center mt-2 text-xl">
        Next Round: {nextLevel?.break ? "Break" : `NLH`} · Next Blinds: {nextLevel?.break ? "—" : `${currency}${nextLevel?.sb ?? "-"} - ${currency}${nextLevel?.bb ?? "-"}`}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-6 text-xl">
        <Stat label="# Paid" value={Math.min(entries.buyIns, payoutPlaces || 5)} />
        <Stat label="# Chips" value={formatNumber(totalChips)} />
        <Stat label="Prize Pool" value={`${currency}${formatNumber(prizePool)}`} />
        <div className="flex items-center justify-center gap-2">
          {running ? (
            <button onClick={onPause} className="px-4 py-2 rounded-xl bg-red-600">Pause</button>
          ) : (
            <button onClick={onResume} className="px-4 py-2 rounded-xl bg-emerald-600">Resume</button>
          )}
          <button onClick={onReset} className="px-3 py-2 rounded-xl bg-neutral-700">Reset</button>
        </div>
      </div>
      <div className="flex gap-2 mt-4 justify-center">
        <button onClick={onPrev} className="px-3 py-2 rounded-xl bg-neutral-700">Prev</button>
        <button onClick={onRebuy} className="px-3 py-2 rounded-xl bg-neutral-700">Rebuy</button>
        <button onClick={onNext} className="px-3 py-2 rounded-xl bg-neutral-700">Next</button>
      </div>
    </div>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-2 text-center">
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-green-800/70 border border-white/10 rounded-xl px-4 py-3 text-center">
      <div className="text-sm opacity-80">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
    </div>
  );
}

function fmtMS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatNumber(n) {
  try {
    return n.toLocaleString();
  } catch {
    return String(n);
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<TournamentManager />);
