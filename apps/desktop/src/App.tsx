import { getCurrentWindow } from "@tauri-apps/api/window";
import { MainApp } from "./MainApp";
import { QuickWidget } from "./components/QuickWidget";
import "./App.css";

/** Routes the shared bundle: the main window or a quick-action progress window. */
function App() {
  let windowLabel = "main";
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    // Browser previews do not expose the Tauri window API.
  }
  const widgetJobId = windowLabel.startsWith("quick-widget-")
    ? windowLabel.slice("quick-widget-".length)
    : new URLSearchParams(window.location.search).get("widget");
  return widgetJobId ? <QuickWidget jobId={widgetJobId} /> : <MainApp />;
}

export default App;
