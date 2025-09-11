function ConfigPage() {
  const defaultPrizes = [
    { rank: 1, percentage: 50 },
    { rank: 2, percentage: 30 },
    { rank: 3, percentage: 20 },
    { rank: 4, percentage: 0 },
    { rank: 5, percentage: 0 },
  ];
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
    prizes: defaultPrizes,
  };
  const [settings, setSettings] = React.useState(() => {
    try {
      const stored = localStorage.getItem("tournamentSettings");
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  function handleChange(e) {
    const { name, value } = e.target;
    setSettings((s) => {
      const next = { ...s, [name]: value };
      if (name === "payoutPlaces") {
        const count = parseInt(value, 10) || 0;
        let prizes = [...s.prizes];
        if (count > prizes.length) {
          for (let i = prizes.length; i < count; i++) {
            prizes.push({ rank: i + 1, percentage: 0 });
          }
        } else if (count < prizes.length) {
          prizes = prizes.slice(0, count);
        }
        next.prizes = prizes;
      }
      return next;
    });
  }

  function handlePrizeChange(index, percentage) {
    setSettings((s) => {
      const prizes = s.prizes.map((p, i) =>
        i === index ? { ...p, percentage: parseFloat(percentage) || 0 } : p
      );
      return { ...s, prizes };
    });
  }

  const playersCount = React.useMemo(
    () =>
      settings.players
        .split(/\n|,/)
        .map((p) => p.trim())
        .filter(Boolean).length,
    [settings.players]
  );
  const prizePool =
    playersCount * (parseInt(settings.buyInValue, 10) || 0);

  function handleSubmit(e) {
    e.preventDefault();
    try {
      localStorage.setItem("tournamentSettings", JSON.stringify(settings));
    } catch {}
    window.location.href = "index.html";
  }

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-4">Tournament Settings</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
        <label className="flex flex-col">
          <span className="mb-1">Title</span>
          <input name="title" value={settings.title} onChange={handleChange} className="text-black px-2 py-1 rounded" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Currency</span>
          <input name="currency" value={settings.currency} onChange={handleChange} className="text-black px-2 py-1 rounded" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Payout Places</span>
          <input name="payoutPlaces" type="number" value={settings.payoutPlaces} onChange={handleChange} className="text-black px-2 py-1 rounded" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Starting Chips</span>
          <input name="startingChips" type="number" value={settings.startingChips} onChange={handleChange} className="text-black px-2 py-1 rounded" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Players (one per line)</span>
          <textarea
            name="players"
            value={settings.players}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
            rows={5}
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Buy-in Value</span>
          <input
            name="buyInValue"
            type="number"
            value={settings.buyInValue}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Addon Value</span>
          <input
            name="addonValue"
            type="number"
            value={settings.addonValue}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Rebuy Value</span>
          <input
            name="rebuyValue"
            type="number"
            value={settings.rebuyValue}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Round Time (MM:SS)</span>
          <input
            name="roundTime"
            value={settings.roundTime}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Break Time (MM:SS)</span>
          <input
            name="breakTime"
            value={settings.breakTime}
            onChange={handleChange}
            className="text-black px-2 py-1 rounded"
          />
        </label>
        <div>
          <div className="mb-2 font-semibold">Prizes</div>
          <table className="w-full text-black">
            <thead>
              <tr>
                <th className="text-left">Rank</th>
                <th className="text-left">%</th>
                <th className="text-left">Prize</th>
              </tr>
            </thead>
            <tbody>
              {settings.prizes.map((p, i) => (
                <tr key={p.rank} className="odd:bg-white/10">
                  <td className="pr-2">{p.rank}</td>
                  <td className="pr-2">
                    <input
                      type="number"
                      value={p.percentage}
                      onChange={(e) => handlePrizeChange(i, e.target.value)}
                      className="w-16 px-1 py-0.5 rounded"
                    />
                  </td>
                  <td>
                    {settings.currency}
                    {formatNumber(
                      Math.round((prizePool * p.percentage) / 100)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="submit" className="px-4 py-2 bg-emerald-600 rounded text-white">Save</button>
      </form>
      <div className="mt-4 flex gap-4">
        <a href="index.html" className="underline">Back</a>
        <a href="structure.html" className="underline">Structure</a>
      </div>
    </div>
  );
}

function formatNumber(n) {
  try {
    return n.toLocaleString();
  } catch {
    return String(n);
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<ConfigPage />);
