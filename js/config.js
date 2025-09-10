function ConfigPage() {
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
    setSettings((s) => ({ ...s, [name]: value }));
  }

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
        <button type="submit" className="px-4 py-2 bg-emerald-600 rounded text-white">Save</button>
      </form>
      <div className="mt-4">
        <a href="index.html" className="underline">Back</a>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ConfigPage />);
