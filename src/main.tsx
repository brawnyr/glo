import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Intentionally no StrictMode: createMediaElementSource() can only be called
// once per <audio> element, and StrictMode's dev-only double-mount throws
// InvalidStateError on the second attach.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
