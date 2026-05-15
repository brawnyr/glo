import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// No StrictMode: createMediaElementSource() can only be called once per
// <audio>, and StrictMode's dev-only double-mount throws InvalidStateError.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
