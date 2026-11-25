import React from "react";
import ReactDOM from "react-dom/client";
import "vazirmatn/Vazirmatn-font-face.css";
import { ManagementPanel } from "./features/management/ManagementPanel";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ManagementPanel /></React.StrictMode>,
);
